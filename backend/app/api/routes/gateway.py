import secrets
import time
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.config import Settings, get_settings
from app.core.security import issue_clearance, prompt_digest, verify_clearance
from app.db.models import ClearanceGrantRecord, Destination, Evaluation, User
from app.db.session import get_db
from app.schemas.evaluation import GatewayRequest, GatewayResponse, GrantRequest, GrantResponse
from app.services.audit import append_audit
from app.services.downstream import DownstreamError, downstream_adapter
from app.services.policy import active_policy_versions

router = APIRouter(tags=["Clearance and Gateway"])


@router.post("/evaluations/{evaluation_id}/clearance-grant", response_model=GrantResponse)
def create_grant(
    evaluation_id: str,
    body: GrantRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    evaluation = db.get(Evaluation, evaluation_id)
    if not evaluation or evaluation.user_id != user.id:
        raise HTTPException(status_code=404, detail="Evaluation was not found.")
    if evaluation.action != "ALLOW" or evaluation.state != "ALLOWED":
        raise HTTPException(status_code=409, detail="Only a final ALLOW decision can receive clearance.")
    if prompt_digest(body.prompt, settings) != evaluation.prompt_hmac:
        raise HTTPException(status_code=409, detail="The prompt changed after evaluation; run a complete new evaluation.")
    destination = db.get(Destination, evaluation.destination_id)
    if not destination or destination.trust_status != "APPROVED":
        raise HTTPException(status_code=409, detail="The approved destination is no longer active.")
    now = datetime.now(UTC)
    expiry = now + timedelta(seconds=settings.clearance_ttl_seconds)
    nonce = secrets.token_urlsafe(18)
    jti = f"grant_{secrets.token_hex(10)}"
    policy_versions = active_policy_versions(evaluation.policy_matches)
    claims = {
        "sub": user.id,
        "org": user.organisation_id,
        "department": user.department,
        "device": body.device_id,
        "destination": destination.id,
        "origin": destination.origin,
        "prompt_digest": evaluation.prompt_hmac,
        "policy_versions": policy_versions,
        "decision": "ALLOW",
        "iat": int(now.timestamp()),
        "exp": int(expiry.timestamp()),
        "nonce": nonce,
        "jti": jti,
    }
    token = issue_clearance(claims, settings)
    db.add(
        ClearanceGrantRecord(
            jti=jti,
            evaluation_id=evaluation.id,
            destination_id=destination.id,
            subject=user.id,
            nonce=nonce,
            issued_at=now,
            expires_at=expiry,
        )
    )
    append_audit(
        db,
        event_type="CLEARANCE_GRANT_ISSUED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="CLEARANCE_GRANT",
        entity_id=jti,
        payload={"evaluation_id": evaluation.id, "destination_id": destination.id, "expires_at": expiry.isoformat()},
    )
    db.commit()
    return GrantResponse(clearance_grant=token, expires_at=expiry, destination_id=destination.id)


@router.post("/gateway/v1/chat/completions", response_model=GatewayResponse)
def gateway_chat(
    body: GatewayRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    if not body.clearance_grant:
        _audit_denied(db, user, "MISSING_CLEARANCE_GRANT")
        raise HTTPException(status_code=403, detail="A valid GHST clearance grant is required.")
    try:
        claims = verify_clearance(body.clearance_grant, settings)
    except Exception as exc:
        _audit_denied(db, user, "INVALID_OR_EXPIRED_GRANT")
        raise HTTPException(status_code=403, detail="The clearance grant is invalid or expired.") from exc
    record = db.get(ClearanceGrantRecord, claims["jti"])
    prompt = "\n".join(str(item.get("content", "")) for item in body.messages)
    invalid = (
        not record
        or record.status != "ACTIVE"
        or record.used_at is not None
        or claims["sub"] != user.id
        or claims["department"] != user.department
        or claims["device"] != body.device_id
        or claims["prompt_digest"] != prompt_digest(prompt, settings)
        or record.destination_id != claims["destination"]
    )
    if invalid:
        _audit_denied(db, user, "GRANT_REPLAY_OR_CONTEXT_MISMATCH")
        raise HTTPException(status_code=403, detail="Clearance context mismatch, replay or modified prompt detected.")
    destination = db.get(Destination, record.destination_id)
    evaluation = db.get(Evaluation, record.evaluation_id)
    if (
        not destination
        or destination.trust_status != "APPROVED"
        or active_policy_versions(evaluation.policy_matches) != sorted(claims.get("policy_versions", []))
    ):
        _audit_denied(db, user, "DESTINATION_OR_POLICY_CHANGED")
        raise HTTPException(status_code=403, detail="Destination or policy version changed after clearance.")

    try:
        adapter = downstream_adapter(settings)
    except DownstreamError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    # Consume and persist the one-time grant before network delivery so a timeout
    # cannot turn the same authorisation into a replayable capability.
    record.used_at = datetime.now(UTC)
    record.status = "USED"
    append_audit(
        db,
        event_type="GATEWAY_DELIVERY_STARTED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="CLEARANCE_GRANT",
        entity_id=record.jti,
        payload={"evaluation_id": record.evaluation_id, "destination_id": destination.id, "adapter": adapter.name},
    )
    db.commit()
    try:
        choices = adapter.send(model=body.model, messages=body.messages)
    except DownstreamError as exc:
        append_audit(
            db,
            event_type="GATEWAY_DELIVERY_FAILED",
            actor_id=user.id,
            organisation_id=user.organisation_id,
            department=user.department,
            entity_type="CLEARANCE_GRANT",
            entity_id=record.jti,
            payload={"evaluation_id": record.evaluation_id, "adapter": adapter.name, "retry_requires_new_evaluation": True},
        )
        db.commit()
        raise HTTPException(status_code=502, detail=f"{exc} Run a fresh evaluation before retrying.") from exc
    append_audit(
        db,
        event_type="GATEWAY_FAST_PATH_ACCEPTED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="CLEARANCE_GRANT",
        entity_id=record.jti,
        payload={"evaluation_id": record.evaluation_id, "destination_id": destination.id, "downstream_mode": settings.downstream_mode, "adapter": adapter.name},
    )
    db.commit()
    return GatewayResponse(
        id=f"chatcmpl_{secrets.token_hex(8)}",
        created=int(time.time()),
        model=body.model,
        choices=choices,
        governance={"status": "VERIFIED", "evaluation_id": record.evaluation_id, "grant_id": record.jti},
    )


def _audit_denied(db: Session, user: User, reason: str) -> None:
    append_audit(
        db,
        event_type="GATEWAY_REQUEST_BLOCKED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="GATEWAY",
        entity_id="gateway-v1",
        payload={"reason_code": reason},
    )
    db.commit()
