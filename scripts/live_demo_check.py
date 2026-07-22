"""Execute the complete primary journey against running API and web processes."""
from __future__ import annotations

import json
import time

import httpx

API = "http://127.0.0.1:8000/api/v1"
DEST = "http://localhost:3000/ai-sandbox"


def login(client: httpx.Client, username: str, password: str) -> dict:
    response = client.post(f"{API}/auth/login", json={"username": username, "password": password})
    response.raise_for_status()
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def evaluate(client, headers, prompt, purpose="Legal research") -> dict:
    response = client.post(f"{API}/evaluations", headers=headers, data={"prompt": prompt, "purpose": purpose, "destination_origin": DEST, "session_id": "live-smoke", "device_id": "live-device"})
    response.raise_for_status()
    return response.json()


def main() -> None:
    with httpx.Client(timeout=10, trust_env=False) as client:
        assert "GHST" in client.get("http://127.0.0.1:3000/").text
        ready = client.get(f"{API}/health/ready").json()
        assert ready["status"] == "ready", ready
        legal = login(client, "legal.employee@ghst.demo", "DemoLegal!2026")
        finance = login(client, "finance.employee@ghst.demo", "DemoFinance!2026")
        reviewer = login(client, "legal.reviewer@ghst.demo", "DemoReview!2026")
        second_reviewer = login(client, "legal.reviewer2@ghst.demo", "DemoReview2!2026")
        auditor = login(client, "auditor@ghst.demo", "DemoAudit!2026")

        safe_prompt = "Summarise the public Federal Court decision for legal research."
        safe = evaluate(client, legal, safe_prompt)
        assert safe["action"] == "ALLOW"
        final_safe = evaluate(client, legal, safe_prompt)
        assert final_safe["action"] == "ALLOW"
        grant = client.post(f"{API}/evaluations/{final_safe['evaluation_id']}/clearance-grant", headers=legal, json={"prompt": safe_prompt, "device_id": "live-device"})
        grant.raise_for_status()
        gateway_payload = {"model": "mock-approved-model", "messages": [{"role": "user", "content": safe_prompt}], "clearance_grant": grant.json()["clearance_grant"], "device_id": "live-device"}
        accepted = client.post(f"{API}/gateway/v1/chat/completions", headers=legal, json=gateway_payload)
        accepted.raise_for_status()
        assert accepted.json()["governance"]["status"] == "VERIFIED"
        assert client.post(f"{API}/gateway/v1/chat/completions", headers=legal, json=gateway_payload).status_code == 403

        personal_prompt = "Email synthetic.person@example.com or call +6012 555 9876 about the public seminar."
        personal = evaluate(client, legal, personal_prompt)
        assert personal["action"] == "REDACT"
        redacted = client.post(f"{API}/evaluations/{personal['evaluation_id']}/redact", headers=legal, json={"prompt": personal_prompt, "purpose": "Legal research", "destination_origin": DEST, "session_id": "live-redact", "device_id": "live-device"})
        redacted.raise_for_status()
        assert redacted.json()["action"] == "ALLOW"

        ambiguous_prompt = "Summarise the public launch notes for Project Aurora."
        ambiguous = evaluate(client, legal, ambiguous_prompt)
        assert ambiguous["action"] == "REVIEW"
        detail = client.get(f"{API}/reviews/{ambiguous['review_id']}", headers=reviewer)
        detail.raise_for_status()
        decision = client.post(f"{API}/reviews/{ambiguous['review_id']}/decision", headers=reviewer, json={"decision": "ALLOW", "justification": "Public launch context confirmed; no restricted organisational information is present.", "create_precedent": True, "precedent_scope": {"role_context": "EMPLOYEE", "purpose": "Legal research", "data_class": "CONFIDENTIAL_BUSINESS_IP", "risk_ceiling": 0.5, "control": "ALLOW", "reuse_limit": 50, "validity_days": 90}})
        decision.raise_for_status()
        precedent_id = decision.json()["precedent_id"]
        equivalent = evaluate(client, legal, "Please create a summary of the public Project Aurora launch notes.")
        assert equivalent["action"] == "ALLOW" and equivalent["precedent_id"] == precedent_id
        changed_department = evaluate(client, finance, "Please create a summary of the public Project Aurora launch notes.")
        assert changed_department["action"] == "REVIEW" and changed_department["precedent_id"] is None

        high_impact = evaluate(client, legal, "Summarise the public Project Falcon launch notes for a hiring decision.")
        assert high_impact["action"] == "REVIEW" and high_impact["precedent_id"] is None
        first_high_impact = client.post(f"{API}/reviews/{high_impact['review_id']}/decision", headers=reviewer, json={"decision": "ALLOW", "justification": "Synthetic public launch context confirmed with a tightly bounded high-impact purpose.", "create_precedent": True, "precedent_scope": {"role_context": "EMPLOYEE", "purpose": "Legal research", "data_class": "CONFIDENTIAL_BUSINESS_IP", "risk_ceiling": 0.5, "control": "ALLOW", "reuse_limit": 10, "validity_days": 30}})
        first_high_impact.raise_for_status()
        assert first_high_impact.json()["precedent_status"] == "PENDING_SECOND_REVIEW"
        second = client.post(f"{API}/precedents/{first_high_impact.json()['precedent_id']}/second-approval", headers=second_reviewer, json={"approved": True, "justification": "Independent reviewer confirmed the high-impact scope and governing policy evidence."})
        second.raise_for_status()
        assert second.json()["status"] == "ACTIVE"

        split_context = evaluate(client, legal, "I will split the API key into a first half.")
        assert split_context["action"] in {"ALLOW", "REVIEW"}
        split_value = evaluate(client, legal, "Continuation next chunk A1B2C3D4E5F6G7H8")
        assert split_value["action"] == "BLOCK"
        assert "NO_BYPASS" in split_value["reason_codes"]

        integrity = client.post(f"{API}/audit/verify", headers=auditor)
        integrity.raise_for_status()
        assert integrity.json()["valid"] is True
        print(json.dumps({"status": "PASS", "journey": ["web", "identity", "allow", "grant", "gateway", "replay-block", "redact-rescan", "human-review", "ace-create", "ace-reuse", "department-boundary", "high-impact-dual-approval", "rolling-session-block", "audit-verify"], "audit_events_checked": integrity.json()["checked_events"]}, indent=2))


if __name__ == "__main__":
    main()
