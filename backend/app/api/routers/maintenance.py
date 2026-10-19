from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.application import maintenance as maintenance_service
from app.application.maintenance import audit_event_read, cleanup_expired_upload_data
from app.models import AuditEvent
from app.schemas import (
    ArchiveSearchResult,
    AuditEventRead,
)

router = APIRouter()


@router.get("/api/archive/search", response_model=list[ArchiveSearchResult])
def archive_search(
    q: str | None = None,
    status: str | None = None,
    schema_id: str | None = None,
    document_type: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[ArchiveSearchResult]:
    return maintenance_service.archive_search(db, q=q, status=status, schema_id=schema_id, document_type=document_type, limit=limit)


@router.delete("/api/maintenance/parsing-history")
def clear_parsing_history(db: Session = Depends(get_db)) -> dict[str, Any]:
    return maintenance_service.clear_parsing_history(db)


@router.post("/api/maintenance/retention-cleanup")
def run_retention_cleanup() -> dict[str, Any]:
    return cleanup_expired_upload_data()


@router.get("/api/audit-events", response_model=list[AuditEventRead])
def list_audit_events(
    entity_type: str | None = None,
    entity_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[AuditEventRead]:
    query = db.query(AuditEvent)
    if entity_type:
        query = query.filter(AuditEvent.entity_type == entity_type)
    if entity_id:
        query = query.filter(AuditEvent.entity_id == entity_id)
    events = query.order_by(AuditEvent.created_at.desc()).limit(limit).all()
    return [audit_event_read(event) for event in events]
