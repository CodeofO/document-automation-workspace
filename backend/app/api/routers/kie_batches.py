from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_db
from app.api.jobs import schedule_job, schedule_job_async
from app.api.responses import export_artifact_response
from app.api.uploads import ordered_upload_entries, read_batch_upload_form, required_form_value
from app.application import batches as batches_service
from app.application.batches import ModuleKind, batch_read
from app.application.dispatch import JobDispatch
from app.application.exports import build_export_artifact
from app.audit import log_audit_event
from app.core.errors import ensure_found
from app.models import Batch
from app.schemas import (
    BatchFromDocumentsRequest,
    BatchInitRequest,
    BatchRead,
)

router = APIRouter()


@router.post("/api/batches", response_model=BatchRead)
async def create_batch(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> BatchRead:
    form, files = await read_batch_upload_form(request)
    schema_id = required_form_value(form, "schema_id")
    response, job_ids = await run_in_threadpool(batches_service.create_batch_from_uploads, ModuleKind.KIE, schema_id, ordered_upload_entries(form, files), db)
    db.close()
    await schedule_job_async(background_tasks, JobDispatch("extraction_batch", (response.id, job_ids)))
    return response


@router.post("/api/batches/init", response_model=BatchRead)
def init_batch(payload: BatchInitRequest, db: Session = Depends(get_db)) -> BatchRead:
    return batches_service.init_batch(ModuleKind.KIE, payload.schema_id, payload.total_count, db)


@router.post("/api/batches/from-documents", response_model=BatchRead)
def create_batch_from_documents(
    payload: BatchFromDocumentsRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> BatchRead:
    response, dispatch = batches_service.create_batch_from_documents(ModuleKind.KIE, payload.schema_id, payload.document_ids, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.post("/api/batches/{batch_id}/items", response_model=BatchRead)
async def append_batch_items(batch_id: str, request: Request, db: Session = Depends(get_db)) -> BatchRead:
    form, files = await read_batch_upload_form(request)
    return await run_in_threadpool(batches_service.append_uploads, ModuleKind.KIE, batch_id, ordered_upload_entries(form, files), db)


@router.post("/api/batches/{batch_id}/start", response_model=BatchRead)
def start_batch(batch_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> BatchRead:
    response, dispatch = batches_service.start_batch(ModuleKind.KIE, batch_id, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.post("/api/batches/{batch_id}/discard", response_model=BatchRead)
def discard_batch(batch_id: str, db: Session = Depends(get_db)) -> BatchRead:
    return batches_service.discard_batch(ModuleKind.KIE, batch_id, db)


@router.post("/api/batches/{batch_id}/resume", response_model=BatchRead)
def resume_batch(batch_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> BatchRead:
    response, dispatch = batches_service.resume_batch(ModuleKind.KIE, batch_id, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.get("/api/batches", response_model=list[BatchRead])
def list_batches(
    limit: int = Query(default=20, ge=1, le=100),
    include_items: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> list[BatchRead]:
    batches = db.query(Batch).order_by(Batch.created_at.desc()).limit(limit).all()
    return [batch_read(batch, include_items=include_items, db=db) for batch in batches]


@router.get("/api/batches/{batch_id}", response_model=BatchRead)
def get_batch(batch_id: str, db: Session = Depends(get_db)) -> BatchRead:
    batch = db.get(Batch, batch_id)
    ensure_found(batch, "Batch not found")
    return batch_read(batch)


@router.get("/api/batches/{batch_id}/summary", response_model=BatchRead)
def get_batch_summary(batch_id: str, db: Session = Depends(get_db)) -> BatchRead:
    batch = db.get(Batch, batch_id)
    ensure_found(batch, "Batch not found")
    return batch_read(batch, include_items=False, db=db)


@router.post("/api/batches/{batch_id}/cancel", response_model=BatchRead)
def cancel_batch(batch_id: str, db: Session = Depends(get_db)) -> BatchRead:
    return batches_service.cancel_batch(ModuleKind.KIE, batch_id, db)


@router.get("/api/batches/{batch_id}/export")
def export_batch(
    batch_id: str,
    format: str = Query(default="csv", pattern="^(json|csv|xlsx)$"),
    db: Session = Depends(get_db),
) -> Response:
    batch = db.get(Batch, batch_id)
    ensure_found(batch, "Batch not found")
    artifact = build_export_artifact(db, "batch", batch.id, format)
    log_audit_event(
        db,
        entity_type="batch",
        entity_id=batch.id,
        action="exported",
        message=f"Exported batch {format.upper()}",
        metadata={"format": format},
    )
    db.commit()
    return export_artifact_response(artifact)
