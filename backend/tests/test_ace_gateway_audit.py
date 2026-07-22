from tests.conftest import login
from tests.test_governance import DEST, evaluate


def create_precedent(client, legal_headers, reviewer_headers):
    # Each scenario starts without an active matching precedent so the human-review path is exercised.
    existing = client.get("/api/v1/precedents?status_filter=ACTIVE", headers=reviewer_headers)
    assert existing.status_code == 200
    for precedent in existing.json():
        client.post(f"/api/v1/precedents/{precedent['id']}/revoke", headers=reviewer_headers)
    evaluation = evaluate(client, legal_headers, "Summarise the public launch notes for Project Aurora.").json()
    assert evaluation["action"] == "REVIEW"
    review = client.get(f"/api/v1/reviews/{evaluation['review_id']}", headers=reviewer_headers)
    assert review.status_code == 200
    decision = client.post(
        f"/api/v1/reviews/{evaluation['review_id']}/decision",
        headers=reviewer_headers,
        json={
            "decision": "ALLOW",
            "justification": "Public launch context confirmed; no restricted information is present.",
            "create_precedent": True,
            "precedent_scope": {
                "role_context": "EMPLOYEE",
                "purpose": "Legal research",
                "data_class": "CONFIDENTIAL_BUSINESS_IP",
                "risk_ceiling": 0.5,
                "control": "ALLOW",
                "reuse_limit": 50,
                "validity_days": 90,
            },
        },
    )
    assert decision.status_code == 200, decision.text
    return decision.json()["precedent_id"]


def test_ace_reuses_equivalent_legal_context_but_not_finance(client, legal_headers, finance_headers, reviewer_headers):
    precedent_id = create_precedent(client, legal_headers, reviewer_headers)
    equivalent = evaluate(client, legal_headers, "Please create a summary of the public Project Aurora launch notes.").json()
    assert equivalent["action"] == "ALLOW"
    assert equivalent["learning_source"] == "ACE_PRECEDENT"
    assert equivalent["precedent_id"] == precedent_id
    changed_department = evaluate(client, finance_headers, "Please create a summary of the public Project Aurora launch notes.", purpose="Legal research").json()
    assert changed_department["action"] == "REVIEW"
    assert changed_department["learning_source"] != "ACE_PRECEDENT"


def test_revoke_precedent_disables_reuse(client, legal_headers, reviewer_headers):
    precedent_id = create_precedent(client, legal_headers, reviewer_headers)
    revoked = client.post(f"/api/v1/precedents/{precedent_id}/revoke", headers=reviewer_headers)
    assert revoked.status_code == 200
    next_eval = evaluate(client, legal_headers, "Please summarize the public Project Aurora launch notes.").json()
    assert next_eval["action"] == "REVIEW"


def test_clearance_grant_fast_path_and_replay_block(client, legal_headers):
    prompt = "Summarise the public Federal Court decision for legal research."
    evaluation = evaluate(client, legal_headers, prompt).json()
    grant = client.post(
        f"/api/v1/evaluations/{evaluation['evaluation_id']}/clearance-grant",
        headers=legal_headers,
        json={"prompt": prompt, "device_id": "test-device"},
    )
    assert grant.status_code == 200, grant.text
    payload = {"model": "mock-approved-model", "messages": [{"role": "user", "content": prompt}], "clearance_grant": grant.json()["clearance_grant"], "device_id": "test-device"}
    accepted = client.post("/api/v1/gateway/v1/chat/completions", headers=legal_headers, json=payload)
    assert accepted.status_code == 200
    assert accepted.json()["governance"]["status"] == "VERIFIED"
    replay = client.post("/api/v1/gateway/v1/chat/completions", headers=legal_headers, json=payload)
    assert replay.status_code == 403


def test_modified_prompt_rejected_before_grant(client, legal_headers):
    evaluation = evaluate(client, legal_headers, "Summarise the public decision.").json()
    grant = client.post(
        f"/api/v1/evaluations/{evaluation['evaluation_id']}/clearance-grant",
        headers=legal_headers,
        json={"prompt": "Summarise a different decision.", "device_id": "test-device"},
    )
    assert grant.status_code == 409


def test_audit_chain_verifies_and_raw_prompt_is_absent(client, legal_headers, auditor_headers):
    secret = "sk-neverPersistThisSecret1234567890"
    evaluate(client, legal_headers, f"Debug {secret}")
    events = client.get("/api/v1/audit/events", headers=auditor_headers).json()
    assert secret not in str(events)
    verified = client.post("/api/v1/audit/verify", headers=auditor_headers)
    assert verified.status_code == 200
    assert verified.json()["valid"] is True
