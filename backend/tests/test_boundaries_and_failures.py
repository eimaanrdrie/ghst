import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import AuditEvent, Policy, Precedent
from app.db.session import SessionLocal
from tests.test_ace_gateway_audit import create_precedent
from tests.test_governance import DEST, evaluate


def test_same_department_changed_purpose_cannot_reuse(client, legal_headers, reviewer_headers):
    create_precedent(client, legal_headers, reviewer_headers)
    result = evaluate(
        client,
        legal_headers,
        "Please create a summary of the public Project Aurora launch notes.",
        purpose="Routine drafting",
    ).json()
    assert result["action"] == "REVIEW"
    assert result["precedent_id"] is None


def test_risk_ceiling_and_expiry_disable_reuse(client, legal_headers, reviewer_headers):
    precedent_id = create_precedent(client, legal_headers, reviewer_headers)
    with SessionLocal() as db:
        precedent = db.get(Precedent, precedent_id)
        precedent.risk_ceiling = 0.01
        db.commit()
    over_ceiling = evaluate(client, legal_headers, "Please create a summary of the public Project Aurora launch notes.").json()
    assert over_ceiling["action"] == "REVIEW"
    with SessionLocal() as db:
        precedent = db.get(Precedent, precedent_id)
        precedent.risk_ceiling = 1.0
        precedent.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        precedent.status = "ACTIVE"
        db.commit()
    expired = evaluate(client, legal_headers, "Please create a summary of the public Project Aurora launch notes.").json()
    assert expired["action"] == "REVIEW"


def test_policy_activation_invalidates_affected_precedent(client, legal_headers, reviewer_headers, policy_headers):
    precedent_id = create_precedent(client, legal_headers, reviewer_headers)
    with SessionLocal() as db:
        precedent = db.get(Precedent, precedent_id)
        old_version_id = precedent.policy_version_id
        policy = db.scalar(select(Policy).join(Policy.versions).where(Policy.versions.any(id=old_version_id)))
        policy_id = policy.id
    version_name = f"NEXT-{precedent_id[-6:]}"
    created = client.post(
        f"/api/v1/policies/{policy_id}/versions",
        headers=policy_headers,
        json={"version": version_name, "clauses": [{"department": "ALL", "roles": [], "purposes": [], "clause_ref": "9.1", "text": "Novel organisation-specific requests require a fresh authorised human review under this version.", "action": "REVIEW"}]},
    )
    assert created.status_code == 200, created.text
    activated = client.post(f"/api/v1/policies/{policy_id}/versions/{version_name}/activate", headers=policy_headers)
    assert activated.status_code == 200
    assert activated.json()["invalidated_precedents"] >= 1
    with SessionLocal() as db:
        assert db.get(Precedent, precedent_id).status == "INVALIDATED_BY_POLICY"


def test_local_model_unavailability_fails_ambiguous_case_to_review(client, legal_headers):
    settings = get_settings()
    previous_demo, previous_url = settings.demo_mode, settings.ollama_url
    settings.demo_mode = False
    settings.ollama_url = "http://127.0.0.1:9"
    try:
        result = evaluate(client, legal_headers, "Summarise the public launch notes for Project Meridian.").json()
        assert result["action"] == "REVIEW"
        assert result["model_evidence"]["local_model"]["source"] == "UNAVAILABLE"
    finally:
        settings.demo_mode, settings.ollama_url = previous_demo, previous_url


def test_policy_store_unavailable_disables_external_release(client, legal_headers):
    with SessionLocal() as db:
        policies = list(db.scalars(select(Policy)))
        previous = {item.id: item.status for item in policies}
        for item in policies:
            item.status = "RETIRED"
        db.commit()
    try:
        result = evaluate(client, legal_headers, "Summarise this public court decision.").json()
        assert result["action"] == "BLOCK"
        assert result["state"] == "ERROR_CLOSED"
        assert "NO_ACTIVE_POLICY" in result["reason_codes"]
    finally:
        with SessionLocal() as db:
            for item in db.scalars(select(Policy)):
                item.status = previous[item.id]
            db.commit()


def test_missing_clearance_grant_is_blocked(client, legal_headers):
    response = client.post(
        "/api/v1/gateway/v1/chat/completions",
        headers=legal_headers,
        json={"model": "mock-approved-model", "messages": [{"role": "user", "content": "public prompt"}], "device_id": "test-device"},
    )
    assert response.status_code == 403


def test_audit_verifier_detects_tampering(client, legal_headers, auditor_headers):
    evaluate(client, legal_headers, "Summarise another public decision.")
    with SessionLocal() as db:
        event = db.scalar(select(AuditEvent).order_by(AuditEvent.sequence.desc()))
        original = dict(event.payload)
        event.payload = {**original, "action": "TAMPERED"}
        db.commit()
    broken = client.post("/api/v1/audit/verify", headers=auditor_headers).json()
    assert broken["valid"] is False
    assert broken["first_broken_sequence"] is not None
    with SessionLocal() as db:
        event = db.scalar(select(AuditEvent).order_by(AuditEvent.sequence.desc()))
        event.payload = original
        db.commit()
    assert client.post("/api/v1/audit/verify", headers=auditor_headers).json()["valid"] is True


def test_extension_is_allowlisted_not_global():
    manifest = json.loads((Path(__file__).parents[2] / "extension" / "manifest.json").read_text())
    matches = manifest["content_scripts"][0]["matches"]
    assert "<all_urls>" not in matches
    assert matches == ["http://localhost:3000/ai-sandbox*", "https://chatgpt.com/*", "https://chat.openai.com/*"]
