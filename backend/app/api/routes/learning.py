import hashlib
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import Settings, get_settings
from app.db.models import (
    CalibrationRecommendation,
    Evaluation,
    ModelTrainingJob,
    ModelVersion,
    Review,
    User,
)
from app.db.session import get_db
from app.schemas.learning import CalibrationRequest, LifecycleDecision, ModelEvaluationRequest, TrainingJobRegister
from app.services.audit import append_audit

router = APIRouter(prefix="/learning", tags=["Governed Learning"])


@router.get("/calibrations")
def list_calibrations(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
):
    return [_calibration_out(item) for item in db.scalars(select(CalibrationRecommendation).where(
        CalibrationRecommendation.organisation_id == user.organisation_id
    ).order_by(CalibrationRecommendation.created_at.desc()))]


@router.post("/calibrations/recommend")
def recommend_calibration(
    body: CalibrationRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    rows = list(db.execute(
        select(Review, Evaluation)
        .join(Evaluation, Review.evaluation_id == Evaluation.id)
        .where(
            Review.organisation_id == user.organisation_id,
            Review.status == "DECIDED",
            Review.decision.is_not(None),
        )
        .order_by(Review.decided_at.desc())
        .limit(500)
    ))
    if len(rows) < body.minimum_validated_reviews:
        raise HTTPException(
            status_code=409,
            detail=f"At least {body.minimum_validated_reviews} validated human outcomes are required; {len(rows)} are available.",
        )
    allow_count = sum(1 for review, _ in rows if review.decision == "ALLOW")
    block_count = sum(1 for review, _ in rows if review.decision == "BLOCK")
    mean_uncertainty = sum(evaluation.uncertainty for _, evaluation in rows) / len(rows)
    # Recommendations can only increase review sensitivity and ACE match strictness.
    proposed_confidence = min(0.98, settings.local_model_confidence_threshold + min(0.1, mean_uncertainty * 0.08))
    proposed_ace = min(0.95, settings.ace_similarity_threshold + min(0.08, (block_count / len(rows)) * 0.05))
    sequence = db.scalar(select(func.count()).select_from(CalibrationRecommendation).where(
        CalibrationRecommendation.organisation_id == user.organisation_id
    )) or 0
    recommendation = CalibrationRecommendation(
        organisation_id=user.organisation_id,
        version=f"CAL-{sequence + 1}.0",
        source_review_ids=[review.id for review, _ in rows],
        proposed_config={
            "local_model_confidence_threshold": round(proposed_confidence, 4),
            "ace_similarity_threshold": round(proposed_ace, 4),
        },
        evidence={
            "validated_reviews": len(rows),
            "allow_count": allow_count,
            "block_count": block_count,
            "mean_uncertainty": round(mean_uncertainty, 4),
            "hard_rules_mutable": False,
        },
        created_by=user.id,
    )
    db.add(recommendation)
    db.flush()
    append_audit(
        db,
        event_type="CALIBRATION_RECOMMENDED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="CALIBRATION",
        entity_id=recommendation.id,
        payload={"version": recommendation.version, "review_count": len(rows), "proposed_config": recommendation.proposed_config},
    )
    db.commit()
    return _calibration_out(recommendation)


@router.post("/calibrations/{calibration_id}/activate")
def activate_calibration(
    calibration_id: str,
    body: LifecycleDecision,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    recommendation = db.get(CalibrationRecommendation, calibration_id)
    if not recommendation or recommendation.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Calibration recommendation was not found.")
    if recommendation.status != "DRAFT":
        raise HTTPException(status_code=409, detail="Only a draft calibration may be activated.")
    for active in db.scalars(select(CalibrationRecommendation).where(
        CalibrationRecommendation.organisation_id == user.organisation_id,
        CalibrationRecommendation.status == "ACTIVE",
    )):
        active.status = "RETIRED"
    recommendation.status = "ACTIVE"
    recommendation.approved_by = user.id
    recommendation.activated_at = datetime.now(UTC)
    append_audit(
        db,
        event_type="CALIBRATION_ACTIVATED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="CALIBRATION",
        entity_id=recommendation.id,
        payload={"version": recommendation.version, "justification": body.justification},
    )
    db.commit()
    return _calibration_out(recommendation)


@router.get("/model-jobs")
def list_model_jobs(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
):
    return [_job_out(item) for item in db.scalars(select(ModelTrainingJob).where(
        ModelTrainingJob.organisation_id == user.organisation_id
    ).order_by(ModelTrainingJob.created_at.desc()))]


@router.post("/model-jobs")
def register_training_job(
    body: TrainingJobRegister,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    if body.backend in {"QLORA", "LORA"}:
        required = body.report.get("trained") is True and body.report.get("deidentified") is True and body.report.get("balanced") is True
        if not required:
            raise HTTPException(status_code=422, detail="A private training report must prove training, de-identification and balance.")
        status = "COMPLETED"
    else:
        status = "DEMO_ONLY"
    job = ModelTrainingJob(
        organisation_id=user.organisation_id,
        model_name=body.model_name,
        backend=body.backend,
        dataset_digest=body.dataset_digest,
        status=status,
        config={**body.config, "base_model": body.base_model},
        report=body.report,
        output_path=body.output_path,
        requested_by=user.id,
        completed_at=datetime.now(UTC),
    )
    db.add(job)
    db.flush()
    append_audit(
        db,
        event_type="PRIVATE_MODEL_TRAINING_REGISTERED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="MODEL_TRAINING_JOB",
        entity_id=job.id,
        payload={"backend": job.backend, "dataset_digest": job.dataset_digest, "status": job.status},
    )
    db.commit()
    return _job_out(job)


@router.post("/model-jobs/{job_id}/candidate")
def create_model_candidate(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    job = db.get(ModelTrainingJob, job_id)
    if not job or job.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Training job was not found.")
    if job.status != "COMPLETED":
        raise HTTPException(status_code=409, detail="Only a completed real LoRA/QLoRA job may become a candidate.")
    if db.scalar(select(ModelVersion).where(ModelVersion.model_name == job.model_name)):
        raise HTTPException(status_code=409, detail="That model version already exists.")
    candidate = ModelVersion(
        organisation_id=user.organisation_id,
        model_name=job.model_name,
        model_digest=hashlib.sha256(f"{job.model_name}:{job.dataset_digest}:{job.output_path}".encode()).hexdigest(),
        base_model=job.config.get("base_model"),
        adapter_type=job.backend,
        dataset_digest=job.dataset_digest,
        detector_versions={"deterministic": "ghst-dlp-v1.0.0"},
        status="CANDIDATE",
        metrics={"training_report": job.report, "evaluated": False},
    )
    db.add(candidate)
    job.status = "CANDIDATE_CREATED"
    db.flush()
    append_audit(
        db,
        event_type="MODEL_CANDIDATE_CREATED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="MODEL_VERSION",
        entity_id=candidate.id,
        payload={"training_job_id": job.id, "model_digest": candidate.model_digest},
    )
    db.commit()
    return _model_out(candidate)


@router.get("/models")
def list_models(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
):
    return [_model_out(item) for item in db.scalars(select(ModelVersion).where(
        ModelVersion.organisation_id == user.organisation_id
    ).order_by(ModelVersion.created_at.desc()))]


@router.post("/models/{model_id}/evaluate")
def evaluate_model_candidate(
    model_id: str,
    body: ModelEvaluationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    model = _owned_model(db, user, model_id)
    if model.status != "CANDIDATE":
        raise HTTPException(status_code=409, detail="Only a candidate model may be evaluated.")
    metrics = body.model_dump()
    gates = {
        "recall": body.held_out_recall >= 0.95,
        "macro_f1": body.macro_f1 >= 0.85,
        "schema_validity": body.schema_validity >= 0.98,
        "secret_false_allows": body.secret_false_allows == 0,
        "adversarial": body.adversarial_passed,
        "regression": body.regression_passed,
    }
    model.metrics = {**model.metrics, **metrics, "gates": gates, "evaluated": True}
    model.status = "EVALUATED" if all(gates.values()) else "REJECTED"
    append_audit(
        db,
        event_type="MODEL_CANDIDATE_EVALUATED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="MODEL_VERSION",
        entity_id=model.id,
        payload={"status": model.status, "gates": gates, "evaluation_dataset_digest": body.evaluation_dataset_digest},
    )
    db.commit()
    return _model_out(model)


@router.post("/models/{model_id}/shadow")
def deploy_model_shadow(
    model_id: str,
    body: LifecycleDecision,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    model = _owned_model(db, user, model_id)
    if model.status != "EVALUATED":
        raise HTTPException(status_code=409, detail="The model must pass every evaluation gate before shadow deployment.")
    model.status = "SHADOW"
    _model_audit(db, user, model, "MODEL_SHADOW_DEPLOYED", body.justification)
    db.commit()
    return _model_out(model)


@router.post("/models/{model_id}/promote")
def promote_model(
    model_id: str,
    body: LifecycleDecision,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    model = _owned_model(db, user, model_id)
    if model.status != "SHADOW":
        raise HTTPException(status_code=409, detail="Only a human-reviewed shadow model may be promoted.")
    current = db.scalar(select(ModelVersion).where(
        ModelVersion.organisation_id == user.organisation_id,
        ModelVersion.status == "PRODUCTION",
    ))
    if current:
        current.status = "RETIRED"
        model.previous_model_id = current.id
    model.status = "PRODUCTION"
    model.approved_by = user.id
    model.deployed_at = datetime.now(UTC)
    _model_audit(db, user, model, "MODEL_PROMOTED", body.justification)
    db.commit()
    return _model_out(model)


@router.post("/models/{model_id}/rollback")
def rollback_model(
    model_id: str,
    body: LifecycleDecision,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    model = _owned_model(db, user, model_id)
    if model.status != "PRODUCTION" or not model.previous_model_id:
        raise HTTPException(status_code=409, detail="This production model has no preserved rollback target.")
    previous = db.get(ModelVersion, model.previous_model_id)
    if not previous or previous.organisation_id != user.organisation_id:
        raise HTTPException(status_code=409, detail="The rollback target is unavailable.")
    model.status = "ROLLED_BACK"
    previous.status = "PRODUCTION"
    previous.approved_by = user.id
    previous.deployed_at = datetime.now(UTC)
    _model_audit(db, user, model, "MODEL_ROLLED_BACK", body.justification, {"restored_model_id": previous.id})
    db.commit()
    return {"rolled_back": _model_out(model), "restored": _model_out(previous)}


def _owned_model(db: Session, user: User, model_id: str) -> ModelVersion:
    model = db.get(ModelVersion, model_id)
    if not model or model.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Model version was not found.")
    return model


def _model_audit(db, user, model, event_type, justification, extra=None):
    append_audit(
        db,
        event_type=event_type,
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="MODEL_VERSION",
        entity_id=model.id,
        payload={"status": model.status, "justification": justification, **(extra or {})},
    )


def _calibration_out(item):
    return {
        "id": item.id, "version": item.version, "status": item.status,
        "source_review_ids": item.source_review_ids, "proposed_config": item.proposed_config,
        "evidence": item.evidence, "approved_by": item.approved_by,
        "created_at": item.created_at, "activated_at": item.activated_at,
    }


def _job_out(item):
    return {
        "id": item.id, "model_name": item.model_name, "backend": item.backend,
        "dataset_digest": item.dataset_digest, "status": item.status, "config": item.config,
        "report": item.report, "output_path": item.output_path, "created_at": item.created_at,
    }


def _model_out(item):
    return {
        "id": item.id, "model_name": item.model_name, "model_digest": item.model_digest,
        "base_model": item.base_model, "adapter_type": item.adapter_type,
        "dataset_digest": item.dataset_digest, "status": item.status, "metrics": item.metrics,
        "previous_model_id": item.previous_model_id, "approved_by": item.approved_by,
        "created_at": item.created_at, "deployed_at": item.deployed_at,
    }
