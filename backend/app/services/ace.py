import hashlib
import re
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import Precedent

SYNONYMS = {
    "summarise": "summarize", "summary": "summarize", "analyse": "analyze",
    "analysis": "analyze", "assess": "analyze", "reviewing": "review", "reviews": "review",
    "document": "text", "memo": "text", "brief": "text",
}
STOP = {"the", "and", "for", "with", "this", "that", "from", "please", "could", "would", "into"}
TASK_WORDS = {
    "ask", "asking", "create", "draft", "generate", "give", "help",
    "make", "prepare", "provide", "tell", "write",
}


def semantic_signature(text: str, settings: Settings) -> list[str]:
    tokens = []
    for token in re.findall(r"[a-z0-9]+", text.lower()):
        token = SYNONYMS.get(token, token)
        if len(token) < 3 or token in STOP:
            continue
        tokens.append(hashlib.sha256(f"{settings.prompt_hmac_key}:{token}".encode()).hexdigest()[:16])
    return sorted(set(tokens))


def find_matching_precedent(
    db: Session,
    *,
    organisation_id: str,
    department: str,
    role_context: str,
    purpose: str,
    data_class: str,
    impact_class: str,
    ai_service: str,
    tenant: str,
    risk_score: float,
    policy_version_ids: list[str],
    signature: list[str],
    settings: Settings,
) -> tuple[Precedent | None, float]:
    candidates = list(
        db.scalars(
            select(Precedent).where(
                Precedent.organisation_id == organisation_id,
                or_(Precedent.department == department, Precedent.scope == "GLOBAL"),
                Precedent.role_context == role_context,
                Precedent.purpose == purpose,
                Precedent.data_class == data_class,
                Precedent.impact_class == impact_class,
                Precedent.ai_service == ai_service,
                Precedent.tenant == tenant,
                Precedent.status == "ACTIVE",
            )
        )
    )
    matches: list[tuple[Precedent, float]] = []
    now = datetime.now(UTC)
    for precedent in candidates:
        if precedent.scope != "GLOBAL" and sorted(precedent.policy_version_ids or [precedent.policy_version_id]) != sorted(policy_version_ids):
            continue
        expires_at = precedent.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at <= now:
            precedent.status = "EXPIRED"
            continue
        if precedent.reuse_count >= precedent.reuse_limit:
            precedent.status = "EXHAUSTED"
            continue
        if risk_score > precedent.risk_ceiling:
            continue
        score = _comparison_similarity(signature, precedent.term_hashes, settings)
        if score >= settings.ace_similarity_threshold:
            matches.append((precedent, score))
    if not matches:
        return None, 0.0
    strictness = {"ALLOW": 1, "REDACT": 2, "REDIRECT": 3, "REVIEW": 4, "BLOCK": 5}
    # Conflicting matches resolve to the stricter control; similarity breaks ties.
    matches.sort(key=lambda item: (strictness.get(item[0].control, 4), item[1]), reverse=True)
    return matches[0]


def _jaccard(left: set[str], right: set[str]) -> float:
    return len(left & right) / max(1, len(left | right))


def _comparison_similarity(left: list[str], right: list[str], settings: Settings) -> float:
    """Compare intent terms while excluding generic task wording from old and new signatures."""
    task_hashes = {
        hashlib.sha256(f"{settings.prompt_hmac_key}:{token}".encode()).hexdigest()[:16]
        for token in TASK_WORDS
    }
    return _jaccard(set(left) - task_hashes, set(right) - task_hashes)
