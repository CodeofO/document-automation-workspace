from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_db
from app.api.jobs import schedule_job, schedule_job_async
from app.api.responses import export_artifact_response
from app.api.uploads import ordered_upload_entries, read_batch_upload_form, required_form_value
from app.application import batches as batches_service
from app.application import module_jobs as module_jobs_service
from app.application.batches import ModuleKind, required_field_batch_read
from app.application.dispatch import JobDispatch
from app.application.exports import build_export_artifact
from app.application.module_jobs import required_field_job_read
from app.audit import log_audit_event
from app.core.errors import ensure_found
from app.models import (
    RequiredFieldCheckBatch,
    RequiredFieldCheckJob,
)
from app.schemas import (
    RequiredFieldCheckBatchFromDocumentsRequest,
    RequiredFieldCheckBatchInitRequest,
    RequiredFieldCheckBatchRead,
    RequiredFieldCheckJobCreate,
    RequiredFieldCheckJobRead,
    RequiredFieldCheckResultPatch,
    RequiredFieldCheckResultRead,
)

router = APIRouter()


@router.post("/api/required-field-check-jobs", response_model=RequiredFieldCheckJobRead)
def create_required_field_check_job(
    payload: RequiredFieldCheckJobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RequiredFieldCheckJobRead:
    response, dispatch = module_jobs_service.create_required_field_check_job(payload, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.get("/api/required-field-check-jobs/{job_id}", response_model=RequiredFieldCheckJobRead)
def get_required_field_check_job(job_id: str, db: Session = Depends(get_db)) -> RequiredFieldCheckJobRead:
    job = db.get(RequiredFieldCheckJob, job_id)
    ensure_found(job, "Required field check job not found")
    return required_field_job_read(job)


@router.patch("/api/required-field-check-results/{result_id}", response_model=RequiredFieldCheckResultRead)
def patch_required_field_check_result(
    result_id: str,
    payload: RequiredFieldCheckResultPatch,
    db: Session = Depends(get_db),
) -> RequiredFieldCheckResultRead:
    return module_jobs_service.patch_required_field_check_result(result_id, payload, db)


@router.post("/api/required-field-check-batches", response_model=RequiredFieldCheckBatchRead)
async def create_required_field_check_batch(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RequiredFieldCheckBatchRead:
    form, files = await read_batch_upload_form(request)
    checklist_id = required_form_value(form, "checklist_id")
    response, job_ids = await run_in_threadpool(
        batches_service.create_batch_from_uploads, ModuleKind.REQUIRED_CHECK, checklist_id, ordered_upload_entries(form, files), db
    )
    db.close()
    await schedule_job_async(background_tasks, JobDispatch("required_check_batch", (response.id, job_ids)))
    return response


@router.post("/api/required-field-check-batches/init", response_model=RequiredFieldCheckBatchRead)
def init_required_field_check_batch(
    payload: RequiredFieldCheckBatchInitRequest,
    db: Session = Depends(get_db),
) -> RequiredFieldCheckBatchRead:
    return batches_service.init_batch(ModuleKind.REQUIRED_CHECK, payload.checklist_id, payload.total_count, db)


@router.post("/api/required-field-check-batches/from-documents", response_model=RequiredFieldCheckBatchRead)
def create_required_field_check_batch_from_documents(
    payload: RequiredFieldCheckBatchFromDocumentsRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RequiredFieldCheckBatchRead:
    response, dispatch = batches_service.create_batch_from_documents(ModuleKind.REQUIRED_CHECK, payload.checklist_id, payload.document_ids, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.post("/api/required-field-check-batches/{batch_id}/items", response_model=RequiredFieldCheckBatchRead)
async def append_required_field_check_batch_items(
    batch_id: str, request: Request, db: Session = Depends(get_db)
) -> RequiredFieldCheckBatchRead:
    form, files = await read_batch_upload_form(request)
    return await run_in_threadpool(batches_service.append_uploads, ModuleKind.REQUIRED_CHECK, batch_id, ordered_upload_entries(form, files), db)


@router.post("/api/required-field-check-batches/{batch_id}/start", response_model=RequiredFieldCheckBatchRead)
def start_required_field_check_batch(
    batch_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RequiredFieldCheckBatchRead:
    response, dispatch = batches_service.start_batch(ModuleKind.REQUIRED_CHECK, batch_id, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.post("/api/required-field-check-batches/{batch_id}/discard", response_model=RequiredFieldCheckBatchRead)
def discard_required_field_check_batch(batch_id: str, db: Session = Depends(get_db)) -> RequiredFieldCheckBatchRead:
    return batches_service.discard_batch(ModuleKind.REQUIRED_CHECK, batch_id, db)


@router.post("/api/required-field-check-batches/{batch_id}/resume", response_model=RequiredFieldCheckBatchRead)
def resume_required_field_check_batch(
    batch_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> RequiredFieldCheckBatchRead:
    response, dispatch = batches_service.resume_batch(ModuleKind.REQUIRED_CHECK, batch_id, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.get("/api/required-field-check-batches", response_model=list[RequiredFieldCheckBatchRead])
def list_required_field_check_batches(
    limit: int = Query(default=20, ge=1, le=100),
    include_items: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> list[RequiredFieldCheckBatchRead]:
    batches = db.query(RequiredFieldCheckBatch).order_by(RequiredFieldCheckBatch.created_at.desc()).limit(limit).all()
    return [required_field_batch_read(batch, include_items=include_items, db=db) for batch in batches]


@router.get("/api/required-field-check-batches/{batch_id}", response_model=RequiredFieldCheckBatchRead)
def get_required_field_check_batch(batch_id: str, db: Session = Depends(get_db)) -> RequiredFieldCheckBatchRead:
    batch = db.get(RequiredFieldCheckBatch, batch_id)
    ensure_found(batch, "Required field check batch not found")
    return required_field_batch_read(batch)


@router.get("/api/required-field-check-batches/{batch_id}/summary", response_model=RequiredFieldCheckBatchRead)
def get_required_field_check_batch_summary(batch_id: str, db: Session = Depends(get_db)) -> RequiredFieldCheckBatchRead:
    batch = db.get(RequiredFieldCheckBatch, batch_id)
    ensure_found(batch, "Required field check batch not found")
    return required_field_batch_read(batch, include_items=False, db=db)


@router.post("/api/required-field-check-batches/{batch_id}/cancel", response_model=RequiredFieldCheckBatchRead)
def cancel_required_field_check_batch(batch_id: str, db: Session = Depends(get_db)) -> RequiredFieldCheckBatchRead:
    return batches_service.cancel_batch(ModuleKind.REQUIRED_CHECK, batch_id, db)


@router.get("/api/required-field-check-batches/{batch_id}/export")
def export_required_field_check_batch(
    batch_id: str,
    format: str = Query(default="csv", pattern="^(json|csv|xlsx)$"),
    db: Session = Depends(get_db),
) -> Response:
    batch = db.get(RequiredFieldCheckBatch, batch_id)
    ensure_found(batch, "Required field check batch not found")
    artifact = build_export_artifact(db, "required_field_check_batch", batch.id, format)
    log_audit_event(
        db,
        entity_type="required_field_check_batch",
        entity_id=batch.id,
        action="exported",
        message=f"Exported required field check batch {format.upper()}",
        metadata={"format": format},
    )
    db.commit()
    return export_artifact_response(artifact)
