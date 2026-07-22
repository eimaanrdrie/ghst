from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import CalibrationRecommendation


def calibrated_settings(db: Session, organisation_id: str, settings: Settings) -> Settings:
    active = db.scalar(select(CalibrationRecommendation).where(
        CalibrationRecommendation.organisation_id == organisation_id,
        CalibrationRecommendation.status == "ACTIVE",
    ).order_by(CalibrationRecommendation.activated_at.desc()))
    if not active:
        return settings
    allowed = {
        "local_model_confidence_threshold": float(active.proposed_config.get(
            "local_model_confidence_threshold", settings.local_model_confidence_threshold
        )),
        "ace_similarity_threshold": float(active.proposed_config.get(
            "ace_similarity_threshold", settings.ace_similarity_threshold
        )),
    }
    # Calibration can make the automated path stricter, never weaker than the
    # administrator-approved static security baseline.
    allowed["local_model_confidence_threshold"] = min(0.98, max(
        settings.local_model_confidence_threshold,
        allowed["local_model_confidence_threshold"],
    ))
    allowed["ace_similarity_threshold"] = min(0.95, max(
        settings.ace_similarity_threshold,
        allowed["ace_similarity_threshold"],
    ))
    return settings.model_copy(update=allowed)
