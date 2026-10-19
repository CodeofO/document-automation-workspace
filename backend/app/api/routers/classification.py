from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_db
from app.api.jobs import schedule_job, schedule_job_async
from app.api.responses import export_artifact_response
from app.api.uploads import ordered_upload_entries, read_batch_upload_form, required_form_value
from app.application import batches as batches_service
from app.application import module_jobs as module_jobs_service
from app.application.batches import ModuleKind, classification_batch_read
from app.application.dispatch import JobDispatch
from app.application.exports import build_export_artifact
from app.application.module_jobs import classification_job_read
from app.audit import log_audit_event
from app.core.errors import ensure_found
from app.models import (
    ClassificationBatch,
    ClassificationJob,
)
from app.schemas import (
    ClassificationBatchFromDocumentsRequest,
    ClassificationBatchInitRequest,
    ClassificationBatchRead,
    ClassificationJobCreate,
    ClassificationJobRead,
    ClassificationResultPatch,
    ClassificationResultRead,
)

router = APIRouter()


@router.post("/api/classification-jobs", response_model=ClassificationJobRead)
def create_classification_job(
    payload: ClassificationJobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ClassificationJobRead:
    response, dispatch = module_jobs_service.create_classification_job(payload, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.get("/api/classification-jobs/{job_id}", response_model=ClassificationJobRead)
def get_classification_job(job_id: str, db: Session = Depends(get_db)) -> ClassificationJobRead:
    job = db.get(ClassificationJob, job_id)
    ensure_found(job, "Classification job not found")
    return classification_job_read(job)


@router.patch("/api/classification-results/{result_id}", response_model=ClassificationResultRead)
def patch_classification_result(
    result_id: str,
    payload: ClassificationResultPatch,
    db: Session = Depends(get_db),
) -> ClassificationResultRead:
    return module_jobs_service.patch_classification_result(result_id, payload, db)


@router.post("/api/classification-batches", response_model=ClassificationBatchRead)
async def create_classification_batch(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ClassificationBatchRead:
    form, files = await read_batch_upload_form(request)
    classifier_id = required_form_value(form, "classifier_id")
    response, job_ids = await run_in_threadpool(
        batches_service.create_batch_from_uploads, ModuleKind.CLASSIFICATION, classifier_id, ordered_upload_entries(form, files), db
    )
    db.close()
    await schedule_job_async(background_tasks, JobDispatch("classification_batch", (response.id, job_ids)))
    return response


@router.post("/api/classification-batches/init", response_model=ClassificationBatchRead)
def init_classification_batch(
    payload: ClassificationBatchInitRequest,
    db: Session = Depends(get_db),
) -> ClassificationBatchRead:
    return batches_service.init_batch(ModuleKind.CLASSIFICATION, payload.classifier_id, payload.total_count, db)


@router.post("/api/classification-batches/from-documents", response_model=ClassificationBatchRead)
def create_classification_batch_from_documents(
    payload: ClassificationBatchFromDocumentsRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ClassificationBatchRead:
    response, dispatch = batches_service.create_batch_from_documents(ModuleKind.CLASSIFICATION, payload.classifier_id, payload.document_ids, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.post("/api/classification-batches/{batch_id}/items", response_model=ClassificationBatchRead)
async def append_classification_batch_items(batch_id: str, request: Request, db: Session = Depends(get_db)) -> ClassificationBatchRead:
    form, files = await read_batch_upload_form(request)
    return await run_in_threadpool(batches_service.append_uploads, ModuleKind.CLASSIFICATION, batch_id, ordered_upload_entries(form, files), db)


@router.post("/api/classification-batches/{batch_id}/start", response_model=ClassificationBatchRead)
def start_classification_batch(
    batch_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ClassificationBatchRead:
    response, dispatch = batches_service.start_batch(ModuleKind.CLASSIFICATION, batch_id, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.post("/api/classification-batches/{batch_id}/discard", response_model=ClassificationBatchRead)
def discard_classification_batch(batch_id: str, db: Session = Depends(get_db)) -> ClassificationBatchRead:
    return batches_service.discard_batch(ModuleKind.CLASSIFICATION, batch_id, db)


@router.post("/api/classification-batches/{batch_id}/resume", response_model=ClassificationBatchRead)
def resume_classification_batch(
    batch_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ClassificationBatchRead:
    response, dispatch = batches_service.resume_batch(ModuleKind.CLASSIFICATION, batch_id, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.get("/api/classification-batches", response_model=list[ClassificationBatchRead])
def list_classification_batches(
    limit: int = Query(default=20, ge=1, le=100),
    include_items: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> list[ClassificationBatchRead]:
    batches = db.query(ClassificationBatch).order_by(ClassificationBatch.created_at.desc()).limit(limit).all()
    return [classification_batch_read(batch, include_items=include_items, db=db) for batch in batches]


@router.get("/api/classification-batches/{batch_id}", response_model=ClassificationBatchRead)
def get_classification_batch(batch_id: str, db: Session = Depends(get_db)) -> ClassificationBatchRead:
    batch = db.get(ClassificationBatch, batch_id)
    ensure_found(batch, "Classification batch not found")
    return classification_batch_read(batch)


@router.get("/api/classification-batches/{batch_id}/summary", response_model=ClassificationBatchRead)
def get_classification_batch_summary(batch_id: str, db: Session = Depends(get_db)) -> ClassificationBatchRead:
    batch = db.get(ClassificationBatch, batch_id)
    ensure_found(batch, "Classification batch not found")
    return classification_batch_read(batch, include_items=False, db=db)


@router.post("/api/classification-batches/{batch_id}/cancel", response_model=ClassificationBatchRead)
def cancel_classification_batch(batch_id: str, db: Session = Depends(get_db)) -> ClassificationBatchRead:
    return batches_service.cancel_batch(ModuleKind.CLASSIFICATION, batch_id, db)


@router.get("/api/classification-batches/{batch_id}/export")
def export_classification_batch(
    batch_id: str,
    format: str = Query(default="csv", pattern="^(json|csv|xlsx)$"),
    db: Session = Depends(get_db),
) -> Response:
    batch = db.get(ClassificationBatch, batch_id)
    ensure_found(batch, "Classification batch not found")
    artifact = build_export_artifact(db, "classification_batch", batch.id, format)
    log_audit_event(
        db,
        entity_type="classification_batch",
        entity_id=batch.id,
        action="exported",
        message=f"Exported classification batch {format.upper()}",
        metadata={"format": format},
    )
    db.commit()
    return export_artifact_response(artifact)
