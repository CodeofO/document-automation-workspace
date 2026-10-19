"""Table extraction job runner (job kinds ``table_extraction_job`` / ``table_extraction_batch``).

One job = one page. For every TableSpec of the job (or its ``table_keys`` subset):

1. crop the table region (+ padding, clamped to the page) from the *current* page image
   (``DocumentPage.image_path`` already reflects rotation correction) at original resolution,
   plus a downscaled whole page (long edge 1024) for orientation; without a region the whole
   page is sent once at original resolution;
2. one VLM call per table (``VlmGateway.extract_table``); the tables of a page run concurrently,
   bounded by the global VLM request limiter;
3. server-side normalization and validation (``app.domain.table_normalization``);
4. the result stores ``raw_model_output`` per table key, ``tables`` (TableResult[]) and the
   flattened ``validation_warnings``. Any table not ``ok`` → job ``needs_review``; every table
   failed → job ``failed``.
"""

import asyncio
from dataclasses import dataclass
from typing import Any

from PIL import Image

from app.audit import log_audit_event
from app.concurrency import run_workflow_blocking
from app.core.clock import utcnow
from app.core.db import SessionLocal
from app.document_modules import _finalize_module_batch, _mark_module_job_failed, _run_parallel_batch_async
from app.domain.module_job import ModuleJobLifecycle
from app.domain.status import ModuleJobStatus
from app.domain.table_normalization import (
    downscaled_size,
    failed_table_result,
    job_status_for_tables,
    padded_region,
    ratio_box_to_pixels,
    table_result_from_model,
    table_warnings,
)
from app.domain.table_spec import TableRegion, TableSpec, load_definition, select_tables
from app.models import Document, DocumentPage, TableExtractionBatch, TableExtractionJob, TableExtractionResult
from app.storage import materialize_storage_ref, scratch_dir_for_ref
from app.vlm import format_vlm_exception, get_vlm_gateway

PAGE_OVERVIEW_LONG_EDGE = 1024


@dataclass(frozen=True)
class TableJobContext:
    job_id: str
    document_id: str
    storage_path: str
    page_number: int
    image_path: str
    tables: list[TableSpec]


@dataclass(frozen=True)
class TableRequest:
    table: TableSpec
    image_inputs: list[dict[str, str]]
    region_used: dict[str, Any] | None

    @property
    def has_region_crop(self) -> bool:
        return self.region_used is not None


async def run_table_extraction_job_async(job_id: str) -> None:
    try:
        context = await run_workflow_blocking(_prepare_table_job, job_id)
        if not context:
            return
        requests = await run_workflow_blocking(build_table_requests, context)
        gateway = get_vlm_gateway()
        outputs = await asyncio.gather(
            *[gateway.extract_table(request.table, request.image_inputs, has_region_crop=request.has_region_crop) for request in requests],
            return_exceptions=True,
        )
        for output in outputs:
            if isinstance(output, asyncio.CancelledError):
                raise output
        await run_workflow_blocking(_save_table_result, job_id, context, requests, list(outputs))
    except Exception as exc:
        await run_workflow_blocking(_mark_table_job_failed, job_id, format_vlm_exception(exc))


async def run_table_extraction_batch_async(batch_id: str, job_ids: list[str]) -> None:
    await _run_parallel_batch_async(
        job_ids,
        run_table_extraction_job_async,
        _mark_table_job_failed,
        lambda: _finalize_module_batch(TableExtractionBatch, batch_id),
    )


def _prepare_table_job(job_id: str) -> TableJobContext | None:
    db = SessionLocal()
    try:
        job = db.get(TableExtractionJob, job_id)
        if not job or job.status != ModuleJobStatus.QUEUED:
            return None
        ModuleJobLifecycle(job).mark_running(utcnow())
        db.commit()
        document = db.get(Document, job.document_id)
        if not document:
            raise RuntimeError("Document not found")
        page_number = job.page_number or 1
        page = (
            db.query(DocumentPage)
            .filter(DocumentPage.document_id == document.id, DocumentPage.page_number == page_number)
            .one_or_none()
        )
        if not page:
            raise RuntimeError(f"Page {page_number} does not exist in this document")
        tables = select_tables(load_definition(job.definition_snapshot), job.table_keys)
        if not tables:
            raise RuntimeError("The table template has no tables to extract")
        return TableJobContext(
            job_id=job.id,
            document_id=document.id,
            storage_path=document.storage_path,
            page_number=page_number,
            image_path=page.image_path,
            tables=tables,
        )
    finally:
        db.close()


def build_table_requests(context: TableJobContext) -> list[TableRequest]:
    """Crop each table's region and prepare the images of its model call."""
    regional = [table for table in context.tables if table.region is not None]
    if not regional:
        return [TableRequest(table, [_whole_page_input(context)], None) for table in context.tables]

    work_dir = scratch_dir_for_ref(context.storage_path, "table_regions", context.job_id)
    with Image.open(materialize_storage_ref(context.image_path)) as source:
        image = source.convert("RGB")
    overview_path = work_dir / "page_overview.png"
    image.resize(downscaled_size(*image.size, long_edge=PAGE_OVERVIEW_LONG_EDGE), Image.Resampling.LANCZOS).save(overview_path)

    requests: list[TableRequest] = []
    for index, table in enumerate(context.tables, start=1):
        if table.region is None:
            requests.append(TableRequest(table, [_whole_page_input(context)], None))
            continue
        region_used = padded_region(table.region, table.region_padding)
        crop_path = work_dir / f"table_{index}_crop.png"
        image.crop(ratio_box_to_pixels(region_used, *image.size)).save(crop_path)
        requests.append(
            TableRequest(
                table,
                [
                    {"path": str(crop_path), "label": f"Crop of table '{table.name}' (page {context.page_number}, original resolution)."},
                    {"path": str(overview_path), "label": f"Whole page {context.page_number}, downscaled, for orientation only."},
                ],
                region_used,
            )
        )
    return requests


def region_image_inputs(
    storage_path: str,
    image_path: str,
    work_key: str,
    page_number: int,
    region: TableRegion | None,
    padding: float,
    label: str,
) -> tuple[list[dict[str, str]], dict[str, Any] | None]:
    """Images for one table call outside a job (AI column draft): padded region crop + downscaled page.

    Same crop rules as ``build_table_requests``; without a region the whole page is sent once.
    """
    if region is None:
        return [{"path": image_path, "label": f"Whole page {page_number}."}], None
    work_dir = scratch_dir_for_ref(storage_path, "table_regions", work_key)
    with Image.open(materialize_storage_ref(image_path)) as source:
        image = source.convert("RGB")
    region_used = padded_region(region, padding)
    crop_path = work_dir / "table_crop.png"
    overview_path = work_dir / "page_overview.png"
    image.crop(ratio_box_to_pixels(region_used, *image.size)).save(crop_path)
    image.resize(downscaled_size(*image.size, long_edge=PAGE_OVERVIEW_LONG_EDGE), Image.Resampling.LANCZOS).save(overview_path)
    return (
        [
            {"path": str(crop_path), "label": f"Crop of {label} (page {page_number}, original resolution)."},
            {"path": str(overview_path), "label": f"Whole page {page_number}, downscaled, for orientation only."},
        ],
        region_used,
    )


def _whole_page_input(context: TableJobContext) -> dict[str, str]:
    return {"path": context.image_path, "label": f"Whole page {context.page_number}."}


def _save_table_result(job_id: str, context: TableJobContext, requests: list[TableRequest], outputs: list[Any]) -> None:
    raw_output: dict[str, Any] = {}
    tables: list[dict[str, Any]] = []
    errors: list[str] = []
    for request, output in zip(requests, outputs, strict=True):
        key = request.table.key
        if isinstance(output, BaseException):
            message = format_vlm_exception(output) if isinstance(output, Exception) else str(output)
            raw_output[key] = {"error": message}
            tables.append(failed_table_result(request.table, message, request.region_used))
            errors.append(f"{key}: {message}")
        else:
            raw_output[key] = output
            tables.append(table_result_from_model(request.table, output, request.region_used))
    status = job_status_for_tables(tables)
    if status == "failed":
        _mark_table_job_failed(job_id, "; ".join(errors) or "Table extraction failed")
        return

    db = SessionLocal()
    try:
        job = db.get(TableExtractionJob, job_id)
        if not job:
            return
        if job.status == ModuleJobStatus.CANCELED:
            db.commit()
            return
        warnings = table_warnings(tables)
        result = TableExtractionResult(
            job_id=job.id,
            raw_model_output=raw_output,
            tables=tables,
            edit_log=[],
            reviewed=False,
            validation_warnings=warnings,
        )
        db.add(result)
        db.flush()
        job.result_id = result.id
        ModuleJobLifecycle(job).finish(needs_review=status == ModuleJobStatus.NEEDS_REVIEW, now=utcnow())
        log_audit_event(
            db,
            entity_type="table_extraction_job",
            entity_id=job.id,
            action=job.status,
            message="Table extraction completed" if job.status == ModuleJobStatus.COMPLETED else "Table extraction completed with review flags",
            metadata={
                "result_id": result.id,
                "document_id": context.document_id,
                "page_number": context.page_number,
                "tables": {table["table_key"]: table["status"] for table in tables},
            },
        )
        db.commit()
    finally:
        db.close()


def _mark_table_job_failed(job_id: str, message: str) -> None:
    _mark_module_job_failed(TableExtractionJob, "table_extraction_job", job_id, message)

