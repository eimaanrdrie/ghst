import hashlib
from io import BytesIO
from pathlib import Path

from pypdf import PdfWriter

from app.services.pdf import extract_pdf
from app.services.training import load_governed_dataset
from app.services.downstream import DownstreamError, downstream_adapter
from app.core.config import Settings
from tests.conftest import login
from tests.test_ace_gateway_audit import create_precedent
from tests.test_governance import DEST, evaluate


def _decide(client, headers, review_id, *, create_precedent=False, high_ceiling=0.5):
    return client.post(
        f"/api/v1/reviews/{review_id}/decision",
        headers=headers,
        json={
            "decision": "ALLOW",
            "justification": "Authorised reviewer confirmed the synthetic public context and bounded purpose.",
            "create_precedent": create_precedent,
            "precedent_scope": {
                "role_context": "EMPLOYEE", "purpose": "Legal research",
                "data_class": "CONFIDENTIAL_BUSINESS_IP", "risk_ceiling": high_ceiling,
                "control": "ALLOW", "reuse_limit": 10, "validity_days": 30,
            } if create_precedent else None,
        },
    )


def test_image_only_pdf_invokes_bounded_ocr(monkeypatch):
    stream = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(stream)
    monkeypatch.setattr("app.services.pdf._extract_with_ocr", lambda *args, **kwargs: "Synthetic OCR financial forecast")
    assert extract_pdf(stream.getvalue(), 1_000_000, 2, ocr_enabled=True) == "Synthetic OCR financial forecast"


def test_rolling_session_detects_split_credential(client, legal_headers):
    first = evaluate(client, legal_headers, "I will split the API key into a first half.")
    assert first.status_code == 200
    second = evaluate(client, legal_headers, "Continuation next chunk A1B2C3D4E5F6G7H8")
    assert second.status_code == 200
    body = second.json()
    assert body["action"] == "BLOCK"
    assert any(item["detector"] == "rolling-session-secret-v1" for item in body["findings"])


def test_cross_department_delegation_is_audited_and_revocable(client, legal_headers, system_headers):
    finance_reviewer = login(client, "finance.reviewer@ghst.demo", "DemoReview!2026")
    reviewer_id = client.get("/api/v1/auth/me", headers=finance_reviewer).json()["id"]
    evaluation = evaluate(client, legal_headers, "Summarise public Project Nightfall launch notes.").json()
    denied = client.get(f"/api/v1/reviews/{evaluation['review_id']}", headers=finance_reviewer)
    assert denied.status_code == 403
    grant = client.post("/api/v1/review-delegations", headers=system_headers, json={
        "reviewer_id": reviewer_id, "department": "Legal",
        "reason": "Temporary audited Legal review coverage for the synthetic test.", "validity_days": 1,
    })
    assert grant.status_code == 200, grant.text
    assert client.get(f"/api/v1/reviews/{evaluation['review_id']}", headers=finance_reviewer).status_code == 200
    revoked = client.post(f"/api/v1/review-delegations/{grant.json()['id']}/revoke", headers=system_headers)
    assert revoked.status_code == 200
    assert client.get(f"/api/v1/reviews/{evaluation['review_id']}", headers=finance_reviewer).status_code == 403


def test_high_impact_precedent_requires_independent_second_reviewer(
    client, legal_headers, reviewer_headers, second_reviewer_headers
):
    evaluation = evaluate(
        client, legal_headers,
        "Use public Project Falcon launch notes as context for a hiring decision.",
    ).json()
    assert evaluation["action"] == "REVIEW"
    first = _decide(client, reviewer_headers, evaluation["review_id"], create_precedent=True, high_ceiling=0.95)
    assert first.status_code == 200, first.text
    assert first.json()["precedent_status"] == "PENDING_SECOND_REVIEW"
    precedent_id = first.json()["precedent_id"]
    self_approval = client.post(f"/api/v1/precedents/{precedent_id}/second-approval", headers=reviewer_headers, json={
        "approved": True, "justification": "First reviewer cannot independently approve their own precedent.",
    })
    assert self_approval.status_code == 403
    approved = client.post(f"/api/v1/precedents/{precedent_id}/second-approval", headers=second_reviewer_headers, json={
        "approved": True, "justification": "Independent reviewer confirmed the high-impact boundary and policy evidence.",
    })
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "ACTIVE"
    reused = evaluate(
        client, legal_headers,
        "Use public Project Falcon launch notes as context for a hiring decision.",
    ).json()
    assert reused["action"] == "ALLOW"
    assert reused["learning_source"] == "ACE_PRECEDENT"
    assert reused["precedent_id"] == precedent_id
    client.post(f"/api/v1/precedents/{precedent_id}/revoke", headers=second_reviewer_headers)


def test_standard_precedent_cannot_expand_into_high_impact_use(client, legal_headers, reviewer_headers):
    precedent_id = create_precedent(client, legal_headers, reviewer_headers)
    high_impact = evaluate(
        client, legal_headers,
        "Summarise the public Project Aurora launch notes for a hiring decision.",
    ).json()
    assert high_impact["action"] == "REVIEW"
    assert high_impact["precedent_id"] is None
    client.post(f"/api/v1/precedents/{precedent_id}/revoke", headers=reviewer_headers)


def test_policy_simulation_reports_changes_and_affected_precedents(client, policy_headers):
    created = client.post("/api/v1/policies", headers=policy_headers, json={
        "name": "Synthetic Simulation Policy", "category": "ACCEPTABLE_USE", "owner": "Test Admin",
        "scope": "ORGANISATION", "version": "SIM-1.0",
        "clauses": [{"department": "ALL", "roles": [], "purposes": [], "clause_ref": "1.1", "text": "All synthetic requests require authorised review before release.", "action": "REVIEW"}],
    })
    assert created.status_code == 200
    report = client.post(
        f"/api/v1/policies/{created.json()['id']}/versions/SIM-1.0/simulate",
        headers=policy_headers,
    )
    assert report.status_code == 200, report.text
    assert "changed_action_count" in report.json()
    assert "affected_precedents" in report.json()


def test_only_policy_admin_can_assign_global_precedent_scope(client, legal_headers, finance_headers, reviewer_headers, policy_headers):
    precedent_id = create_precedent(client, legal_headers, reviewer_headers)
    denied = client.post(f"/api/v1/precedents/{precedent_id}/scope", headers=reviewer_headers, json={
        "scope": "GLOBAL", "justification": "A departmental reviewer must not broaden the scope globally.",
    })
    assert denied.status_code == 403
    assigned = client.post(f"/api/v1/precedents/{precedent_id}/scope", headers=policy_headers, json={
        "scope": "GLOBAL", "justification": "Policy administrator reviewed and approved the cross-department boundary.",
    })
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["scope"] == "GLOBAL"
    cross_department = evaluate(
        client, finance_headers,
        "Please create a summary of the public Project Aurora launch notes.",
        purpose="Legal research",
    ).json()
    assert cross_department["action"] == "ALLOW"
    assert cross_department["precedent_id"] == precedent_id
    client.post(f"/api/v1/precedents/{precedent_id}/revoke", headers=policy_headers)


def test_calibration_requires_batch_and_human_activation(client, legal_headers, reviewer_headers, policy_headers):
    for project in ("Aurora", "Nightfall", "Orchid"):
        result = evaluate(client, legal_headers, f"Summarise the public Project {project} launch context.").json()
        if result["action"] == "REVIEW":
            assert _decide(client, reviewer_headers, result["review_id"]).status_code == 200
    recommendation = client.post(
        "/api/v1/learning/calibrations/recommend", headers=policy_headers,
        json={"minimum_validated_reviews": 3},
    )
    assert recommendation.status_code == 200, recommendation.text
    assert recommendation.json()["status"] == "DRAFT"
    activated = client.post(
        f"/api/v1/learning/calibrations/{recommendation.json()['id']}/activate",
        headers=policy_headers,
        json={"justification": "Validated reviewer batch supports a conservative threshold increase."},
    )
    assert activated.status_code == 200
    assert activated.json()["status"] == "ACTIVE"


def test_repeated_human_allows_auto_propose_a_pending_precedent(
    client, legal_headers, reviewer_headers, second_reviewer_headers
):
    existing = client.get("/api/v1/precedents?status_filter=ACTIVE", headers=reviewer_headers)
    assert existing.status_code == 200, existing.text
    for precedent in existing.json():
        client.post(f"/api/v1/precedents/{precedent['id']}/revoke", headers=reviewer_headers)
    pending = client.get("/api/v1/precedents?status_filter=PENDING_SECOND_REVIEW", headers=reviewer_headers)
    assert pending.status_code == 200, pending.text
    for precedent in pending.json():
        client.post(
            f"/api/v1/precedents/{precedent['id']}/second-approval",
            headers=second_reviewer_headers,
            json={
                "approved": False,
                "justification": "Reset pending precedent so the auto-proposal scenario starts clean.",
            },
        )

    prompts = [
        "Summarise the public Project Aurora launch notes.",
        "Please create a summary of the public Project Aurora launch notes.",
        "Please write a summary of the public Project Aurora launch notes.",
    ]
    last_decision = None
    for prompt in prompts:
        evaluation = evaluate(client, legal_headers, prompt).json()
        assert evaluation["action"] == "REVIEW"
        last_decision = _decide(client, reviewer_headers, evaluation["review_id"])
        assert last_decision.status_code == 200, last_decision.text

    assert last_decision is not None
    body = last_decision.json()
    assert body["precedent_id"] is None
    assert body["proposed_precedent_id"] is not None
    assert body["proposed_precedent_status"] == "PENDING_SECOND_REVIEW"

    pending = client.get("/api/v1/precedents?status_filter=PENDING_SECOND_REVIEW", headers=reviewer_headers)
    assert pending.status_code == 200, pending.text
    proposed = next(item for item in pending.json() if item["id"] == body["proposed_precedent_id"])
    assert proposed["purpose"] == "Legal research"

    before_approval = evaluate(
        client,
        legal_headers,
        "Help me prepare a summary of the public Project Aurora launch notes.",
    ).json()
    assert before_approval["action"] == "REVIEW"
    assert before_approval["precedent_id"] is None

    approved = client.post(
        f"/api/v1/precedents/{body['proposed_precedent_id']}/second-approval",
        headers=second_reviewer_headers,
        json={
            "approved": True,
            "justification": "Independent reviewer confirmed the repeated public-context pattern is safely bounded.",
        },
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "ACTIVE"

    reused = evaluate(
        client,
        legal_headers,
        "Help me prepare a summary of the public Project Aurora launch notes.",
    ).json()
    assert reused["action"] == "ALLOW"
    assert reused["learning_source"] == "ACE_PRECEDENT"
    assert reused["precedent_id"] == body["proposed_precedent_id"]


def test_private_model_candidate_gates_promotion_and_rollback(client, policy_headers):
    digest = hashlib.sha256(b"authorised-balanced-deidentified-dataset").hexdigest()
    job = client.post("/api/v1/learning/model-jobs", headers=policy_headers, json={
        "model_name": "ghst-private-test-adapter-v1", "base_model": "Qwen/Qwen3-4B", "backend": "QLORA",
        "dataset_digest": digest, "output_path": "artifacts/ghst-private-test-adapter-v1",
        "config": {"rank": 16, "quantization": "NF4"},
        "report": {"trained": True, "deidentified": True, "balanced": True, "examples": 100},
    })
    assert job.status_code == 200, job.text
    candidate = client.post(f"/api/v1/learning/model-jobs/{job.json()['id']}/candidate", headers=policy_headers)
    assert candidate.status_code == 200, candidate.text
    model_id = candidate.json()["id"]
    evaluated = client.post(f"/api/v1/learning/models/{model_id}/evaluate", headers=policy_headers, json={
        "held_out_recall": 0.97, "macro_f1": 0.9, "schema_validity": 0.99,
        "secret_false_allows": 0, "adversarial_passed": True, "regression_passed": True,
        "median_latency_ms": 1200, "memory_gb": 5.1, "evaluation_dataset_digest": digest,
    })
    assert evaluated.status_code == 200 and evaluated.json()["status"] == "EVALUATED"
    shadow = client.post(f"/api/v1/learning/models/{model_id}/shadow", headers=policy_headers, json={"justification": "Every mandatory evaluation gate passed."})
    assert shadow.status_code == 200 and shadow.json()["status"] == "SHADOW"
    promoted = client.post(f"/api/v1/learning/models/{model_id}/promote", headers=policy_headers, json={"justification": "Authorised after reviewing shadow evidence."})
    assert promoted.status_code == 200 and promoted.json()["status"] == "PRODUCTION"
    rolled_back = client.post(f"/api/v1/learning/models/{model_id}/rollback", headers=policy_headers, json={"justification": "Exercise the preserved rollback control."})
    assert rolled_back.status_code == 200
    assert rolled_back.json()["restored"]["status"] == "PRODUCTION"


def test_private_training_dataset_is_balanced_and_deidentified():
    dataset = Path(__file__).parents[2] / "data" / "private_training_examples.json"
    examples, digest = load_governed_dataset(dataset)
    assert len(examples) == 10
    assert len(digest) == 64


def test_usability_evidence_calculates_completion_and_sus(client, legal_headers, auditor_headers):
    submission = client.post("/api/v1/usability/responses", headers=legal_headers, json={
        "task_results": [
            {"task_id": f"task-{index}", "completed": True, "duration_seconds": 20 + index, "errors": 0}
            for index in range(1, 6)
        ],
        "sus_answers": [5, 1, 5, 1, 5, 1, 5, 1, 5, 1],
    })
    assert submission.status_code == 200, submission.text
    assert submission.json()["task_completion_rate"] == 1.0
    assert submission.json()["sus_score"] == 100.0
    summary = client.get("/api/v1/usability/summary", headers=auditor_headers)
    assert summary.status_code == 200
    assert summary.json()["targets_met"] is True


def test_real_downstream_requires_https_and_explicit_credential():
    insecure = Settings(
        downstream_mode="real", downstream_base_url="http://provider.example",
        downstream_api_key="synthetic-test-key",
    )
    try:
        downstream_adapter(insecure)
        raise AssertionError("An HTTP downstream must not be accepted.")
    except DownstreamError:
        pass
    missing_key = Settings(downstream_mode="real", downstream_base_url="https://provider.example")
    try:
        downstream_adapter(missing_key)
        raise AssertionError("A real downstream without a credential must not be accepted.")
    except DownstreamError:
        pass


def test_production_compose_isolates_local_model_and_terminates_tls():
    import yaml
    compose = yaml.safe_load((Path(__file__).parents[2] / "docker-compose.production.yml").read_text())
    assert compose["networks"]["governance_internal"]["internal"] is True
    assert compose["services"]["ollama"]["networks"] == ["governance_internal"]
    assert "controlled_egress" in compose["services"]["api"]["networks"]
    assert compose["services"]["edge"]["ports"] == ["443:443"]
