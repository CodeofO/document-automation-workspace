from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.jobs import schedule_job
from app.application import batches as batches_service
from app.application import documents as documents_service
from app.application.batches import ModuleKind, rotation_batch_read
from app.core.errors import ensure_found
from app.models import RotationBatch
from app.schemas import (
    DocumentRead,
    PageRotateRequest,
    RotationBatchFromDocumentsRequest,
    RotationBatchRead,
)

router = APIRouter()


@router.post("/api/rotation-batches/from-documents", response_model=RotationBatchRead)
def create_rotation_batch_from_documents(
    payload: RotationBatchFromDocumentsRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RotationBatchRead:
    response, dispatch = batches_service.create_batch_from_documents(ModuleKind.ROTATION, None, payload.document_ids, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.get("/api/rotation-batches", response_model=list[RotationBatchRead])
def list_rotation_batches(
    limit: int = Query(default=20, ge=1, le=100),
    include_items: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> list[RotationBatchRead]:
    batches = db.query(RotationBatch).order_by(RotationBatch.created_at.desc()).limit(limit).all()
    return [rotation_batch_read(batch, include_items=include_items, db=db) for batch in batches]


@router.get("/api/rotation-batches/{batch_id}", response_model=RotationBatchRead)
def get_rotation_batch(batch_id: str, db: Session = Depends(get_db)) -> RotationBatchRead:
    batch = db.get(RotationBatch, batch_id)
    ensure_found(batch, "Rotation batch not found")
    return rotation_batch_read(batch)


@router.get("/api/rotation-batches/{batch_id}/summary", response_model=RotationBatchRead)
def get_rotation_batch_summary(batch_id: str, db: Session = Depends(get_db)) -> RotationBatchRead:
    batch = db.get(RotationBatch, batch_id)
    ensure_found(batch, "Rotation batch not found")
    return rotation_batch_read(batch, include_items=False, db=db)


@router.post("/api/rotation-batches/{batch_id}/cancel", response_model=RotationBatchRead)
def cancel_rotation_batch(batch_id: str, db: Session = Depends(get_db)) -> RotationBatchRead:
    return batches_service.cancel_batch(ModuleKind.ROTATION, batch_id, db)


@router.post("/api/documents/{document_id}/pages/{page_number}/rotate", response_model=DocumentRead)
def rotate_document_page(
    document_id: str,
    page_number: int,
    payload: PageRotateRequest,
    db: Session = Depends(get_db),
) -> DocumentRead:
    return documents_service.rotate_document_page(document_id, page_number, payload, db)
