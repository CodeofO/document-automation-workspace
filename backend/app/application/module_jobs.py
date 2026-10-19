from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.application.definitions import validate_schema_region_references
from app.application.dispatch import JobDispatch
from app.application.documents import (
    execution_job_status_for_document,
    raise_document_not_executable,
    repair_image_document_if_needed,
)
from app.application.page_units import document_page_numbers, page_slots
from app.audit import log_audit_event
from app.core.errors import NotFoundError, UnprocessableError, ensure_found
from app.document_modules import (
    classification_result_to_dict,
    required_field_result_to_dict,
)
from app.domain.status import DocumentStatus, JobAdmission
from app.extraction import result_to_dict
from app.models import (
    ClassificationJob,
    ClassificationResult,
    Document,
    DocumentClassifier,
    ExtractionJob,
    ExtractionResult,
    RequiredFieldCheckJob,
    RequiredFieldChecklist,
    RequiredFieldCheckResult,
    Schema,
)
from app.schemas import (
    ClassificationJobCreate,
    ClassificationJobRead,
    ClassificationResultPatch,
    ClassificationResultRead,
    DraftExtractionJobCreate,
    ExtractionJobCreate,
    ExtractionJobRead,
    ExtractionResultPatch,
    PageJobRef,
    RequiredFieldCheckJobCreate,
    RequiredFieldCheckJobRead,
    RequiredFieldCheckResultPatch,
    RequiredFieldCheckResultRead,
)


def classification_job_read(job: ClassificationJob) -> ClassificationJobRead:
    return ClassificationJobRead(
        job_id=job.id,
        document_id=job.document_id,
        page_number=job.page_number,
        classifier_id=job.classifier_id,
        status=job.status,
        error_message=job.error_message,
        result_id=job.result_id,
        result=ClassificationResultRead(**classification_result_to_dict(job.result)) if job.result else None,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def required_field_job_read(job: RequiredFieldCheckJob) -> RequiredFieldCheckJobRead:
    return RequiredFieldCheckJobRead(
        job_id=job.id,
        document_id=job.document_id,
        page_number=job.page_number,
        checklist_id=job.checklist_id,
        status=job.status,
        error_message=job.error_message,
        result_id=job.result_id,
        result=RequiredFieldCheckResultRead(**required_field_result_to_dict(job.result)) if job.result else None,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def job_read(job: ExtractionJob) -> ExtractionJobRead:
    return ExtractionJobRead(
        job_id=job.id,
        document_id=job.document_id,
        page_number=job.page_number,
        schema_id=job.schema_id,
        status=job.status,
        error_message=job.error_message,
        result_id=job.result_id,
        result=result_to_dict(job.result) if job.result else None,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def patch_extraction_result(result_id: str, payload: ExtractionResultPatch, db: Session) -> dict[str, Any]:
    result = db.get(ExtractionResult, result_id)
    if not result:
        raise NotFoundError("Extraction result not found")
    if payload.corrected_output is not None:
        result.corrected_output = payload.corrected_output
    if payload.reviewed_fields is not None:
        result.reviewed_fields = list(payload.reviewed_fields)
    log_audit_event(
        db,
        entity_type="extraction_result",
        entity_id=result.id,
        action="review_saved",
        message="Review changes saved",
        metadata={
            "has_corrections": payload.corrected_output is not None,
            "reviewed_count": len(payload.reviewed_fields or []),
        },
    )
    db.commit()
    db.refresh(result)
    return result_to_dict(result)


def patch_classification_result(result_id: str, payload: ClassificationResultPatch, db: Session) -> ClassificationResultRead:
    result = db.get(ClassificationResult, result_id)
    if not result:
        raise NotFoundError("Classification result not found")
    if payload.corrected_output is not None:
        result.corrected_output = payload.corrected_output
    if payload.reviewed is not None:
        result.reviewed = payload.reviewed
    db.commit()
    db.refresh(result)
    return ClassificationResultRead(**classification_result_to_dict(result))


def patch_required_field_check_result(result_id: str, payload: RequiredFieldCheckResultPatch, db: Session) -> RequiredFieldCheckResultRead:
    result = db.get(RequiredFieldCheckResult, result_id)
    if not result:
        raise NotFoundError("Required field check result not found")
    if payload.corrected_output is not None:
        result.corrected_output = payload.corrected_output
    if payload.reviewed is not None:
        result.reviewed = payload.reviewed
    db.commit()
    db.refresh(result)
    return RequiredFieldCheckResultRead(**required_field_result_to_dict(result))


def single_job_page_numbers(document: Document, requested: int | None, db: Session) -> list[int | None]:
    """Pages a single-job request covers.

    * ``page_number`` given: that page only (checked against the document's pages when it is ready).
    * omitted: every page of a ready document (one job each; a single-page document gives page 1),
      or one placeholder job (``None``) while the document is still converting — it is expanded into
      per-page jobs when the document becomes ready (``infra.jobs.conversion``).
    """
    if requested is None:
        return page_slots(document, db)
    if document.status == DocumentStatus.READY:
        page_numbers = document_page_numbers(document, db)
        if page_numbers and requested not in page_numbers:
            raise UnprocessableError(f"Page {requested} does not exist in this document ({len(page_numbers)} page(s))")
    return [requested]


def _admit_document(document: Document | None, db: Session) -> JobAdmission:
    ensure_found(document, "Document not found")
    status = execution_job_status_for_document(document)
    if status == JobAdmission.BLOCKED:
        raise_document_not_executable(document)
    if document.status == DocumentStatus.READY:
        repair_image_document_if_needed(document, db)
    return status


def _create_page_jobs(
    db: Session,
    document: Document,
    page_numbers: list[int | None],
    status: JobAdmission,
    make_job: Callable[[int | None], Any],
    *,
    entity_type: str,
    message: str,
    metadata: dict[str, Any],
) -> list[Any]:
    jobs = []
    for page_number in page_numbers:
        job = make_job(page_number)
        job.document_id = document.id
        job.page_number = page_number
        job.status = status
        db.add(job)
        db.flush()
        log_audit_event(
            db,
            entity_type=entity_type,
            entity_id=job.id,
            action="created",
            message=message,
            metadata={"document_id": document.id, "page_number": page_number, **metadata},
        )
        jobs.append(job)
    db.commit()
    for job in jobs:
        db.refresh(job)
    return jobs


def _single_job_response(jobs: list[Any], read: Callable[[Any], Any], runner: str, status: JobAdmission) -> tuple[Any, list[JobDispatch]]:
    response = read(jobs[0])
    if len(jobs) > 1:
        response.page_jobs = [PageJobRef(job_id=job.id, page_number=job.page_number) for job in jobs]
    dispatches = [JobDispatch(runner, (job.id,)) for job in jobs] if status == JobAdmission.READY else []
    return response, dispatches


def create_extraction_job(payload: ExtractionJobCreate, db: Session) -> tuple[ExtractionJobRead, list[JobDispatch]]:
    document = db.get(Document, payload.document_id)
    schema = db.get(Schema, payload.schema_id)
    ensure_found(document, "Document not found")
    if not schema:
        raise NotFoundError("Schema not found")
    status = _admit_document(document, db)
    jobs = _create_page_jobs(
        db,
        document,
        single_job_page_numbers(document, payload.page_number, db),
        status,
        lambda _page: ExtractionJob(schema_id=schema.id, schema_version=1),
        entity_type="extraction_job",
        message="Extraction job created",
        metadata={"schema_id": schema.id},
    )
    return _single_job_response(jobs, job_read, "extraction_job", status)


def create_draft_extraction_job(payload: DraftExtractionJobCreate, db: Session) -> tuple[ExtractionJobRead, list[JobDispatch]]:
    document = db.get(Document, payload.document_id)
    status = _admit_document(document, db)
    page_numbers = single_job_page_numbers(document, payload.page_number, db)

    draft_schema = payload.schema_definition
    schema_data = draft_schema.model_dump()
    schema_data["is_template"] = False
    schema_data["template_category"] = None
    schema_data["pinned"] = False
    validate_schema_region_references(schema_data)

    schema = Schema(
        name=draft_schema.name,
        display_name=draft_schema.display_name or draft_schema.name,
        description=draft_schema.description,
        current_version=1,
        schema_json=schema_data,
        is_template=False,
        template_category=None,
        pinned=False,
        ephemeral=True,
        archived=False,
    )
    db.add(schema)
    db.flush()
    jobs = _create_page_jobs(
        db,
        document,
        page_numbers,
        status,
        lambda _page: ExtractionJob(schema_id=schema.id, schema_version=1),
        entity_type="extraction_job",
        message="Draft extraction job created",
        metadata={"schema_id": schema.id, "schema_mode": "draft"},
    )
    return _single_job_response(jobs, job_read, "extraction_job", status)


def create_classification_job(payload: ClassificationJobCreate, db: Session) -> tuple[ClassificationJobRead, list[JobDispatch]]:
    document = db.get(Document, payload.document_id)
    classifier = db.get(DocumentClassifier, payload.classifier_id)
    ensure_found(document, "Document not found")
    if not classifier or classifier.archived:
        raise NotFoundError("Document classifier not found")
    status = _admit_document(document, db)
    jobs = _create_page_jobs(
        db,
        document,
        single_job_page_numbers(document, payload.page_number, db),
        status,
        lambda _page: ClassificationJob(classifier_id=classifier.id),
        entity_type="classification_job",
        message="Classification job created",
        metadata={"classifier_id": classifier.id},
    )
    return _single_job_response(jobs, classification_job_read, "classification_job", status)


def create_required_field_check_job(
    payload: RequiredFieldCheckJobCreate, db: Session
) -> tuple[RequiredFieldCheckJobRead, list[JobDispatch]]:
    document = db.get(Document, payload.document_id)
    checklist = db.get(RequiredFieldChecklist, payload.checklist_id)
    ensure_found(document, "Document not found")
    if not checklist or checklist.archived:
        raise NotFoundError("Required field checklist not found")
    status = _admit_document(document, db)
    jobs = _create_page_jobs(
        db,
        document,
        single_job_page_numbers(document, payload.page_number, db),
        status,
        lambda _page: RequiredFieldCheckJob(checklist_id=checklist.id),
        entity_type="required_field_check_job",
        message="Required field check job created",
        metadata={"checklist_id": checklist.id},
    )
    return _single_job_response(jobs, required_field_job_read, "required_check_job", status)
