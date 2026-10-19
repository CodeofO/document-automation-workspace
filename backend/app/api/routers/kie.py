from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.jobs import schedule_job
from app.api.responses import download_headers, export_artifact_response
from app.application import exports as exports_service
from app.application import module_jobs as module_jobs_service
from app.application.module_jobs import job_read
from app.core.errors import ensure_found
from app.models import (
    ExtractionJob,
)
from app.schemas import (
    DraftExtractionJobCreate,
    ExtractionJobCreate,
    ExtractionJobRead,
    ExtractionResultPatch,
)

router = APIRouter()


@router.post("/api/extraction-jobs", response_model=ExtractionJobRead)
def create_extraction_job(
    payload: ExtractionJobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ExtractionJobRead:
    response, dispatch = module_jobs_service.create_extraction_job(payload, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.post("/api/extraction-jobs/draft", response_model=ExtractionJobRead)
def create_draft_extraction_job(
    payload: DraftExtractionJobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ExtractionJobRead:
    response, dispatch = module_jobs_service.create_draft_extraction_job(payload, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.get("/api/extraction-jobs", response_model=list[ExtractionJobRead])
def list_extraction_jobs(
    document_id: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[ExtractionJobRead]:
    query = db.query(ExtractionJob)
    if document_id:
        query = query.filter(ExtractionJob.document_id == document_id)
    jobs = query.order_by(ExtractionJob.created_at.desc()).limit(limit).all()
    return [job_read(job) for job in jobs]


@router.get("/api/extraction-jobs/{job_id}", response_model=ExtractionJobRead)
def get_extraction_job(job_id: str, db: Session = Depends(get_db)) -> ExtractionJobRead:
    job = db.get(ExtractionJob, job_id)
    ensure_found(job, "Extraction job not found")
    return job_read(job)


@router.patch("/api/extraction-results/{result_id}")
def patch_extraction_result(
    result_id: str,
    payload: ExtractionResultPatch,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return module_jobs_service.patch_extraction_result(result_id, payload, db)


@router.get("/api/extraction-results/{result_id}/export")
def export_extraction_result(
    result_id: str,
    format: str = Query(default="json", pattern="^(json|csv|xlsx)$"),
    preset_id: str | None = None,
    db: Session = Depends(get_db),
) -> Response:
    exported = exports_service.export_extraction_result(result_id, format, preset_id, db)
    if exported.json_payload is not None:
        return JSONResponse(exported.json_payload, headers=download_headers(exported.filename))
    return export_artifact_response(exported.artifact)
