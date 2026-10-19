from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditEvent


def log_audit_event(
    db: Session,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    message: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        message=message,
        metadata_json=dict(metadata or {}),
    )
    db.add(event)
    return event
