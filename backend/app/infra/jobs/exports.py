"""Export job execution (job kind ``export_job``)."""

import json
from pathlib import Path

from app.application.exports import build_export_artifact
from app.audit import log_audit_event
from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.errors import AppError
from app.domain.status import ExportJobStatus
from app.models import ExportJob
from app.storage import persist_artifact


def run_export_job(job_id: str) -> None:
    """Job entry point (``export_job``): build the artifact of a queued export job."""
    db = SessionLocal()
    try:
        started_at = utcnow()
        claimed_count = (
            db.query(ExportJob)
            .filter(ExportJob.id == job_id, ExportJob.status == ExportJobStatus.QUEUED)
            .update(
                {
                    ExportJob.status: ExportJobStatus.RUNNING,
                    ExportJob.started_at: started_at,
                    ExportJob.completed_at: None,
                    ExportJob.error_message: None,
                },
                synchronize_session=False,
            )
        )
        db.commit()
        if not claimed_count:
            return

        job = db.get(ExportJob, job_id)
        if not job:
            return
        artifact = build_export_artifact(db, job.owner_type, job.owner_id, job.format)
        target = _export_job_artifact_path(job.id, artifact.filename)
        target.write_bytes(artifact.content)
        storage_ref = persist_artifact(target, f"exports/{job.id}/{artifact.filename}", artifact.content_type)

        job.storage_path = storage_ref
        job.filename = artifact.filename
        job.content_type = artifact.content_type
        job.size_bytes = len(artifact.content)
        job.status = ExportJobStatus.COMPLETED
        job.completed_at = utcnow()
        log_audit_event(
            db,
            entity_type=job.owner_type,
            entity_id=job.owner_id,
            action="exported_async",
            message=f"Completed async export {artifact.filename}",
            metadata={"format": job.format, "export_job_id": job.id, "size_bytes": job.size_bytes},
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        failed_job = db.get(ExportJob, job_id)
        if failed_job:
            failed_job.status = ExportJobStatus.FAILED
            failed_job.error_message = _export_job_error_message(exc)
            failed_job.completed_at = utcnow()
            log_audit_event(
                db,
                entity_type="export_job",
                entity_id=failed_job.id,
                action="failed",
                message=failed_job.error_message,
                metadata={
                    "owner_type": failed_job.owner_type,
                    "owner_id": failed_job.owner_id,
                    "format": failed_job.format,
                },
            )
            db.commit()
    finally:
        db.close()


def _export_job_error_message(exc: Exception) -> str:
    detail = exc.detail if isinstance(exc, AppError) else str(exc)
    if isinstance(detail, dict | list):
        detail = json.dumps(detail, ensure_ascii=False, default=str)
    return str(detail or "Export failed")[:2000]


def _export_job_artifact_path(job_id: str, filename: str) -> Path:
    target_dir = get_settings().resolved_storage_dir / "exports" / job_id
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir / filename
