import hashlib
import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditEvent


def append_audit(
    db: Session,
    *,
    event_type: str,
    actor_id: str,
    organisation_id: str,
    department: str,
    entity_type: str,
    entity_id: str,
    payload: dict,
) -> AuditEvent:
    previous = db.scalars(select(AuditEvent).order_by(AuditEvent.sequence.desc()).limit(1)).first()
    previous_hash = previous.event_hash if previous else "0" * 64
    created_at = datetime.now(UTC)
    canonical = json.dumps(
        {
            "event_type": event_type,
            "actor_id": actor_id,
            "organisation_id": organisation_id,
            "department": department,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "payload": payload,
            "previous_hash": previous_hash,
            "created_at": _iso_utc(created_at),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    event = AuditEvent(
        event_type=event_type,
        actor_id=actor_id,
        organisation_id=organisation_id,
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
    return event


def verify_audit_chain(db: Session) -> dict:
    events = list(db.scalars(select(AuditEvent).order_by(AuditEvent.sequence)))
    previous_hash = "0" * 64
    for event in events:
        canonical = json.dumps(
            {
                "event_type": event.event_type,
                "actor_id": event.actor_id,
                "organisation_id": event.organisation_id,
                "department": event.department,
                "entity_type": event.entity_type,
                "entity_id": event.entity_id,
                "payload": event.payload,
                "previous_hash": event.previous_hash,
                "created_at": _iso_utc(event.created_at),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        expected = hashlib.sha256(canonical.encode()).hexdigest()
        if event.previous_hash != previous_hash or event.event_hash != expected:
            return {
                "valid": False,
                "checked_events": event.sequence - 1,
                "first_broken_sequence": event.sequence,
                "message": f"Integrity failure at event sequence {event.sequence}.",
            }
        previous_hash = event.event_hash
    return {
        "valid": True,
        "checked_events": len(events),
        "first_broken_sequence": None,
        "message": "The complete hash-linked audit chain is valid.",
    }


def _iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()
