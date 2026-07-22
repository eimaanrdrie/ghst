import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import canonical_text, encrypted_review_payload, prompt_digest
from app.db.models import Destination, Evaluation, FindingRecord, ModelVersion, PolicyMatchRecord, Review, User
from app.services.ace import find_matching_precedent, semantic_signature
from app.services.audit import append_audit
from app.services.calibration import calibrated_settings
from app.services.detectors import detect, redact_text
from app.services.policy import (
    active_policy_version,
    active_policy_versions,
    fallback_review_policy_match,
    retrieve_policies,
    strictest_action,
)
from app.services.semantic import ContextAssessment, LocalModelClient, lightweight_semantic
from app.services.session_risk import analyse_session_fragments


def evaluate(
    db: Session,
    *,
    user: User,
    prompt: str,
    purpose: str,
    destination_origin: str,
    session_id: str,
    settings: Settings,
    file_text: str | None = None,
    file_error: str | None = None,
    parent_evaluation_id: str | None = None,
) -> tuple[Evaluation, Review | None, str | None]:
    settings = calibrated_settings(db, user.organisation_id, settings)
    prompt = canonical_text(prompt)
    if len(prompt) > settings.max_prompt_chars:
        raise ValueError(f"Prompt exceeds the configured {settings.max_prompt_chars:,}-character limit.")
    if not prompt and not file_text and not file_error:
        raise ValueError("Enter a prompt or attach a supported text-based PDF.")

    combined = prompt + (("\n[ATTACHED PDF]\n" + file_text) if file_text else "")
    destination = db.scalar(
        select(Destination).where(
            Destination.organisation_id == user.organisation_id,
            Destination.origin == destination_origin,
            Destination.trust_status == "APPROVED",
        )
    )
    prompt_findings = detect(prompt, "PROMPT") if prompt else []
    file_findings = detect(file_text, "FILE") if file_text else []
    session_findings = analyse_session_fragments(
        db,
        user=user,
        session_id=session_id,
        text=combined,
        settings=settings,
    )
    findings = _dedupe(prompt_findings + file_findings + session_findings)
    semantic_router = lightweight_semantic(combined, purpose, findings)
    assessment = _default_assessment(purpose)
    if semantic_router["requires_local_model"]:
        production_model = db.scalar(select(ModelVersion).where(
            ModelVersion.organisation_id == user.organisation_id,
            ModelVersion.status == "PRODUCTION",
            ModelVersion.adapter_type.in_(["QLORA", "LORA", "BASE"]),
        ).order_by(ModelVersion.deployed_at.desc()))
        assessment = LocalModelClient(
            settings,
            primary_model=production_model.model_name if production_model else settings.local_model,
        ).assess(combined, purpose, findings)

    role_context = "EMPLOYEE"
    data_class = next((item["category"] for item in findings if item["confirmed"]), "PUBLIC_OR_INTERNAL_SAFE")
    precedent_data_class = assessment.data_class if findings and not any(item["confirmed"] for item in findings) else data_class
    matches = retrieve_policies(
        db,
        user.organisation_id,
        user.department,
        user.roles,
        purpose,
        combined,
        data_class=data_class,
        destination_origin=destination_origin,
        destination_service=destination.service if destination else None,
    )
    if (
        (findings or assessment.abstained or assessment.confidence < settings.local_model_confidence_threshold)
        and not any(item["action"] in {"BLOCK", "REVIEW", "REDIRECT", "REDACT"} for item in matches)
    ):
        fallback_match = fallback_review_policy_match(db, user.organisation_id, user.department)
        if fallback_match and all(item["clause_id"] != fallback_match["clause_id"] for item in matches):
            matches = [fallback_match, *matches]
    risk_score, risk_level = _risk(findings, destination is not None, semantic_router, assessment, file_error)
    policy_version_id = active_policy_version(matches)
    policy_version_ids = active_policy_versions(matches)
    signature = semantic_signature(combined, settings)
    precedent = None
    similarity = 0.0
    if destination and matches and _only_unconfirmed(findings) and not file_error:
        precedent, similarity = find_matching_precedent(
            db,
            organisation_id=user.organisation_id,
            department=user.department,
            role_context=role_context,
            purpose=purpose,
            data_class=precedent_data_class,
            impact_class=semantic_router["organisation_defined_class"],
            ai_service=destination.service,
            tenant=destination.tenant,
            risk_score=risk_score,
            policy_version_ids=policy_version_ids,
            signature=signature,
            settings=settings,
        )

    action, state, reason_codes, message, redirect = _decide(
        findings=findings,
        destination=destination,
        matches=matches,
        assessment=assessment,
        file_error=file_error,
        precedent=precedent,
        settings=settings,
    )
    if precedent:
        precedent.reuse_count += 1
        if precedent.reuse_count >= precedent.reuse_limit:
            precedent.status = "EXHAUSTED"

    evaluation = Evaluation(
        session_id=session_id or secrets.token_urlsafe(12),
        user_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        role_context=role_context,
        purpose=purpose,
        destination_id=destination.id if destination else None,
        destination_origin=destination_origin,
        prompt_hmac=prompt_digest(combined, settings),
        state=state,
        action=action,
        risk_score=risk_score,
        risk_level=risk_level,
        uncertainty=assessment.uncertainty,
        findings=findings,
        policy_matches=matches,
        reason_codes=reason_codes,
        message=message,
        model_evidence={
            "semantic_router": semantic_router,
            "local_model": assessment.model_dump(),
            "detector_version": "ghst-dlp-v1.0.0",
            "ace_similarity": round(similarity, 4),
        },
        learning_source="ACE_PRECEDENT" if precedent else "POLICY",
        precedent_id=precedent.id if precedent else None,
        parent_evaluation_id=parent_evaluation_id,
        updated_at=datetime.now(UTC),
    )
    db.add(evaluation)
    db.flush()
    for item in findings:
        db.add(FindingRecord(
            evaluation_id=evaluation.id,
            category=item["category"],
            severity=item["severity"],
            detector=item["detector"],
            confidence=item["confidence"],
            source=item["source"],
            location={"start": item["start"], "end": item["end"]},
        ))
    for rank, item in enumerate(matches, start=1):
        db.add(PolicyMatchRecord(
            evaluation_id=evaluation.id,
            clause_id=item["clause_id"],
            rank=rank,
            score=item["score"],
            reason="Hybrid metadata, lexical and hashed character-ngram semantic retrieval",
        ))

    review = None
    if action == "REVIEW":
        review = Review(
            evaluation_id=evaluation.id,
            requested_by=user.id,
            organisation_id=user.organisation_id,
            department=user.department,
            severity=risk_level,
            encrypted_payload=encrypted_review_payload(
                {
                    "prompt": combined,
                    "purpose": purpose,
                    "destination_origin": destination_origin,
                    "findings": findings,
                    "policy_matches": matches,
                    "model_evidence": evaluation.model_evidence,
                },
                settings,
            ),
            semantic_signature=signature,
            expires_at=datetime.now(UTC) + timedelta(seconds=settings.review_ttl_seconds),
        )
        db.add(review)
        db.flush()

    append_audit(
        db,
        event_type="EVALUATION_DECIDED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="EVALUATION",
        entity_id=evaluation.id,
        payload={
            "action": action,
            "risk_level": risk_level,
            "reason_codes": reason_codes,
            "policy_version_id": policy_version_id,
            "finding_categories": sorted({f["category"] for f in findings}),
            "model_name": assessment.model_name,
            "model_source": assessment.source,
            "precedent_id": evaluation.precedent_id,
            "prompt_hmac": evaluation.prompt_hmac,
        },
    )
    db.commit()
    return evaluation, review, redirect


def response_for(
    evaluation: Evaluation,
    review: Review | None = None,
    redirect_origin: str | None = None,
    redacted_text_value: str | None = None,
) -> dict:
    return {
        "evaluation_id": evaluation.id,
        "state": evaluation.state,
        "action": evaluation.action,
        "department": evaluation.department,
        "purpose": evaluation.purpose,
        "destination_origin": evaluation.destination_origin,
        "risk": {
            "score": evaluation.risk_score,
            "level": evaluation.risk_level,
            "uncertainty": evaluation.uncertainty,
        },
        "findings": evaluation.findings,
        "policy_matches": evaluation.policy_matches,
        "reason_codes": evaluation.reason_codes,
        "learning_source": evaluation.learning_source,
        "precedent_id": evaluation.precedent_id,
        "message": evaluation.message,
        "review_id": review.id if review else None,
        "redirect_origin": redirect_origin,
        "redacted_text": redacted_text_value,
        "model_evidence": evaluation.model_evidence,
        "created_at": evaluation.created_at,
    }


def create_redacted_candidate(prompt: str) -> str:
    return redact_text(canonical_text(prompt), detect(canonical_text(prompt), "PROMPT"))


def _decide(*, findings, destination, matches, assessment, file_error, precedent, settings):
    if file_error:
        return "BLOCK", "BLOCKED", ["CLASSIFICATION_UNAVAILABLE", "FAIL_CLOSED"], file_error, None
    if not matches:
        return "BLOCK", "ERROR_CLOSED", ["NO_ACTIVE_POLICY", "FAIL_CLOSED"], (
            "Active policy evidence is unavailable, so external release is disabled."
        ), None
    policy_actions = [item["action"] for item in matches]
    secrets_found = any(f["category"] == "AUTHENTICATION_SECRETS" for f in findings)
    if secrets_found:
        return "BLOCK", "BLOCKED", ["AUTHENTICATION_SECRET", "HARD_PROHIBITION", "NO_BYPASS"], (
            "An authentication secret was detected. Remove and rotate the exposed credential before continuing."
        ), None
    prompt_attack_found = any(f["category"] == "PROMPT_INJECTION" for f in findings)
    if prompt_attack_found:
        return "BLOCK", "BLOCKED", ["PROMPT_INJECTION", "HARD_PROHIBITION", "NO_BYPASS"], (
            "A prompt-injection or safety-bypass request was detected and cannot be released."
        ), None
    destination_switch_found = any(f["category"] == "UNAPPROVED_AI_DESTINATION" for f in findings)
    if destination_switch_found:
        return "REDIRECT", "REDIRECT_REQUIRED", ["UNAPPROVED_DESTINATION", "APPROVED_ALTERNATIVE_AVAILABLE"], (
            "This request names an unapproved external AI destination. Use the approved GHST destination instead."
        ), settings.approved_destination_origin
    confirmed = [f for f in findings if f["confirmed"]]
    if any(f["category"] in {"CONFIDENTIAL_BUSINESS_IP", "REGULATED_RECORDS"} for f in confirmed):
        return "BLOCK", "BLOCKED", ["CONFIRMED_SENSITIVE_DATA", "ZERO_SENSITIVE_DATA_EGRESS"], (
            "Confirmed restricted information cannot be sent to an employee-facing external AI service."
        ), None
    if confirmed:
        if all(f["redactable"] and f["source"] == "PROMPT" for f in confirmed):
            return "REDACT", "REDACTION_REQUIRED", ["SENSITIVE_DATA", "SAFE_REDACTION_AVAILABLE"], (
                "Sensitive values were detected. Apply typed redaction and run a complete rescan."
            ), None
        return "BLOCK", "BLOCKED", ["SENSITIVE_FILE_DATA", "ZERO_SENSITIVE_DATA_EGRESS"], (
            "Sensitive attached content cannot be released. Remove the file or use an internal workflow."
        ), None
    if destination is None:
        policy_actions.append("REDIRECT")
    if precedent:
        policy_floor = strictest_action(policy_actions, default="BLOCK")
        ace_action = precedent.control if precedent.control in {"ALLOW", "REDACT", "REDIRECT", "REVIEW", "BLOCK"} else "REVIEW"
        action = strictest_action([policy_floor, ace_action], default="REVIEW") if policy_floor in {"BLOCK", "REDACT", "REDIRECT"} else ace_action
        state = {"ALLOW": "ALLOWED", "REDACT": "REDACTION_REQUIRED", "REDIRECT": "REDIRECT_REQUIRED", "REVIEW": "REVIEW_PENDING", "BLOCK": "BLOCKED"}[action]
        return action, state, ["ACE_PRECEDENT_REUSED", "BOUNDED_CONTEXT_MATCH"], (
            "A valid human-authorised precedent applies, but it cannot weaken the active verified policy set."
        ), None
    if findings or assessment.abstained or assessment.confidence < settings.local_model_confidence_threshold:
        policy_actions.append("REVIEW")
    action = strictest_action(policy_actions, default="BLOCK")
    if action == "BLOCK":
        return "BLOCK", "BLOCKED", ["POLICY_BLOCK", "ACTIVE_POLICY_ENFORCED"], (
            "A verified active policy clause blocks this request."
        ), None
    if action == "REVIEW":
        return "REVIEW", "REVIEW_PENDING", ["AMBIGUOUS_CONTEXT", "HUMAN_AUTHORITY_REQUIRED"], (
            "The context is ambiguous or policy-governed for human review. The request is held for an authorised departmental reviewer."
        ), None
    if action == "REDIRECT":
        return "REDIRECT", "REDIRECT_REQUIRED", ["UNAPPROVED_DESTINATION", "APPROVED_ALTERNATIVE_AVAILABLE"], (
            "This destination is not approved. Use the organisation-approved AI sandbox instead."
        ), settings.approved_destination_origin
    if action == "REDACT":
        return "REDACT", "REDACTION_REQUIRED", ["SENSITIVE_DATA", "SAFE_REDACTION_AVAILABLE"], (
            "A verified policy clause requires redaction before release."
        ), None
    return "ALLOW", "ALLOWED", ["NO_SENSITIVE_DATA", "APPROVED_DESTINATION", "POLICY_COMPLIANT"], (
        "Verified policy evidence allows this request at the approved destination."
    ), None


def _risk(findings, destination_approved, semantic, assessment, file_error):
    sensitivity = 0.0
    weights = {
        "PERSONAL_DATA": 0.65,
        "FINANCIAL_DATA": 0.85,
        "AUTHENTICATION_SECRETS": 1.0,
        "CONFIDENTIAL_BUSINESS_IP": 0.8,
        "REGULATED_RECORDS": 0.9,
        "PROMPT_INJECTION": 1.0,
        "HIGH_IMPACT_DECISION": 0.8,
        "UNAPPROVED_AI_DESTINATION": 0.75,
    }
    for finding in findings:
        value = weights.get(finding["category"], 0.5)
        if not finding["confirmed"]:
            value *= 0.55
        sensitivity = max(sensitivity, value)
    destination_risk = 0 if destination_approved else 1
    use_case = 0.9 if semantic["high_impact"] else 0.1
    policy_conflict = 0.9 if findings else 0.0
    uncertainty = 1.0 if file_error else assessment.uncertainty
    score = min(1.0, 0.38 * sensitivity + 0.2 * destination_risk + 0.14 * use_case + 0.18 * policy_conflict + 0.1 * uncertainty)
    categories = {finding["category"] for finding in findings}
    if categories & {"AUTHENTICATION_SECRETS", "PROMPT_INJECTION"}:
        score = max(score, 0.9)
    elif "HIGH_IMPACT_DECISION" in categories:
        score = max(score, 0.65)
    elif "UNAPPROVED_AI_DESTINATION" in categories:
        score = max(score, 0.6)
    score = round(score, 4)
    level = "CRITICAL" if score >= 0.8 else "HIGH" if score >= 0.6 else "MEDIUM" if score >= 0.3 else "LOW"
    return score, level


def _only_unconfirmed(findings):
    return bool(findings) and not any(item["confirmed"] for item in findings)


def _dedupe(findings):
    found = {}
    severity = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
    for item in findings:
        key = (item["category"], item["source"], item["start"], item["end"])
        if key not in found or severity[item["severity"]] > severity[found[key]["severity"]]:
            found[key] = item
    return sorted(found.values(), key=lambda x: (x["source"], x["start"]))


def _default_assessment(purpose):
    return ContextAssessment(
        data_class="PUBLIC_OR_INTERNAL_SAFE",
        use_case=purpose,
        confidence=0.95,
        uncertainty=0.05,
        abstained=False,
        model_name="not-invoked-rule-first-cascade",
        source="DEMO_ADAPTER",
    )
