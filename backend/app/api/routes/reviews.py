import hashlib
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import Settings, get_settings
from app.core.security import decrypt_review_payload
from app.db.models import (
    Destination,
    Evaluation,
    LearningArtefact,
    Precedent,
    PrecedentApproval,
    Review,
    ReviewDelegation,
    User,
)
from app.db.session import get_db
from app.schemas.review import (
    PrecedentOut,
    GlobalScopeRequest,
    ReviewDelegationCreate,
    ReviewDelegationOut,
    ReviewDecisionRequest,
    ReviewDecisionResponse,
    ReviewDetail,
    ReviewListItem,
    SecondApprovalRequest,
)
from app.services.ace import _comparison_similarity
from app.services.authorisation import can_review_department, delegated_departments
from app.services.audit import append_audit

router = APIRouter(tags=["Human Governance"])

AUTO_PRECEDENT_MIN_SUPPORT = 2
AUTO_PRECEDENT_VALIDITY_DAYS = 60
AUTO_PRECEDENT_REUSE_LIMIT = 25


@router.get("/reviews", response_model=list[ReviewListItem])
def list_reviews(
    status_filter: str = "PENDING",
    severity: str | None = None,
    department: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    db.execute(
        update(Review)
        .where(Review.status == "PENDING", Review.expires_at <= datetime.now(UTC))
        .values(status="EXPIRED", encrypted_payload=None)
    )
    db.commit()
    statement = (
        select(Review, Evaluation, User)
        .join(Evaluation, Review.evaluation_id == Evaluation.id)
        .join(User, Review.requested_by == User.id)
        .where(Review.organisation_id == user.organisation_id, Review.status == status_filter)
    )
    if "REVIEWER" in user.roles:
        allowed = delegated_departments(db, user)
        if "*" not in allowed:
            statement = statement.where(Review.department.in_(allowed))
    if department:
        statement = statement.where(Review.department == department)
    if severity:
        statement = statement.where(Review.severity == severity)
    severity_order = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}
    rows = list(db.execute(statement).all())
    rows.sort(key=lambda row: (-severity_order.get(row[0].severity, 0), row[0].created_at))
    return [
        ReviewListItem(
            id=review.id,
            evaluation_id=evaluation.id,
            department=review.department,
            status=review.status,
            severity=review.severity,
            requested_by_name=requestor.display_name,
            purpose=evaluation.purpose,
            destination_origin=evaluation.destination_origin,
            risk_score=evaluation.risk_score,
            created_at=review.created_at,
            expires_at=review.expires_at,
        )
        for review, evaluation, requestor in rows
    ]


@router.get("/reviews/{review_id}", response_model=ReviewDetail)
def get_review(
    review_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    review = db.get(Review, review_id)
    if not review or review.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Review was not found.")
    if not can_review_department(db, user, review.department):
        raise HTTPException(status_code=403, detail="Reviewer is not authorised for this department.")
    if _aware(review.expires_at) <= datetime.now(UTC) or not review.encrypted_payload:
        if review.status == "PENDING":
            review.status = "EXPIRED"
            review.encrypted_payload = None
            db.commit()
        raise HTTPException(status_code=410, detail="The temporary review evidence has expired.")
    evaluation = db.get(Evaluation, review.evaluation_id)
    payload = decrypt_review_payload(review.encrypted_payload, settings)
    append_audit(
        db,
        event_type="REVIEW_EVIDENCE_ACCESSED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="REVIEW",
        entity_id=review.id,
        payload={"evaluation_id": evaluation.id},
    )
    db.commit()
    return ReviewDetail(
        id=review.id,
        evaluation_id=evaluation.id,
        department=review.department,
        status=review.status,
        severity=review.severity,
        requested_by_name=db.get(User, review.requested_by).display_name if db.get(User, review.requested_by) else None,
        purpose=evaluation.purpose,
        destination_origin=evaluation.destination_origin,
        risk_score=evaluation.risk_score,
        created_at=review.created_at,
        expires_at=review.expires_at,
        prompt=payload["prompt"],
        findings=payload["findings"],
        policy_matches=payload["policy_matches"],
        model_evidence=payload["model_evidence"],
    )


@router.post("/reviews/{review_id}/decision", response_model=ReviewDecisionResponse)
def decide_review(
    review_id: str,
    body: ReviewDecisionRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(require_roles("REVIEWER", "SYSTEM_ADMIN")),
):
    review = db.get(Review, review_id)
    if not review or review.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Review was not found.")
    if not can_review_department(db, user, review.department):
        raise HTTPException(status_code=403, detail="Reviewer is not authorised for this department.")
    if review.requested_by == user.id:
        raise HTTPException(status_code=403, detail="An employee cannot review their own escalation.")
    if review.status != "PENDING" or not review.encrypted_payload or _aware(review.expires_at) <= datetime.now(UTC):
        raise HTTPException(status_code=409, detail="This review is no longer pending with valid evidence.")
    decision = body.decision.upper()
    if decision not in {"ALLOW", "REDACT", "REDIRECT", "BLOCK"}:
        raise HTTPException(status_code=422, detail="Decision must be ALLOW, REDACT, REDIRECT or BLOCK.")
    evaluation = db.get(Evaluation, review.evaluation_id)
    if decision == "ALLOW" and any(f["confirmed"] for f in evaluation.findings):
        raise HTTPException(
            status_code=409,
            detail="Confirmed sensitive information cannot be released by reviewer override.",
        )
    review.status = "DECIDED"
    review.reviewer_id = user.id
    review.decision = decision
    review.justification = body.justification
    review.decided_at = datetime.now(UTC)
    review.encrypted_payload = None
    evaluation.action = decision
    evaluation.state = {
        "ALLOW": "ALLOWED", "REDACT": "REDACTION_REQUIRED",
        "REDIRECT": "REDIRECT_REQUIRED", "BLOCK": "BLOCKED",
    }[decision]
    evaluation.learning_source = "HUMAN_REVIEW"
    evaluation.reason_codes = ["AUTHORISED_HUMAN_DECISION", f"REVIEW_{decision}"]
    evaluation.message = f"An authorised reviewer decided {decision}: {body.justification}"
    evaluation.updated_at = datetime.now(UTC)

    precedent_id = None
    proposed_precedent_id = None
    if body.create_precedent:
        if decision != "ALLOW" or not body.precedent_scope:
            raise HTTPException(status_code=422, detail="An ALLOW precedent requires an explicit bounded scope.")
        scope = body.precedent_scope
        if scope.purpose != evaluation.purpose:
            raise HTTPException(status_code=422, detail="The precedent purpose cannot broaden the reviewed purpose.")
        if not evaluation.policy_matches:
            raise HTTPException(status_code=409, detail="A precedent requires an active policy version.")
        destination = None
        if evaluation.destination_id:
            destination = db.get(Destination, evaluation.destination_id)
        if destination is None:
            destination = db.scalar(
                select(Destination).where(
                    Destination.organisation_id == user.organisation_id,
                    Destination.origin == evaluation.destination_origin,
                    Destination.trust_status == "APPROVED",
                )
            )
        if destination is None:
            raise HTTPException(
                status_code=409,
                detail="A precedent requires a resolved approved destination binding.",
            )
        high_impact = (
            bool(evaluation.model_evidence.get("semantic_router", {}).get("high_impact"))
            or evaluation.risk_score >= settings.second_reviewer_risk_threshold
        )
        precedent_status = "PENDING_SECOND_REVIEW" if high_impact else "ACTIVE"
        precedent = Precedent(
            source_review_id=review.id,
            organisation_id=user.organisation_id,
            department=evaluation.department,
            scope="DEPARTMENT",
            role_context=scope.role_context,
            purpose=scope.purpose,
            data_class=scope.data_class,
            impact_class=evaluation.model_evidence.get("semantic_router", {}).get("organisation_defined_class", "STANDARD"),
            ai_service=destination.service,
            tenant=destination.tenant,
            risk_ceiling=min(scope.risk_ceiling, evaluation.risk_score + 0.05),
            control=scope.control,
            policy_version_id=evaluation.policy_matches[0]["policy_version_id"],
            policy_version_ids=sorted({item["policy_version_id"] for item in evaluation.policy_matches}),
            reviewer_id=user.id,
            justification=body.justification,
            fingerprint=hashlib.sha256("|".join(review.semantic_signature).encode()).hexdigest(),
            embedding=None,
            term_hashes=review.semantic_signature,
            expires_at=datetime.now(UTC) + timedelta(days=scope.validity_days),
            reuse_limit=scope.reuse_limit,
            status=precedent_status,
        )
        db.add(precedent)
        db.flush()
        precedent_id = precedent.id
        db.add(LearningArtefact(
            organisation_id=user.organisation_id,
            artefact_type="ACE_PRECEDENT",
            source_decision_ids=[review.id],
            version="1.0",
            status="PENDING" if high_impact else "ACTIVE",
            approved_by=user.id,
            precedent_id=precedent.id,
            provenance={
                "department": evaluation.department,
                "reviewer_id": user.id,
                "policy_version_id": precedent.policy_version_id,
                "model_weights_changed": False,
            },
        ))
        if high_impact:
            db.add(PrecedentApproval(
                precedent_id=precedent.id,
                requested_by=user.id,
                status="PENDING",
            ))
        append_audit(
            db,
            event_type="ACE_PRECEDENT_CREATED",
            actor_id=user.id,
            organisation_id=user.organisation_id,
            department=user.department,
            entity_type="PRECEDENT",
            entity_id=precedent.id,
            payload={
                "source_review_id": review.id,
                "purpose": precedent.purpose,
                "risk_ceiling": precedent.risk_ceiling,
                "policy_version_id": precedent.policy_version_id,
                "expires_at": precedent.expires_at.isoformat(),
                "reuse_limit": precedent.reuse_limit,
                "status": precedent.status,
            },
        )
        if high_impact:
            append_audit(
                db,
                event_type="PRECEDENT_SECOND_REVIEW_REQUESTED",
                actor_id=user.id,
                organisation_id=user.organisation_id,
                department=review.department,
                entity_type="PRECEDENT",
                entity_id=precedent.id,
                payload={"source_review_id": review.id, "first_reviewer_id": user.id},
            )
    elif decision == "ALLOW":
        proposed = _auto_propose_precedent(
            db,
            settings=settings,
            review=review,
            evaluation=evaluation,
            user=user,
            justification=body.justification,
        )
        proposed_precedent_id = proposed.id if proposed else None
    append_audit(
        db,
        event_type="HUMAN_REVIEW_DECIDED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="REVIEW",
        entity_id=review.id,
        payload={
            "evaluation_id": evaluation.id,
            "decision": decision,
            "justification": body.justification,
            "precedent_id": precedent_id,
        },
    )
    db.commit()
    return ReviewDecisionResponse(
        review_id=review.id,
        evaluation_id=evaluation.id,
        status=review.status,
        decision=decision,
        precedent_id=precedent_id,
        precedent_status=(db.get(Precedent, precedent_id).status if precedent_id else None),
        proposed_precedent_id=proposed_precedent_id,
        proposed_precedent_status=(db.get(Precedent, proposed_precedent_id).status if proposed_precedent_id else None),
        message=(
            "The human decision is active; the high-impact precedent awaits an independent second reviewer."
            if precedent_id and db.get(Precedent, precedent_id).status == "PENDING_SECOND_REVIEW"
            else "The human decision is active; GHST proposed a bounded precedent for approval."
            if proposed_precedent_id
            else "The human decision is active and fully auditable."
        ),
    )


@router.get("/precedents", response_model=list[PrecedentOut])
def list_precedents(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
):
    statement = select(Precedent).where(Precedent.organisation_id == user.organisation_id)
    if status_filter:
        statement = statement.where(Precedent.status == status_filter)
    if "REVIEWER" in user.roles:
        allowed = delegated_departments(db, user)
        if "*" not in allowed:
            statement = statement.where(Precedent.department.in_(allowed))
    return list(db.scalars(statement.order_by(Precedent.created_at.desc())))


@router.post("/precedents/{precedent_id}/revoke", response_model=PrecedentOut)
def revoke_precedent(
    precedent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    precedent = db.get(Precedent, precedent_id)
    if not precedent or precedent.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Precedent was not found.")
    if "REVIEWER" in user.roles and not can_review_department(db, user, precedent.department):
        raise HTTPException(status_code=403, detail="Reviewer is not authorised for this department.")
    precedent.status = "REVOKED"
    append_audit(
        db,
        event_type="ACE_PRECEDENT_REVOKED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="PRECEDENT",
        entity_id=precedent.id,
        payload={"previous_status": "ACTIVE", "new_status": "REVOKED"},
    )
    db.commit()
    return precedent


@router.post("/precedents/{precedent_id}/second-approval", response_model=PrecedentOut)
def second_approve_precedent(
    precedent_id: str,
    body: SecondApprovalRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "SYSTEM_ADMIN")),
):
    precedent = db.get(Precedent, precedent_id)
    if not precedent or precedent.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Precedent was not found.")
    if not can_review_department(db, user, precedent.department):
        raise HTTPException(status_code=403, detail="Reviewer is not authorised for this department.")
    approval = db.scalar(select(PrecedentApproval).where(PrecedentApproval.precedent_id == precedent.id))
    if not approval or approval.status != "PENDING" or precedent.status != "PENDING_SECOND_REVIEW":
        raise HTTPException(status_code=409, detail="This precedent is not awaiting second approval.")
    if approval.requested_by == user.id:
        raise HTTPException(status_code=403, detail="The second reviewer must be independent of the first reviewer.")
    approval.approver_id = user.id
    approval.justification = body.justification
    approval.decided_at = datetime.now(UTC)
    approval.status = "APPROVED" if body.approved else "REJECTED"
    precedent.status = "ACTIVE" if body.approved else "REJECTED_BY_SECOND_REVIEW"
    artefact = db.scalar(select(LearningArtefact).where(LearningArtefact.precedent_id == precedent.id))
    if artefact:
        artefact.status = "ACTIVE" if body.approved else "REJECTED"
        artefact.approved_by = user.id if body.approved else artefact.approved_by
        artefact.provenance = {
            **artefact.provenance,
            "second_reviewer_id": user.id,
            "second_review_status": approval.status,
        }
    append_audit(
        db,
        event_type="PRECEDENT_SECOND_REVIEW_DECIDED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=precedent.department,
        entity_type="PRECEDENT",
        entity_id=precedent.id,
        payload={"approved": body.approved, "justification": body.justification},
    )
    db.commit()
    return precedent


@router.post("/precedents/{precedent_id}/scope", response_model=PrecedentOut)
def assign_precedent_scope(
    precedent_id: str,
    body: GlobalScopeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    precedent = db.get(Precedent, precedent_id)
    if not precedent or precedent.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Precedent was not found.")
    if precedent.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Only an active precedent may change scope.")
    previous = precedent.scope
    source_review = db.get(Review, precedent.source_review_id)
    source_evaluation = db.get(Evaluation, source_review.evaluation_id) if source_review else None
    if not source_evaluation or not source_evaluation.policy_matches:
        raise HTTPException(status_code=409, detail="The source policy evidence is unavailable.")
    if body.scope == "GLOBAL":
        organisation_matches = [item for item in source_evaluation.policy_matches if item.get("scope") == "ALL"]
        if not organisation_matches:
            raise HTTPException(status_code=409, detail="Global scope requires an active organisation-wide policy clause.")
    precedent.scope = body.scope
    append_audit(
        db,
        event_type="ACE_PRECEDENT_SCOPE_CHANGED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="PRECEDENT",
        entity_id=precedent.id,
        payload={
            "previous_scope": previous,
            "new_scope": body.scope,
            "governing_policy_version_ids": precedent.policy_version_ids,
            "justification": body.justification,
        },
    )
    db.commit()
    return precedent


@router.get("/review-delegations", response_model=list[ReviewDelegationOut])
def list_review_delegations(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("SYSTEM_ADMIN", "POLICY_ADMIN", "AUDITOR")),
):
    return list(db.scalars(select(ReviewDelegation).where(
        ReviewDelegation.organisation_id == user.organisation_id
    ).order_by(ReviewDelegation.created_at.desc())))


@router.post("/review-delegations", response_model=ReviewDelegationOut)
def create_review_delegation(
    body: ReviewDelegationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("SYSTEM_ADMIN")),
):
    reviewer = db.get(User, body.reviewer_id)
    if not reviewer or reviewer.organisation_id != user.organisation_id or "REVIEWER" not in reviewer.roles:
        raise HTTPException(status_code=422, detail="The selected identity is not an organisation reviewer.")
    delegation = ReviewDelegation(
        organisation_id=user.organisation_id,
        reviewer_id=reviewer.id,
        department=body.department,
        granted_by=user.id,
        reason=body.reason,
        expires_at=datetime.now(UTC) + timedelta(days=body.validity_days),
    )
    db.add(delegation)
    db.flush()
    append_audit(
        db,
        event_type="CROSS_DEPARTMENT_REVIEW_GRANTED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=body.department,
        entity_type="REVIEW_DELEGATION",
        entity_id=delegation.id,
        payload={"reviewer_id": reviewer.id, "expires_at": delegation.expires_at.isoformat(), "reason": body.reason},
    )
    db.commit()
    db.refresh(delegation)
    return delegation


@router.post("/review-delegations/{delegation_id}/revoke", response_model=ReviewDelegationOut)
def revoke_review_delegation(
    delegation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("SYSTEM_ADMIN")),
):
    delegation = db.get(ReviewDelegation, delegation_id)
    if not delegation or delegation.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Review delegation was not found.")
    delegation.status = "REVOKED"
    append_audit(
        db,
        event_type="CROSS_DEPARTMENT_REVIEW_REVOKED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=delegation.department,
        entity_type="REVIEW_DELEGATION",
        entity_id=delegation.id,
        payload={"reviewer_id": delegation.reviewer_id},
    )
    db.commit()
    return delegation


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _auto_propose_precedent(
    db: Session,
    *,
    settings: Settings,
    review: Review,
    evaluation: Evaluation,
    user: User,
    justification: str,
) -> Precedent | None:
    if not review.semantic_signature or not evaluation.policy_matches:
        return None
    destination = _resolved_destination(db, evaluation, user.organisation_id)
    if destination is None:
        return None
    data_class = _precedent_data_class(evaluation)
    impact_class = evaluation.model_evidence.get("semantic_router", {}).get("organisation_defined_class", "STANDARD")
    policy_version_ids = sorted({item["policy_version_id"] for item in evaluation.policy_matches if item.get("policy_version_id")})
    if not policy_version_ids:
        return None
    fingerprint = _signature_fingerprint(review.semantic_signature, settings)
    duplicate = db.scalar(
        select(Precedent).where(
            Precedent.organisation_id == user.organisation_id,
            Precedent.department == evaluation.department,
            Precedent.role_context == evaluation.role_context,
            Precedent.purpose == evaluation.purpose,
            Precedent.data_class == data_class,
            Precedent.impact_class == impact_class,
            Precedent.ai_service == destination.service,
            Precedent.tenant == destination.tenant,
            Precedent.fingerprint == fingerprint,
            Precedent.status.in_(["ACTIVE", "PENDING_SECOND_REVIEW"]),
        )
    )
    if duplicate:
        return None

    supports = []
    candidate_rows = db.execute(
        select(Review, Evaluation)
        .join(Evaluation, Review.evaluation_id == Evaluation.id)
        .where(
            Review.organisation_id == user.organisation_id,
            Review.status == "DECIDED",
            Review.decision == "ALLOW",
            Review.id != review.id,
            Evaluation.department == evaluation.department,
            Evaluation.role_context == evaluation.role_context,
            Evaluation.purpose == evaluation.purpose,
            Evaluation.destination_origin == evaluation.destination_origin,
        )
        .order_by(Review.decided_at.desc())
        .limit(50)
    ).all()
    for prior_review, prior_evaluation in candidate_rows:
        if not prior_review.semantic_signature:
            continue
        if _precedent_data_class(prior_evaluation) != data_class:
            continue
        if prior_evaluation.model_evidence.get("semantic_router", {}).get("organisation_defined_class", "STANDARD") != impact_class:
            continue
        prior_policy_ids = sorted({item["policy_version_id"] for item in prior_evaluation.policy_matches if item.get("policy_version_id")})
        if prior_policy_ids != policy_version_ids:
            continue
        similarity = _comparison_similarity(review.semantic_signature, prior_review.semantic_signature, settings)
        if similarity >= settings.ace_similarity_threshold:
            supports.append((prior_review, prior_evaluation))

    if len(supports) + 1 < AUTO_PRECEDENT_MIN_SUPPORT:
        return None

    supporting_reviews = [item[0].id for item in supports[: AUTO_PRECEDENT_MIN_SUPPORT - 1]] + [review.id]
    support_scores = [item[1].risk_score for item in supports[: AUTO_PRECEDENT_MIN_SUPPORT - 1]] + [evaluation.risk_score]
    precedent = Precedent(
        source_review_id=review.id,
        organisation_id=user.organisation_id,
        department=evaluation.department,
        scope="DEPARTMENT",
        role_context=evaluation.role_context,
        purpose=evaluation.purpose,
        data_class=data_class,
        impact_class=impact_class,
        ai_service=destination.service,
        tenant=destination.tenant,
        risk_ceiling=min(0.95, max(support_scores) + 0.03),
        control="ALLOW",
        policy_version_id=policy_version_ids[0],
        policy_version_ids=policy_version_ids,
        reviewer_id=user.id,
        justification=(
            f"Auto-proposed from {len(supporting_reviews)} similar authorised ALLOW decisions. "
            f"Sponsoring reviewer note: {justification}"
        ),
        fingerprint=fingerprint,
        embedding=None,
        term_hashes=review.semantic_signature,
        expires_at=datetime.now(UTC) + timedelta(days=AUTO_PRECEDENT_VALIDITY_DAYS),
        reuse_limit=AUTO_PRECEDENT_REUSE_LIMIT,
        status="PENDING_SECOND_REVIEW",
    )
    db.add(precedent)
    db.flush()
    db.add(PrecedentApproval(
        precedent_id=precedent.id,
        requested_by=user.id,
        status="PENDING",
        justification="AI-proposed precedent requires independent approval before activation.",
    ))
    db.add(LearningArtefact(
        organisation_id=user.organisation_id,
        artefact_type="ACE_PRECEDENT",
        source_decision_ids=supporting_reviews,
        version="AUTO-1.0",
        status="PROPOSED",
        approved_by=user.id,
        precedent_id=precedent.id,
        provenance={
            "department": evaluation.department,
            "reviewer_id": user.id,
            "policy_version_id": precedent.policy_version_id,
            "model_weights_changed": False,
            "proposal_origin": "AUTO_PATTERN",
            "support_review_ids": supporting_reviews,
        },
    ))
    append_audit(
        db,
        event_type="ACE_PRECEDENT_AUTO_PROPOSED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="PRECEDENT",
        entity_id=precedent.id,
        payload={
            "source_review_id": review.id,
            "support_review_ids": supporting_reviews,
            "purpose": precedent.purpose,
            "risk_ceiling": precedent.risk_ceiling,
            "policy_version_id": precedent.policy_version_id,
            "expires_at": precedent.expires_at.isoformat(),
            "reuse_limit": precedent.reuse_limit,
            "status": precedent.status,
        },
    )
    append_audit(
        db,
        event_type="PRECEDENT_SECOND_REVIEW_REQUESTED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=review.department,
        entity_type="PRECEDENT",
        entity_id=precedent.id,
        payload={
            "source_review_id": review.id,
            "first_reviewer_id": user.id,
            "proposal_origin": "AUTO_PATTERN",
        },
    )
    return precedent


def _resolved_destination(db: Session, evaluation: Evaluation, organisation_id: str) -> Destination | None:
    if evaluation.destination_id:
        destination = db.get(Destination, evaluation.destination_id)
        if destination:
            return destination
    return db.scalar(
        select(Destination).where(
            Destination.organisation_id == organisation_id,
            Destination.origin == evaluation.destination_origin,
            Destination.trust_status == "APPROVED",
        )
    )


def _precedent_data_class(evaluation: Evaluation) -> str:
    findings = evaluation.findings or []
    confirmed = next((item.get("category") for item in findings if item.get("confirmed")), None)
    if confirmed:
        return str(confirmed)
    local_model = evaluation.model_evidence.get("local_model", {}) if evaluation.model_evidence else {}
    data_class = local_model.get("data_class")
    return str(data_class) if data_class else "PUBLIC_OR_INTERNAL_SAFE"


def _signature_fingerprint(signature: list[str], settings: Settings) -> str:
    task_hashes = {
        hashlib.sha256(f"{settings.prompt_hmac_key}:{token}".encode()).hexdigest()[:16]
        for token in ["ask", "asking", "create", "draft", "generate", "give", "help", "make", "prepare", "provide", "tell", "write"]
    }
    comparable = sorted(set(signature) - task_hashes)
    return hashlib.sha256("|".join(comparable).encode()).hexdigest()
