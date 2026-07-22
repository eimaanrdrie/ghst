import hashlib
import json
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select

from app.db.base import Base
from app.db.models import (
    AuditEvent,
    CalibrationRecommendation,
    Destination,
    Evaluation,
    LearningArtefact,
    ModelVersion,
    PolicyVersion,
    Precedent,
    PrecedentApproval,
    Review,
    ReviewDelegation,
    SessionRiskState,
    UsabilityStudyResponse,
)
from app.db.seed import _policy_match, _user_id, seed_database
from app.db.session import SessionLocal, engine


def reset_and_seed_demo() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    _clear_local_policy_store()
    seed_database()
    with SessionLocal() as db:
        _seed_review_history_and_precedents(db)
        _seed_review_delegations(db)
        _seed_session_risk(db)
        _seed_usability(db)
        _seed_audit_history(db)
        db.commit()


def _clear_local_policy_store() -> None:
    root = Path(__file__).resolve().parents[2] / "private_policy_store"
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)


def _seed_review_history_and_precedents(db) -> None:
    destination = db.scalar(select(Destination).where(Destination.organisation_id == "org_ghst_demo"))
    destination_id = destination.id if destination else None
    destination_origin = destination.origin if destination else "https://chatgpt.com"
    legal_allow_match = _policy_match(db, "Enterprise Data Classification and AI Handling Policy", "3.7")
    review_match = _policy_match(db, "Human Review and Governance Precedent Policy", "5.1")
    redirect_match = _policy_match(db, "Approved AI Destinations Standard", "2.1")
    block_match = _policy_match(db, "Enterprise Data Classification and AI Handling Policy", "3.1")
    now = datetime.now(UTC)

    specs = [
        {
            "session_id": "legal_hist_001",
            "username": "legal.employee@ghst.demo",
            "department": "Legal",
            "purpose": "Public case digest",
            "action": "ALLOW",
            "risk_score": 0.24,
            "risk_level": "MEDIUM",
            "policy_matches": [legal_allow_match, redirect_match],
            "findings": [],
            "model_evidence": {"local_model": {"data_class": "PUBLIC_OR_INTERNAL_SAFE"}, "seeded": True},
            "signature": ["public-case-digest", "legal-research", "external-release-safe"],
            "reviewer": "legal.reviewer@ghst.demo",
            "note": "False positive confirmed; the request is limited to public legal material and the approved destination.",
            "minutes_ago": 620,
        },
        {
            "session_id": "legal_hist_002",
            "username": "legal.employee@ghst.demo",
            "department": "Legal",
            "purpose": "Public case digest",
            "action": "ALLOW",
            "risk_score": 0.28,
            "risk_level": "MEDIUM",
            "policy_matches": [legal_allow_match, redirect_match],
            "findings": [],
            "model_evidence": {"local_model": {"data_class": "PUBLIC_OR_INTERNAL_SAFE"}, "seeded": True},
            "signature": ["public-case-digest", "legal-research", "external-release-safe"],
            "reviewer": "legal.reviewer2@ghst.demo",
            "note": "The public-source legal digest stays within approved scope and destination controls.",
            "minutes_ago": 590,
        },
        {
            "session_id": "legal_hist_003",
            "username": "legal.employee@ghst.demo",
            "department": "Legal",
            "purpose": "Public case digest",
            "action": "ALLOW",
            "risk_score": 0.31,
            "risk_level": "MEDIUM",
            "policy_matches": [legal_allow_match, redirect_match],
            "findings": [],
            "model_evidence": {"local_model": {"data_class": "PUBLIC_OR_INTERNAL_SAFE"}, "seeded": True},
            "signature": ["public-case-digest", "legal-research", "external-release-safe"],
            "reviewer": "legal.reviewer@ghst.demo",
            "note": "Approved within the same bounded public-law pattern seen in prior reviewed cases.",
            "minutes_ago": 560,
        },
        {
            "session_id": "finance_hist_001",
            "username": "finance.employee@ghst.demo",
            "department": "Finance",
            "purpose": "Audit prep narrative",
            "action": "ALLOW",
            "risk_score": 0.22,
            "risk_level": "MEDIUM",
            "policy_matches": [redirect_match],
            "findings": [],
            "model_evidence": {"local_model": {"data_class": "PUBLIC_OR_INTERNAL_SAFE"}, "seeded": True},
            "signature": ["audit-prep", "published-results-only", "finance-safe"],
            "reviewer": "finance.reviewer@ghst.demo",
            "note": "No restricted finance information remains; external drafting support is acceptable.",
            "minutes_ago": 520,
        },
        {
            "session_id": "hr_hist_001",
            "username": "hr.employee@ghst.demo",
            "department": "Human Resources",
            "purpose": "Recruitment summary",
            "action": "BLOCK",
            "risk_score": 0.79,
            "risk_level": "HIGH",
            "policy_matches": [review_match, block_match],
            "findings": [{"category": "PERSONAL_DATA", "severity": "HIGH", "detector": "pii-redactor", "confidence": 0.94, "confirmed": True}],
            "model_evidence": {"semantic_router": {"organisation_defined_class": "HIGH_IMPACT", "high_impact": True}, "seeded": True},
            "signature": ["recruitment-summary", "candidate-profiles", "hiring-impact"],
            "reviewer": "legal.reviewer@ghst.demo",
            "note": "Confirmed personal and consequential employment content cannot be released externally.",
            "minutes_ago": 480,
        },
    ]

    items: dict[str, tuple[Evaluation, Review]] = {}
    for spec in specs:
        evaluation = db.scalar(select(Evaluation).where(Evaluation.session_id == spec["session_id"]))
        if not evaluation:
            evaluation = Evaluation(
                session_id=spec["session_id"],
                user_id=_user_id(db, spec["username"]),
                organisation_id="org_ghst_demo",
                department=spec["department"],
                role_context="EMPLOYEE",
                purpose=spec["purpose"],
                destination_id=destination_id,
                destination_origin=destination_origin,
                prompt_hmac=hashlib.sha256(spec["session_id"].encode()).hexdigest(),
                state=spec["action"],
                action=spec["action"],
                risk_score=spec["risk_score"],
                risk_level=spec["risk_level"],
                uncertainty=round(min(0.95, spec["risk_score"] / 2), 3),
                findings=spec["findings"],
                policy_matches=[item for item in spec["policy_matches"] if item],
                reason_codes=["SEEDED_HUMAN_REVIEW_HISTORY", f"REVIEW_{spec['action']}"],
                message=f"Seeded historical human decision: {spec['action']}.",
                model_evidence=spec["model_evidence"],
                learning_source="HUMAN_REVIEW",
            )
            db.add(evaluation)
            db.flush()
        evaluation.state = spec["action"]
        evaluation.action = spec["action"]
        evaluation.risk_score = spec["risk_score"]
        evaluation.risk_level = spec["risk_level"]
        evaluation.uncertainty = round(min(0.95, spec["risk_score"] / 2), 3)
        evaluation.findings = spec["findings"]
        evaluation.policy_matches = [item for item in spec["policy_matches"] if item]
        evaluation.reason_codes = ["SEEDED_HUMAN_REVIEW_HISTORY", f"REVIEW_{spec['action']}"]
        evaluation.message = f"Seeded historical human decision: {spec['action']}."
        evaluation.model_evidence = spec["model_evidence"]
        evaluation.learning_source = "HUMAN_REVIEW"
        evaluation.created_at = now - timedelta(minutes=spec["minutes_ago"] + 8)
        evaluation.updated_at = now - timedelta(minutes=spec["minutes_ago"])

        review = db.scalar(select(Review).where(Review.evaluation_id == evaluation.id))
        if not review:
            review = Review(
                evaluation_id=evaluation.id,
                requested_by=evaluation.user_id,
                organisation_id=evaluation.organisation_id,
                department=evaluation.department,
                status="DECIDED",
                severity=spec["risk_level"],
                encrypted_payload=None,
                semantic_signature=spec["signature"],
                expires_at=now - timedelta(minutes=max(1, spec["minutes_ago"] - 120)),
                created_at=now - timedelta(minutes=spec["minutes_ago"] + 5),
            )
            db.add(review)
            db.flush()
        review.status = "DECIDED"
        review.severity = spec["risk_level"]
        review.semantic_signature = spec["signature"]
        review.encrypted_payload = None
        review.reviewer_id = _user_id(db, spec["reviewer"])
        review.decision = spec["action"]
        review.justification = spec["note"]
        review.created_at = now - timedelta(minutes=spec["minutes_ago"] + 5)
        review.decided_at = now - timedelta(minutes=spec["minutes_ago"])
        review.expires_at = now - timedelta(minutes=max(1, spec["minutes_ago"] - 120))
        items[spec["session_id"]] = (evaluation, review)

    _upsert_precedent(
        db,
        source_review=items["legal_hist_001"][1],
        source_evaluation=items["legal_hist_001"][0],
        purpose=items["legal_hist_001"][0].purpose,
        signature=items["legal_hist_001"][1].semantic_signature,
        requested_by="legal.reviewer@ghst.demo",
        status="ACTIVE",
        artefact_status="ACTIVE",
        justification="Reusable public-law digest pattern approved for bounded legal research at the approved destination.",
        risk_ceiling=0.34,
        source_decision_ids=[items["legal_hist_001"][1].id],
    )
    _upsert_precedent(
        db,
        source_review=items["finance_hist_001"][1],
        source_evaluation=items["finance_hist_001"][0],
        purpose=items["finance_hist_001"][0].purpose,
        signature=items["finance_hist_001"][1].semantic_signature,
        requested_by="finance.reviewer@ghst.demo",
        status="REVOKED",
        artefact_status="REVOKED",
        justification="Previously allowed public-results narrative was later revoked after a scope tightening exercise.",
        risk_ceiling=0.3,
        source_decision_ids=[items["finance_hist_001"][1].id],
    )
    _upsert_precedent(
        db,
        source_review=items["legal_hist_003"][1],
        source_evaluation=items["legal_hist_003"][0],
        purpose=items["legal_hist_003"][0].purpose,
        signature=items["legal_hist_003"][1].semantic_signature,
        requested_by="legal.reviewer@ghst.demo",
        status="PENDING_SECOND_REVIEW",
        artefact_status="PROPOSED",
        justification="Auto-proposed from repeated authorised public-case digest reviews and waiting for an independent second reviewer.",
        risk_ceiling=0.36,
        source_decision_ids=[items["legal_hist_001"][1].id, items["legal_hist_002"][1].id, items["legal_hist_003"][1].id],
        add_pending_approval=True,
    )
    _upsert_precedent(
        db,
        source_review=items["legal_hist_002"][1],
        source_evaluation=items["legal_hist_002"][0],
        purpose="Regulation digest",
        signature=["regulation-digest", "public-law", "research-safe"],
        requested_by="legal.reviewer2@ghst.demo",
        status="PENDING_SECOND_REVIEW",
        artefact_status="PROPOSED",
        justification="Auto-proposed from similar public-law research decisions and awaiting independent approval.",
        risk_ceiling=0.33,
        source_decision_ids=[items["legal_hist_002"][1].id],
        add_pending_approval=True,
    )


def _upsert_precedent(
    db,
    *,
    source_review: Review,
    source_evaluation: Evaluation,
    purpose: str,
    signature: list[str],
    requested_by: str,
    status: str,
    artefact_status: str,
    justification: str,
    risk_ceiling: float,
    source_decision_ids: list[str],
    add_pending_approval: bool = False,
) -> None:
    precedent = db.scalar(select(Precedent).where(
        Precedent.source_review_id == source_review.id,
        Precedent.purpose == purpose,
    ))
    requested_by_id = _user_id(db, requested_by)
    now = datetime.now(UTC)
    if not precedent:
        precedent = Precedent(
            source_review_id=source_review.id,
            organisation_id=source_evaluation.organisation_id,
            department=source_evaluation.department,
            scope="DEPARTMENT",
            role_context=source_evaluation.role_context,
            purpose=purpose,
            data_class=_precedent_data_class(source_evaluation),
            impact_class=source_evaluation.model_evidence.get("semantic_router", {}).get("organisation_defined_class", "STANDARD"),
            ai_service="ChatGPT",
            tenant="chatgpt",
            risk_ceiling=risk_ceiling,
            control="ALLOW",
            policy_version_id=source_evaluation.policy_matches[0]["policy_version_id"],
            policy_version_ids=sorted({item["policy_version_id"] for item in source_evaluation.policy_matches}),
            reviewer_id=requested_by_id,
            justification=justification,
            fingerprint=hashlib.sha256("|".join(signature).encode()).hexdigest(),
            embedding=None,
            term_hashes=signature,
            expires_at=now + timedelta(days=60),
            reuse_limit=25,
            status=status,
            created_at=source_review.decided_at or now,
        )
        db.add(precedent)
        db.flush()
    precedent.data_class = _precedent_data_class(source_evaluation)
    precedent.impact_class = source_evaluation.model_evidence.get("semantic_router", {}).get("organisation_defined_class", "STANDARD")
    precedent.ai_service = "ChatGPT"
    precedent.tenant = "chatgpt"
    precedent.risk_ceiling = risk_ceiling
    precedent.status = status
    precedent.justification = justification
    precedent.reviewer_id = requested_by_id
    precedent.term_hashes = signature
    precedent.created_at = source_review.decided_at or now

    artefact = db.scalar(select(LearningArtefact).where(LearningArtefact.precedent_id == precedent.id))
    if not artefact:
        artefact = LearningArtefact(
            organisation_id=source_evaluation.organisation_id,
            artefact_type="ACE_PRECEDENT",
            source_decision_ids=source_decision_ids,
            version="AUTO-1.0" if artefact_status == "PROPOSED" else "1.0",
            status=artefact_status,
            approved_by=requested_by_id,
            precedent_id=precedent.id,
            provenance={},
            created_at=source_review.decided_at or now,
        )
        db.add(artefact)
    artefact.source_decision_ids = source_decision_ids
    artefact.status = artefact_status
    artefact.approved_by = requested_by_id
    artefact.provenance = {
        "department": source_evaluation.department,
        "reviewer_id": requested_by_id,
        "policy_version_id": precedent.policy_version_id,
        "model_weights_changed": False,
    }
    artefact.created_at = source_review.decided_at or now

    if add_pending_approval:
        approval = db.scalar(select(PrecedentApproval).where(PrecedentApproval.precedent_id == precedent.id))
        if not approval:
            approval = PrecedentApproval(
                precedent_id=precedent.id,
                requested_by=requested_by_id,
                status="PENDING",
                justification="AI-proposed precedent requires independent approval before activation.",
                created_at=source_review.decided_at or now,
            )
            db.add(approval)
        approval.requested_by = requested_by_id
        approval.status = "PENDING"
        approval.approver_id = None
        approval.justification = "AI-proposed precedent requires independent approval before activation."
        approval.decided_at = None
        approval.created_at = source_review.decided_at or now


def _seed_review_delegations(db) -> None:
    specs = [
        ("legal.reviewer@ghst.demo", "Human Resources", "Cross-functional support for consequential employment escalations.", 45),
        ("legal.reviewer2@ghst.demo", "Finance", "Backup reviewer coverage for finance review surges.", 45),
    ]
    for username, department, reason, validity_days in specs:
        reviewer_id = _user_id(db, username)
        delegation = db.scalar(select(ReviewDelegation).where(
            ReviewDelegation.reviewer_id == reviewer_id,
            ReviewDelegation.department == department,
        ))
        if not delegation:
            delegation = ReviewDelegation(
                organisation_id="org_ghst_demo",
                reviewer_id=reviewer_id,
                department=department,
                granted_by=_user_id(db, "system.admin@ghst.demo"),
                reason=reason,
                status="ACTIVE",
                expires_at=datetime.now(UTC) + timedelta(days=validity_days),
            )
            db.add(delegation)
        delegation.status = "ACTIVE"
        delegation.reason = reason
        delegation.expires_at = datetime.now(UTC) + timedelta(days=validity_days)


def _seed_session_risk(db) -> None:
    specs = [
        ("risk_session_finance", "finance.employee@ghst.demo", {"rapid_submissions": 2, "finance_hits": 1}, 0.44, 40),
        ("risk_session_hr", "hr.employee@ghst.demo", {"pii_hits": 3, "consequential_use": 1}, 0.67, 55),
    ]
    for session_id, username, feature_counts, cumulative_score, ttl_minutes in specs:
        state = db.scalar(select(SessionRiskState).where(SessionRiskState.session_id == session_id))
        if not state:
            state = SessionRiskState(
                organisation_id="org_ghst_demo",
                user_id=_user_id(db, username),
                session_id=session_id,
                feature_counts=feature_counts,
                cumulative_score=cumulative_score,
                expires_at=datetime.now(UTC) + timedelta(minutes=ttl_minutes),
            )
            db.add(state)
        state.feature_counts = feature_counts
        state.cumulative_score = cumulative_score
        state.expires_at = datetime.now(UTC) + timedelta(minutes=ttl_minutes)


def _seed_usability(db) -> None:
    specs = [
        ("legal.employee@ghst.demo", "EMPLOYEE", "Legal", 0.92, 82.5),
        ("finance.employee@ghst.demo", "EMPLOYEE", "Finance", 0.88, 78.0),
        ("legal.reviewer@ghst.demo", "REVIEWER", "Legal", 0.9, 80.0),
        ("policy.admin@ghst.demo", "POLICY_ADMIN", "Governance", 0.94, 84.0),
    ]
    for username, role_context, department, completion, sus_score in specs:
        participant_hash = hashlib.sha256(f"seeded-usability:{username}".encode()).hexdigest()
        response = db.scalar(select(UsabilityStudyResponse).where(
            UsabilityStudyResponse.organisation_id == "org_ghst_demo",
            UsabilityStudyResponse.participant_hash == participant_hash,
        ))
        if not response:
            response = UsabilityStudyResponse(
                organisation_id="org_ghst_demo",
                participant_hash=participant_hash,
                role_context=role_context,
                department_group=department,
                task_results=[
                    {"task": "dashboard", "completed": True},
                    {"task": "human_review", "completed": True},
                    {"task": "policy_memory", "completed": completion >= 0.9},
                ],
                sus_answers=[4, 2, 4, 2, 5, 2, 4, 2, 5, 2],
                task_completion_rate=completion,
                sus_score=sus_score,
            )
            db.add(response)
        response.task_completion_rate = completion
        response.sus_score = sus_score


def _seed_audit_history(db) -> None:
    if db.scalar(select(AuditEvent.sequence).limit(1)):
        return
    base_time = datetime.now(UTC) - timedelta(days=6)
    policy_versions = list(db.scalars(select(PolicyVersion).where(PolicyVersion.status == "ACTIVE").order_by(PolicyVersion.created_at)))
    models = {item.model_name: item for item in db.scalars(select(ModelVersion).where(ModelVersion.organisation_id == "org_ghst_demo"))}
    calibrations = {item.version: item for item in db.scalars(select(CalibrationRecommendation).where(CalibrationRecommendation.organisation_id == "org_ghst_demo"))}
    precedents = list(db.scalars(select(Precedent).where(Precedent.organisation_id == "org_ghst_demo").order_by(Precedent.created_at)))
    delegations = list(db.scalars(select(ReviewDelegation).where(ReviewDelegation.organisation_id == "org_ghst_demo").order_by(ReviewDelegation.created_at)))
    evals = {item.session_id: item for item in db.scalars(select(Evaluation).where(Evaluation.organisation_id == "org_ghst_demo"))}
    reviews = {item.evaluation_id: item for item in db.scalars(select(Review).where(Review.organisation_id == "org_ghst_demo"))}

    for index, version in enumerate(policy_versions):
        _append_audit(
            db,
            event_type="POLICY_VERSION_ACTIVATED",
            actor_id=_user_id(db, "policy.admin@ghst.demo"),
            department="Governance",
            entity_type="POLICY_VERSION",
            entity_id=version.id,
            payload={"version": version.version, "status": version.status},
            created_at=base_time + timedelta(minutes=index * 18),
        )

    for index, session_id in enumerate(["legal_hist_001", "legal_hist_002", "legal_hist_003", "finance_hist_001", "hr_hist_001"]):
        evaluation = evals.get(session_id)
        review = reviews.get(evaluation.id) if evaluation else None
        if not evaluation or not review:
            continue
        _append_audit(
            db,
            event_type="HUMAN_REVIEW_DECIDED",
            actor_id=review.reviewer_id or _user_id(db, "policy.admin@ghst.demo"),
            department=evaluation.department,
            entity_type="REVIEW",
            entity_id=review.id,
            payload={"evaluation_id": evaluation.id, "decision": review.decision, "justification": review.justification},
            created_at=base_time + timedelta(hours=4, minutes=index * 18),
        )

    legal_eval = evals.get("legal_hist_001")
    hr_eval = evals.get("hr_hist_001")
    if legal_eval:
        _append_audit(
            db,
            event_type="GATEWAY_FAST_PATH_ACCEPTED",
            actor_id=legal_eval.user_id,
            department=legal_eval.department,
            entity_type="EVALUATION",
            entity_id=legal_eval.id,
            payload={"action": "ALLOW", "policy_source": "HUMAN_REVIEW"},
            created_at=base_time + timedelta(hours=2),
        )
        _append_audit(
            db,
            event_type="CLEARANCE_GRANT_ISSUED",
            actor_id=_user_id(db, "system.admin@ghst.demo"),
            department="Technology",
            entity_type="EVALUATION",
            entity_id=legal_eval.id,
            payload={"destination": legal_eval.destination_origin, "status": "ISSUED"},
            created_at=base_time + timedelta(hours=2, minutes=8),
        )
    if hr_eval:
        _append_audit(
            db,
            event_type="GATEWAY_REQUEST_BLOCKED",
            actor_id=hr_eval.user_id,
            department=hr_eval.department,
            entity_type="EVALUATION",
            entity_id=hr_eval.id,
            payload={"action": "BLOCK", "policy_source": "HUMAN_REVIEW"},
            created_at=base_time + timedelta(hours=3),
        )

    for index, precedent in enumerate(precedents):
        created_at = base_time + timedelta(hours=6, minutes=index * 12)
        _append_audit(
            db,
            event_type="ACE_PRECEDENT_CREATED",
            actor_id=precedent.reviewer_id,
            department=precedent.department,
            entity_type="PRECEDENT",
            entity_id=precedent.id,
            payload={"purpose": precedent.purpose, "risk_ceiling": precedent.risk_ceiling, "status": precedent.status},
            created_at=created_at,
        )
        if precedent.status == "PENDING_SECOND_REVIEW":
            _append_audit(
                db,
                event_type="PRECEDENT_SECOND_REVIEW_REQUESTED",
                actor_id=precedent.reviewer_id,
                department=precedent.department,
                entity_type="PRECEDENT",
                entity_id=precedent.id,
                payload={"status": "PENDING", "justification": precedent.justification},
                created_at=created_at + timedelta(minutes=3),
            )
        if precedent.status == "REVOKED":
            _append_audit(
                db,
                event_type="ACE_PRECEDENT_REVOKED",
                actor_id=_user_id(db, "policy.admin@ghst.demo"),
                department="Governance",
                entity_type="PRECEDENT",
                entity_id=precedent.id,
                payload={"previous_status": "ACTIVE", "new_status": "REVOKED"},
                created_at=created_at + timedelta(minutes=6),
            )

    calibration = calibrations.get("CAL-2026-017")
    if calibration:
        _append_audit(
            db,
            event_type="CALIBRATION_ACTIVATED",
            actor_id=_user_id(db, "policy.admin@ghst.demo"),
            department="Governance",
            entity_type="CALIBRATION",
            entity_id=calibration.id,
            payload={"version": calibration.version, "status": calibration.status},
            created_at=base_time + timedelta(hours=8),
        )

    for model_name, event_type, offset_minutes in [
        ("Private QLoRA adapter v3.3", "MODEL_CANDIDATE_CREATED", 0),
        ("Private QLoRA adapter v3.3", "MODEL_CANDIDATE_EVALUATED", 12),
        ("Private QLoRA adapter v3.2", "MODEL_SHADOW_DEPLOYED", 24),
        ("Qwen3.5:4B + GHST adapter v3.1", "MODEL_PROMOTED", 36),
    ]:
        model = models.get(model_name)
        if not model:
            continue
        _append_audit(
            db,
            event_type=event_type,
            actor_id=_user_id(db, "policy.admin@ghst.demo"),
            department="Governance",
            entity_type="MODEL_VERSION",
            entity_id=model.id,
            payload={"model_name": model.model_name, "status": model.status},
            created_at=base_time + timedelta(hours=10, minutes=offset_minutes),
        )

    for index, delegation in enumerate(delegations):
        _append_audit(
            db,
            event_type="CROSS_DEPARTMENT_REVIEW_GRANTED",
            actor_id=delegation.granted_by,
            department=delegation.department,
            entity_type="REVIEW_DELEGATION",
            entity_id=delegation.id,
            payload={"reviewer_id": delegation.reviewer_id, "reason": delegation.reason},
            created_at=base_time + timedelta(hours=12, minutes=index * 8),
        )


def _append_audit(db, *, event_type: str, actor_id: str, department: str, entity_type: str, entity_id: str, payload: dict, created_at: datetime) -> None:
    previous = db.scalar(select(AuditEvent).order_by(AuditEvent.sequence.desc()).limit(1))
    previous_hash = previous.event_hash if previous else "0" * 64
    canonical = json.dumps(
        {
            "event_type": event_type,
            "actor_id": actor_id,
            "organisation_id": "org_ghst_demo",
            "department": department,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "payload": payload,
            "previous_hash": previous_hash,
            "created_at": created_at.astimezone(UTC).isoformat(),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    event = AuditEvent(
        event_type=event_type,
        actor_id=actor_id,
        organisation_id="org_ghst_demo",
        department=department,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload,
        previous_hash=previous_hash,
        event_hash=hashlib.sha256(canonical.encode()).hexdigest(),
        created_at=created_at,
    )
    db.add(event)
    db.flush()


def _precedent_data_class(evaluation: Evaluation) -> str:
    confirmed = next((item.get("category") for item in (evaluation.findings or []) if item.get("confirmed")), None)
    if confirmed:
        return str(confirmed)
    local_model = evaluation.model_evidence.get("local_model", {}) if evaluation.model_evidence else {}
    data_class = local_model.get("data_class")
    return str(data_class) if data_class else "PUBLIC_OR_INTERNAL_SAFE"


if __name__ == "__main__":
    reset_and_seed_demo()
    print("GHST database reset and reseeded with complete demo data.")
