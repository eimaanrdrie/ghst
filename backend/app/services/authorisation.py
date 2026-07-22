from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ReviewDelegation, User


def delegated_departments(db: Session, user: User) -> set[str]:
    if "POLICY_ADMIN" in user.roles or "SYSTEM_ADMIN" in user.roles:
        return {"*"}
    departments = {user.department}
    now = datetime.now(UTC)
    delegations = db.scalars(
        select(ReviewDelegation).where(
            ReviewDelegation.organisation_id == user.organisation_id,
            ReviewDelegation.reviewer_id == user.id,
            ReviewDelegation.status == "ACTIVE",
        )
    )
    for delegation in delegations:
        expires_at = delegation.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at > now:
            departments.add(delegation.department)
        else:
            delegation.status = "EXPIRED"
    return departments


def can_review_department(db: Session, user: User, department: str) -> bool:
    departments = delegated_departments(db, user)
    return "*" in departments or department in departments
