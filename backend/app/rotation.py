import asyncio
import os
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from PIL import Image

from app.audit import log_audit_event
from app.concurrency import run_workflow_blocking
from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.document_modules import _finalize_module_batch, _mark_module_job_failed, _run_parallel_batch_async
from app.domain.module_job import ModuleJobLifecycle
from app.domain.status import ModuleJobStatus, RotationPageStatus
from app.models import Document, DocumentPage, RotationBatch, RotationJob
from app.prompts.rotation import ORIENTATION_CANDIDATES, orientation_candidate_label
from app.storage import is_s3_ref, materialize_storage_ref, persist_artifact, read_storage_bytes, scratch_dir_for_ref
from app.vlm import format_vlm_exception, get_vlm_gateway

ROTATION_ANGLES = (0, 90, 180, 270)
# Corrections below this confidence are reported for review instead of being applied.
ROTATION_MIN_APPLY_CONFIDENCE = 0.6
ORIENTATION_CANDIDATE_LONG_EDGE = 1024

_CLOCKWISE_TRANSPOSE = {
    90: Image.Transpose.ROTATE_270,
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_90,
}
_DOCUMENT_ROTATION_LOCKS: dict[str, threading.Lock] = {}
_DOCUMENT_ROTATION_LOCKS_GUARD = threading.Lock()


@dataclass(frozen=True)
class RotationPageSnapshot:
    page_number: int
    image_path: str
    rotation_applied: int


def normalize_rotation(degrees: int) -> int:
    normalized = int(degrees) % 360
    if normalized not in ROTATION_ANGLES:
        raise ValueError(f"Rotation must be a multiple of 90 degrees: {degrees}")
    return normalized


def rotate_image_file(path: Path, clockwise_degrees: int, target: Path | None = None) -> tuple[int, int]:
    """Rotate an image file clockwise and write it atomically; returns the new (width, height)."""
    degrees = normalize_rotation(clockwise_degrees)
    target = target or path
    with Image.open(path) as source:
        image_format = source.format or ("PNG" if path.suffix.lower() == ".png" else "JPEG")
        image = source.transpose(_CLOCKWISE_TRANSPOSE[degrees]) if degrees else source.copy()
    if image_format == "JPEG" and image.mode not in {"RGB", "L"}:
        image = image.convert("RGB")
    temp_path = target.with_name(f".{target.stem}.{uuid4().hex}{target.suffix}")
    save_kwargs: dict[str, Any] = {"quality": get_settings().document_page_jpeg_quality, "optimize": True} if image_format == "JPEG" else {}
    image.save(temp_path, format=image_format, **save_kwargs)
    os.replace(temp_path, target)
    return image.width, image.height


def apply_page_rotation(document: Document, page: DocumentPage, clockwise_degrees: int) -> None:
    """Rotate a library page image in place and record the cumulative rotation. Caller commits."""
    degrees = normalize_rotation(clockwise_degrees)
    if not degrees:
        return
    with _document_rotation_lock(document.id):
        next_rotation = (page.rotation_applied + degrees) % 360
        if is_s3_ref(page.image_path):
            local_path = materialize_storage_ref(page.image_path)
            width, height = rotate_image_file(local_path, degrees)
            key = f"documents/{document.id}/pages/page_{page.page_number}_r{next_rotation}_{uuid4().hex[:8]}{local_path.suffix}"
            page.image_path = persist_artifact(local_path, key, "image/png" if local_path.suffix.lower() == ".png" else "image/jpeg")
        else:
            width, height = rotate_image_file(Path(page.image_path), degrees)
        page.width = width
        page.height = height
        page.rotation_applied = next_rotation


def build_orientation_candidates(image_ref: str) -> tuple[Path, list[dict[str, str]]]:
    """Write the A-D candidates (page turned 0/90/180/270 clockwise) to a scratch folder."""
    candidate_dir = scratch_dir_for_ref(image_ref, "rotation_candidates", uuid4().hex)
    source_path = candidate_dir / f"source{Path(str(image_ref)).suffix or '.jpg'}"
    source_path.write_bytes(read_storage_bytes(image_ref))
    with Image.open(source_path) as source:
        image = source.convert("RGB")
    image.thumbnail((ORIENTATION_CANDIDATE_LONG_EDGE, ORIENTATION_CANDIDATE_LONG_EDGE), Image.Resampling.LANCZOS)
    inputs: list[dict[str, str]] = []
    for letter, degrees in ORIENTATION_CANDIDATES:
        candidate = image.transpose(_CLOCKWISE_TRANSPOSE[degrees]) if degrees else image
        candidate_path = candidate_dir / f"candidate_{letter}.jpg"
        candidate.save(candidate_path, format="JPEG", quality=85)
        inputs.append({"path": str(candidate_path), "label": orientation_candidate_label(letter)})
    return candidate_dir, inputs


async def detect_page_rotation_async(page: RotationPageSnapshot) -> dict[str, Any]:
    candidate_dir, inputs = await asyncio.to_thread(build_orientation_candidates, page.image_path)
    try:
        raw = await get_vlm_gateway().detect_page_orientation(inputs)
    finally:
        shutil.rmtree(candidate_dir, ignore_errors=True)
    letter = str(raw.get("upright_candidate") or "").strip().upper()
    corrections = dict(ORIENTATION_CANDIDATES)
    if letter not in corrections:
        raise RuntimeError(f"VLM returned an unknown orientation candidate: {letter or '(empty)'}")
    correction = corrections[letter]
    return {
        "page_number": page.page_number,
        "rotation_before": page.rotation_applied,
        "detected_rotation": (360 - correction) % 360,
        "correction": correction,
        "confidence": _confidence_value(raw.get("confidence")),
        "reason": str(raw.get("reason") or ""),
        "upright_candidate": letter,
    }


def create_rotation_job(
    document: Document, db, *, status: str = ModuleJobStatus.QUEUED, page_number: int | None = None
) -> RotationJob:
    """``page_number`` limits the job to one page (workflow items); ``None`` checks every page (rotation batches)."""
    job = RotationJob(document_id=document.id, status=status, page_number=page_number)
    db.add(job)
    db.flush()
    return job


async def run_rotation_job_async(job_id: str) -> None:
    try:
        pages = await run_workflow_blocking(_prepare_rotation_job, job_id)
        if pages is None:
            return
        detections = await asyncio.gather(*(detect_page_rotation_async(page) for page in pages))
        await run_workflow_blocking(_save_rotation_result, job_id, list(detections))
    except Exception as exc:
        await run_workflow_blocking(mark_rotation_job_failed, job_id, format_vlm_exception(exc))


async def run_rotation_batch_async(batch_id: str, job_ids: list[str]) -> None:
    await _run_parallel_batch_async(
        job_ids,
        run_rotation_job_async,
        mark_rotation_job_failed,
        lambda: _finalize_module_batch(RotationBatch, batch_id),
    )


def mark_rotation_job_failed(job_id: str, message: str) -> None:
    _mark_module_job_failed(RotationJob, "rotation_job", job_id, message)


def rotation_job_pages(job: RotationJob) -> list[dict[str, Any]]:
    result = job.result_json
    if not isinstance(result, dict):
        return []
    return list(result.get("pages", []))


def _prepare_rotation_job(job_id: str) -> list[RotationPageSnapshot] | None:
    db = SessionLocal()
    try:
        job = db.get(RotationJob, job_id)
        if not job or job.status != ModuleJobStatus.QUEUED:
            return None
        ModuleJobLifecycle(job).mark_running(utcnow())
        db.commit()
        document = db.get(Document, job.document_id)
        if not document:
            raise RuntimeError("Document not found")
        pages = [
            RotationPageSnapshot(page_number=page.page_number, image_path=page.image_path, rotation_applied=page.rotation_applied)
            for page in sorted(document.pages, key=lambda item: item.page_number)
            if job.page_number is None or page.page_number == job.page_number
        ]
        if job.page_number is not None and not pages:
            raise RuntimeError(f"Page {job.page_number} does not exist in this document")
        return pages
    finally:
        db.close()


def _save_rotation_result(job_id: str, detections: list[dict[str, Any]]) -> None:
    db = SessionLocal()
    try:
        job = db.get(RotationJob, job_id)
        if not job or job.status == ModuleJobStatus.CANCELED:
            return
        document = db.get(Document, job.document_id)
        if not document:
            raise RuntimeError("Document not found")
        pages = {page.page_number: page for page in document.pages}
        corrected = 0
        needs_review = False
        for detection in detections:
            page = pages.get(detection["page_number"])
            confidence = detection["confidence"]
            detection["applied"] = False
            if not detection["correction"]:
                detection["status"] = RotationPageStatus.UPRIGHT
            elif confidence is not None and confidence < ROTATION_MIN_APPLY_CONFIDENCE:
                detection["status"] = RotationPageStatus.LOW_CONFIDENCE
                needs_review = True
            elif page is None or page.rotation_applied != detection["rotation_before"]:
                # Another job or a manual rotation changed this page while the VLM was looking at it.
                detection["status"] = RotationPageStatus.SKIPPED
                needs_review = True
            else:
                apply_page_rotation(document, page, detection["correction"])
                detection["applied"] = True
                detection["status"] = RotationPageStatus.CORRECTED
                corrected += 1
            detection["rotation_after"] = page.rotation_applied if page else detection["rotation_before"]
        job.result_json = {"pages": detections}
        job.corrected_page_count = corrected
        lifecycle = ModuleJobLifecycle(job)
        now = utcnow()
        if needs_review:
            lifecycle.needs_review(now)
        else:
            lifecycle.complete(now)
        log_audit_event(
            db,
            entity_type="rotation_job",
            entity_id=job.id,
            action=job.status,
            message=f"Rotation check finished; corrected {corrected} page(s)",
            metadata={"document_id": document.id, "corrected_page_count": corrected},
        )
        db.commit()
    finally:
        db.close()


def _document_rotation_lock(document_id: str) -> threading.Lock:
    with _DOCUMENT_ROTATION_LOCKS_GUARD:
        return _DOCUMENT_ROTATION_LOCKS.setdefault(document_id, threading.Lock())


def _confidence_value(value: Any) -> float | None:
    try:
        return None if value is None else max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return None
