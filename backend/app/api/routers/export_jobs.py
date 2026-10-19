from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.jobs import schedule_job
from app.api.responses import download_headers
from app.application.dispatch import JobDispatch
from app.application.exports import export_job_read, queue_export_job
from app.core.errors import ConflictError, NotFoundError, ensure_found
from app.domain.status import ExportJobStatus
from app.models import ExportJob
from app.schemas import (
    ExportJobCreate,
    ExportJobRead,
)
from app.storage import materialize_storage_ref

router = APIRouter()


@router.post("/api/export-jobs", response_model=ExportJobRead, status_code=202)
def create_export_job(
    payload: ExportJobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ExportJobRead:
    job = queue_export_job(
        db,
        owner_type=payload.owner_type,
        owner_id=payload.owner_id,
        format=payload.format,
    )
    schedule_job(background_tasks, JobDispatch("export_job", (job.id,)))
    return export_job_read(job)


@router.get("/api/export-jobs", response_model=list[ExportJobRead])
def list_export_jobs(
    owner_type: str | None = Query(default=None, pattern="^(workflow_run|batch|classification_batch|required_field_check_batch|table_extraction_batch)$"),
    owner_id: str | None = Query(default=None),
    status: str | None = Query(default=None, pattern="^(queued|running|completed|failed)$"),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[ExportJobRead]:
    query = db.query(ExportJob)
    if owner_type:
        query = query.filter(ExportJob.owner_type == owner_type)
    if owner_id:
        query = query.filter(ExportJob.owner_id == owner_id)
    if status:
        query = query.filter(ExportJob.status == status)
    jobs = query.order_by(ExportJob.created_at.desc(), ExportJob.id.desc()).limit(limit).all()
    return [export_job_read(job) for job in jobs]


@router.post("/api/export-jobs/{job_id}/retry", response_model=ExportJobRead, status_code=202)
def retry_export_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ExportJobRead:
    source = db.get(ExportJob, job_id)
    ensure_found(source, "Export job not found")
    if source.status != ExportJobStatus.FAILED:
        raise ConflictError("Only failed export jobs can be retried")
    job = queue_export_job(
        db,
        owner_type=source.owner_type,
        owner_id=source.owner_id,
        format=source.format,
        retry_source_job_id=source.id,
    )
    schedule_job(background_tasks, JobDispatch("export_job", (job.id,)))
    return export_job_read(job)


@router.get("/api/export-jobs/{job_id}", response_model=ExportJobRead)
def get_export_job(job_id: str, db: Session = Depends(get_db)) -> ExportJobRead:
    job = db.get(ExportJob, job_id)
    ensure_found(job, "Export job not found")
    return export_job_read(job)


@router.get("/api/export-jobs/{job_id}/download")
def download_export_job(job_id: str, db: Session = Depends(get_db)) -> FileResponse:
    job = db.get(ExportJob, job_id)
    ensure_found(job, "Export job not found")
    if job.status != ExportJobStatus.COMPLETED or not job.storage_path or not job.filename:
        raise ConflictError("Export job is not ready for download")
    path = materialize_storage_ref(job.storage_path, suffix=Path(job.filename).suffix)
    if not path.exists():
        raise NotFoundError("Export artifact not found")
    return FileResponse(
        path,
        media_type=job.content_type or "application/octet-stream",
        headers=download_headers(job.filename),
    )
