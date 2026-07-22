import math
import re
from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import SessionRiskState, User


def analyse_session_fragments(
    db: Session,
    *,
    user: User,
    session_id: str,
    text: str,
    settings: Settings,
) -> list[dict]:
    """Detect split-submission risk without retaining any prompt fragments."""
    now = datetime.now(UTC)
    state = db.scalar(select(SessionRiskState).where(
        SessionRiskState.organisation_id == user.organisation_id,
        SessionRiskState.user_id == user.id,
        SessionRiskState.session_id == session_id,
    ).order_by(SessionRiskState.updated_at.desc()))
    if state and _aware(state.expires_at) <= now:
        db.delete(state)
        db.flush()
        state = None
    previous = dict(state.feature_counts) if state else {}
    current = _features(text)
    combined = {key: int(previous.get(key, 0)) + int(value) for key, value in current.items()}
    fragmented_secret = (
        previous.get("SECRET_SPLIT_CONTEXT", 0) > 0
        and current.get("CONTINUATION", 0) > 0
        and current.get("ENTROPIC_FRAGMENT", 0) > 0
    )
    fragmented_confidential = (
        previous.get("CONFIDENTIAL_SPLIT_CONTEXT", 0) > 0
        and current.get("CONTINUATION", 0) > 0
        and current.get("BUSINESS_FRAGMENT", 0) > 0
    )
    score = min(1.0, 0.22 * sum(min(value, 2) for value in combined.values()))
    if not state:
        state = SessionRiskState(
            organisation_id=user.organisation_id,
            user_id=user.id,
            session_id=session_id,
            feature_counts=combined,
            cumulative_score=score,
            expires_at=now + timedelta(seconds=settings.session_risk_ttl_seconds),
        )
        db.add(state)
    else:
        state.feature_counts = combined
        state.cumulative_score = score
        state.expires_at = now + timedelta(seconds=settings.session_risk_ttl_seconds)
        state.updated_at = now
    if fragmented_secret:
        return [_session_finding(
            category="AUTHENTICATION_SECRETS",
            severity="CRITICAL",
            confidence=0.96,
            detector="rolling-session-secret-v1",
        )]
    if fragmented_confidential:
        return [_session_finding(
            category="CONFIDENTIAL_BUSINESS_IP",
            severity="HIGH",
            confidence=0.9,
            detector="rolling-session-business-v1",
        )]
    return []


def _features(text: str) -> dict[str, int]:
    lowered = text.lower()
    features = {
        "SECRET_SPLIT_CONTEXT": int(bool(re.search(
            r"\b(?:api key|credential|password|access token|secret)\b.{0,40}\b(?:split|first half|prefix|chunk|part)\b",
            lowered,
        ))),
        "CONFIDENTIAL_SPLIT_CONTEXT": int(bool(re.search(
            r"\b(?:confidential|internal only|merger|customer list|source code)\b.{0,40}\b(?:split|first half|chunk|part)\b",
            lowered,
        ))),
        "CONTINUATION": int(bool(re.search(r"\b(?:continuation|remaining|second half|next chunk|part two|continued)\b", lowered))),
        "ENTROPIC_FRAGMENT": int(any(
            8 <= len(token) <= 48 and _entropy(token) >= 3.2 and any(char.isdigit() for char in token)
            for token in re.findall(r"[A-Za-z0-9_-]{8,48}", text)
        )),
        "BUSINESS_FRAGMENT": int(bool(re.search(r"\b(?:figures|strategy|names|records|implementation|forecast|terms)\b", lowered))),
    }
    return {key: value for key, value in features.items() if value}


def _session_finding(*, category: str, severity: str, confidence: float, detector: str) -> dict:
    return {
        "category": category,
        "severity": severity,
        "confidence": confidence,
        "detector": detector,
        "source": "SESSION",
        "start": 0,
        "end": 0,
        "masked_preview": "[CROSS_REQUEST_PATTERN]",
        "redactable": False,
        "confirmed": True,
    }


def _entropy(value: str) -> float:
    counts = Counter(value)
    return -sum((count / len(value)) * math.log2(count / len(value)) for count in counts.values())


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)
