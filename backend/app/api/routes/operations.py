from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.api.deps import current_user, require_roles
from app.core.config import Settings, get_settings
from app.db.models import AuditEvent, Destination, Evaluation, ModelVersion, PolicyVersion, Precedent, Review, UsabilityStudyResponse, User
from app.db.session import get_db
from app.schemas.operations import UsabilityStudySubmission
from app.core.security import prompt_digest
from app.services.audit import append_audit
from app.services.audit import verify_audit_chain

router = APIRouter(tags=["Operations and Audit"])


@router.get("/identities/reviewers")
def reviewer_identities(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
):
    reviewers = list(db.scalars(select(User).where(
        User.organisation_id == user.organisation_id,
        User.status == "ACTIVE",
    )))
    return [
        {"id": item.id, "username": item.username, "display_name": item.display_name, "department": item.department}
        for item in reviewers if "REVIEWER" in item.roles
    ]


@router.post("/usability/responses")
def submit_usability_response(
    body: UsabilityStudySubmission,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(current_user),
):
    if any(answer < 1 or answer > 5 for answer in body.sus_answers):
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="Every SUS answer must be between 1 and 5.")
    task_results = [item.model_dump() for item in body.task_results]
    completion = sum(item["completed"] for item in task_results) / len(task_results)
    sus_total = sum(
        answer - 1 if index % 2 == 0 else 5 - answer
        for index, answer in enumerate(body.sus_answers)
    )
    response = UsabilityStudyResponse(
        organisation_id=user.organisation_id,
        participant_hash=prompt_digest(f"usability:{user.id}", settings),
        role_context=user.roles[0],
        department_group=user.department,
        task_results=task_results,
        sus_answers=body.sus_answers,
        task_completion_rate=round(completion, 4),
        sus_score=round(sus_total * 2.5, 2),
    )
    db.add(response)
    db.flush()
    append_audit(
        db,
        event_type="USABILITY_EVIDENCE_RECORDED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="USABILITY_RESPONSE",
        entity_id=response.id,
        payload={"task_completion_rate": response.task_completion_rate, "sus_score": response.sus_score},
    )
    db.commit()
    return {"id": response.id, "task_completion_rate": response.task_completion_rate, "sus_score": response.sus_score}


@router.get("/usability/summary")
def usability_summary(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
):
    rows = list(db.scalars(select(UsabilityStudyResponse).where(
        UsabilityStudyResponse.organisation_id == user.organisation_id
    )))
    if not rows:
        return {"sample_size": 0, "task_completion_rate": None, "sus_score": None, "targets_met": False, "representativeness_requires_human_review": True}
    completion = sum(item.task_completion_rate for item in rows) / len(rows)
    sus = sum(item.sus_score for item in rows) / len(rows)
    return {
        "sample_size": len({item.participant_hash for item in rows}),
        "department_groups": sorted({item.department_group for item in rows}),
        "role_groups": sorted({item.role_context for item in rows}),
        "task_completion_rate": round(completion, 4),
        "sus_score": round(sus, 2),
        "targets_met": completion >= 0.85 and sus >= 70,
        "representativeness_requires_human_review": True,
    }


@router.get("/audit/events")
def audit_events(
    event_type: str | None = None,
    department: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("AUDITOR", "POLICY_ADMIN", "SYSTEM_ADMIN", "REVIEWER")),
):
    statement = select(AuditEvent).where(AuditEvent.organisation_id == user.organisation_id)
    if event_type:
        statement = statement.where(AuditEvent.event_type == event_type)
    if department:
        statement = statement.where(AuditEvent.department == department)
    if "REVIEWER" in user.roles and "CROSS_DEPARTMENT_REVIEWER" not in user.roles:
        statement = statement.where(AuditEvent.department == user.department)
    events = list(db.scalars(statement.order_by(AuditEvent.sequence.desc()).limit(min(limit, 200))))
    actor_ids = {item.actor_id for item in events if item.actor_id}
    actors = {
        item.id: item
        for item in db.scalars(select(User).where(User.id.in_(actor_ids))) if actor_ids
    } if actor_ids else {}
    return [
        {
            "sequence": item.sequence,
            "id": item.id,
            "event_type": item.event_type,
            "actor_id": item.actor_id,
            "actor_name": actors.get(item.actor_id).display_name if item.actor_id in actors else None,
            "department": item.department,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "payload": item.payload,
            "previous_hash": item.previous_hash,
            "event_hash": item.event_hash,
            "created_at": item.created_at,
        }
        for item in events
    ]


@router.post("/audit/verify")
def verify_audit(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("AUDITOR", "POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    return verify_audit_chain(db)


@router.get("/dashboard/summary")
def dashboard_summary(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
):
    evaluations = list(db.scalars(select(Evaluation).where(Evaluation.organisation_id == user.organisation_id)))
    actions = Counter(item.action for item in evaluations)
    departments = Counter(item.department for item in evaluations)
    department_alerts = Counter(item.department for item in evaluations if item.action in {"BLOCK", "REVIEW"})
    pending_reviews = db.scalar(select(func.count()).select_from(Review).where(
        Review.organisation_id == user.organisation_id, Review.status == "PENDING"
    ))
    active_precedents = db.scalar(select(func.count()).select_from(Precedent).where(
        Precedent.organisation_id == user.organisation_id, Precedent.status == "ACTIVE"
    ))
    active_policies = db.scalar(select(func.count()).select_from(PolicyVersion).where(
        PolicyVersion.status == "ACTIVE"
    ))
    approved_destinations = db.scalar(select(func.count()).select_from(Destination).where(
        Destination.organisation_id == user.organisation_id,
        Destination.trust_status == "APPROVED",
    ))
    audit_events = db.scalar(select(func.count()).select_from(AuditEvent).where(
        AuditEvent.organisation_id == user.organisation_id
    ))
    production_model = db.scalar(select(ModelVersion).where(
        ModelVersion.organisation_id == user.organisation_id,
        ModelVersion.status == "PRODUCTION",
    ))
    local_classifier_latency_ms = None
    if production_model and isinstance(production_model.metrics, dict):
        latency_value = production_model.metrics.get("p95_latency_ms") or production_model.metrics.get("median_latency_ms")
        if isinstance(latency_value, (int, float)):
            local_classifier_latency_ms = round(float(latency_value), 2)
    return {
        "total_evaluations": len(evaluations),
        "actions": {key: actions.get(key, 0) for key in ["ALLOW", "REDACT", "REDIRECT", "REVIEW", "BLOCK"]},
        "departments": dict(departments),
        "department_alerts": dict(department_alerts),
        "pending_reviews": pending_reviews,
        "active_precedents": active_precedents,
        "active_policies": active_policies,
        "approved_destinations": approved_destinations,
        "audit_events": audit_events,
        "local_classifier_latency_ms": local_classifier_latency_ms,
        "raw_prompt_storage": False,
    }


@router.get("/models/benchmark")
def model_benchmark(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
):
    models = list(db.scalars(select(ModelVersion).where(ModelVersion.organisation_id == user.organisation_id)))
    return [{"model": item.model_name, "status": item.status, "metrics": item.metrics} for item in models]


@router.get("/health/live")
def health_live():
    return {"status": "live", "service": "ghst-pdp"}


@router.get("/health/ready")
def health_ready(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    database = "ready"
    policy_store = "ready"
    try:
        db.execute(text("SELECT 1"))
        active = db.scalar(select(func.count()).select_from(PolicyVersion).where(PolicyVersion.status == "ACTIVE"))
        if not active:
            policy_store = "unavailable"
    except Exception:
        database = "unavailable"
        policy_store = "unavailable"
    model = "demo-adapter" if settings.demo_mode else "configured-ollama"
    ready = database == "ready" and policy_store == "ready"
    return {
        "status": "ready" if ready else "degraded",
        "dependencies": {"database": database, "database_provider": settings.database_provider, "policy_store": policy_store, "local_model": model},
        "external_release_enabled": ready,
        "demo_mode": settings.demo_mode,
    }
