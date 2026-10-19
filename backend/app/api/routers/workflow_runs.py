"""Workflow run endpoints: creation (upload / chunked upload / library documents), execution control and export."""

from fastapi import APIRouter, BackgroundTasks, Body, Depends, Query, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_db
from app.api.jobs import schedule_job
from app.api.responses import export_artifact_response
from app.api.uploads import ordered_upload_entries, read_batch_upload_form
from app.application.dispatch import JobDispatch
from app.application.exports import build_export_artifact
from app.application.workflow_runs import RunOutcome, WorkflowRunApplicationService
from app.audit import log_audit_event
from app.core.errors import ensure_found
from app.models import WorkflowRun
from app.schemas import (
    WorkflowRunEnqueueRequest,
    WorkflowRunFromDocumentsRequest,
    WorkflowRunInitRequest,
    WorkflowRunRead,
    WorkflowRunRestartRequest,
)

router = APIRouter()


def _service(db: Session = Depends(get_db)) -> WorkflowRunApplicationService:
    return WorkflowRunApplicationService(db)


def _dispatch(outcome: RunOutcome, background_tasks: BackgroundTasks) -> WorkflowRunRead:
    if outcome.dispatch:
        schedule_job(background_tasks, JobDispatch("workflow_run", (outcome.dispatch.run_id, outcome.dispatch.execution_generation)))
    return outcome.run


@router.post("/api/workflows/{workflow_id}/runs", response_model=WorkflowRunRead)
async def create_workflow_run(
    workflow_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> WorkflowRunRead:
    form, files = await read_batch_upload_form(request)
    service = WorkflowRunApplicationService(db)
    outcome = await run_in_threadpool(service.create_from_uploads, workflow_id, ordered_upload_entries(form, files))
    db.close()
    return await run_in_threadpool(_dispatch, outcome, background_tasks)


@router.post("/api/workflows/{workflow_id}/runs/init", response_model=WorkflowRunRead)
def init_workflow_run(
    workflow_id: str,
    payload: WorkflowRunInitRequest,
    service: WorkflowRunApplicationService = Depends(_service),
) -> WorkflowRunRead:
    return service.init_upload(workflow_id, payload.total_count)


@router.post("/api/workflows/{workflow_id}/runs/from-documents", response_model=WorkflowRunRead)
def create_workflow_run_from_documents(
    workflow_id: str,
    payload: WorkflowRunFromDocumentsRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> WorkflowRunRead:
    outcome = WorkflowRunApplicationService(db).create_from_documents(workflow_id, payload.document_ids)
    if outcome.dispatch:
        db.close()
    return _dispatch(outcome, background_tasks)


@router.post("/api/workflow-runs/{run_id}/items", response_model=WorkflowRunRead)
async def append_workflow_run_items(
    run_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> WorkflowRunRead:
    form, files = await read_batch_upload_form(request)
    service = WorkflowRunApplicationService(db)
    return await run_in_threadpool(service.append_uploads, run_id, ordered_upload_entries(form, files))


@router.post("/api/workflow-runs/{run_id}/start", response_model=WorkflowRunRead)
def start_workflow_run(
    run_id: str,
    background_tasks: BackgroundTasks,
    service: WorkflowRunApplicationService = Depends(_service),
) -> WorkflowRunRead:
    return _dispatch(service.start(run_id), background_tasks)


@router.post("/api/workflow-runs/{run_id}/enqueue", response_model=WorkflowRunRead)
def enqueue_workflow_run(
    run_id: str,
    payload: WorkflowRunEnqueueRequest | None = Body(default=None),
    service: WorkflowRunApplicationService = Depends(_service),
) -> WorkflowRunRead:
    return service.enqueue(run_id, payload.workflow_id if payload else None)


@router.post("/api/workflow-runs/{run_id}/cancel-waiting", response_model=WorkflowRunRead)
def cancel_waiting_workflow_run(run_id: str, service: WorkflowRunApplicationService = Depends(_service)) -> WorkflowRunRead:
    return service.cancel_waiting(run_id)


@router.delete("/api/workflow-runs/{run_id}/queue-entry")
def delete_workflow_queue_entry(run_id: str, service: WorkflowRunApplicationService = Depends(_service)) -> dict[str, str]:
    return service.delete_queue_entry(run_id)


@router.post("/api/workflow-runs/{run_id}/discard", response_model=WorkflowRunRead)
def discard_workflow_run(run_id: str, service: WorkflowRunApplicationService = Depends(_service)) -> WorkflowRunRead:
    return service.discard(run_id)


@router.post("/api/workflow-runs/{run_id}/resume", response_model=WorkflowRunRead)
def resume_workflow_run(
    run_id: str,
    background_tasks: BackgroundTasks,
    service: WorkflowRunApplicationService = Depends(_service),
) -> WorkflowRunRead:
    return _dispatch(service.resume(run_id), background_tasks)


@router.post("/api/workflow-runs/{run_id}/pause", response_model=WorkflowRunRead)
def pause_workflow_run(run_id: str, service: WorkflowRunApplicationService = Depends(_service)) -> WorkflowRunRead:
    return service.pause(run_id)


@router.post("/api/workflow-runs/{run_id}/restart", response_model=WorkflowRunRead)
def restart_workflow_run(
    run_id: str,
    background_tasks: BackgroundTasks,
    payload: WorkflowRunRestartRequest | None = Body(default=None),
    service: WorkflowRunApplicationService = Depends(_service),
) -> WorkflowRunRead:
    return _dispatch(service.restart(run_id, payload.workflow_id if payload else None), background_tasks)


@router.post("/api/workflow-runs/{run_id}/retry-failed", response_model=WorkflowRunRead)
def retry_failed_workflow_run(
    run_id: str,
    background_tasks: BackgroundTasks,
    service: WorkflowRunApplicationService = Depends(_service),
) -> WorkflowRunRead:
    return _dispatch(service.retry_failed(run_id), background_tasks)


@router.get("/api/workflow-runs", response_model=list[WorkflowRunRead])
def list_workflow_runs(
    limit: int = Query(default=20, ge=1, le=100),
    service: WorkflowRunApplicationService = Depends(_service),
) -> list[WorkflowRunRead]:
    return service.list_recent(limit)


@router.get("/api/workflow-runs/{run_id}", response_model=WorkflowRunRead)
def get_workflow_run(run_id: str, service: WorkflowRunApplicationService = Depends(_service)) -> WorkflowRunRead:
    return service.get(run_id)


@router.get("/api/workflow-runs/{run_id}/summary", response_model=WorkflowRunRead)
def get_workflow_run_summary(run_id: str, service: WorkflowRunApplicationService = Depends(_service)) -> WorkflowRunRead:
    return service.get_summary(run_id)


@router.get("/api/workflow-runs/{run_id}/export")
def export_workflow_run(
    run_id: str,
    format: str = Query(default="csv", pattern="^(json|csv|xlsx)$"),
    db: Session = Depends(get_db),
) -> Response:
    run = db.get(WorkflowRun, run_id)
    ensure_found(run, "Workflow run not found")
    artifact = build_export_artifact(db, "workflow_run", run.id, format)
    log_audit_event(
        db,
        entity_type="workflow_run",
        entity_id=run.id,
        action="exported",
        message=f"Exported workflow run {format.upper()}",
        metadata={"format": format},
    )
    db.commit()
    return export_artifact_response(artifact)
