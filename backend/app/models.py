from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.infra.persistence.json_types import JSONText


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("doc"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    storage_path: Mapped[str] = mapped_column(String, nullable=False)
    library_path: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="ready")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_type: Mapped[str | None] = mapped_column(String, nullable=True)
    language: Mapped[str | None] = mapped_column(String, nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommendation_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    pages: Mapped[list["DocumentPage"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="DocumentPage.page_number",
    )


class DocumentConversionJob(Base):
    __tablename__ = "document_conversion_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("document_conversion_job"))
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    document: Mapped[Document] = relationship()


class DocumentLibraryFolder(Base):
    __tablename__ = "document_library_folders"
    __table_args__ = (Index("ix_document_library_folders_workspace_path", "workspace_id", "path", unique=True),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("library_folder"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    path: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class DocumentPage(Base):
    __tablename__ = "document_pages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("page"))
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    image_path: Mapped[str] = mapped_column(String, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    # Clockwise degrees (0/90/180/270) applied to the rasterized page by rotation correction.
    rotation_applied: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    document: Mapped[Document] = relationship(back_populates="pages")


class Schema(Base):
    __tablename__ = "schemas"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("schema"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    schema_json: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    is_template: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    template_category: Mapped[str | None] = mapped_column(String, nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ephemeral: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class ExtractionJob(Base):
    __tablename__ = "extraction_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("job"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    # Page this unit of work covers (1-based). NULL = the whole document (rows created before page-level processing).
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    schema_id: Mapped[str] = mapped_column(ForeignKey("schemas.id"), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_id: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    document: Mapped[Document] = relationship()
    schema: Mapped[Schema] = relationship()
    result: Mapped["ExtractionResult | None"] = relationship(
        back_populates="job",
        uselist=False,
        cascade="all, delete-orphan",
        primaryjoin="ExtractionJob.id == ExtractionResult.job_id",
    )


class ExtractionResult(Base):
    __tablename__ = "extraction_results"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("result"))
    job_id: Mapped[str] = mapped_column(ForeignKey("extraction_jobs.id"), nullable=False, unique=True)
    raw_model_output: Mapped[Any] = mapped_column(JSONText, nullable=False)
    validated_output: Mapped[Any] = mapped_column(JSONText, nullable=False)
    corrected_output: Mapped[Any | None] = mapped_column(JSONText, nullable=True)
    validation_warnings: Mapped[list[Any]] = mapped_column(JSONText, nullable=False, default=list)
    reviewed_fields: Mapped[list[str]] = mapped_column(JSONText, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    job: Mapped[ExtractionJob] = relationship(back_populates="result")


class RawExtraction(Base):
    __tablename__ = "raw_extractions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("raw"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    source_format: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String, nullable=False, default="")
    pdf_path: Mapped[str | None] = mapped_column(String, nullable=True)
    html_path: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="processing")
    warnings: Mapped[list[str]] = mapped_column(JSONText, nullable=False, default=list)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class DocumentClassifier(Base):
    __tablename__ = "document_classifiers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("classifier"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    allow_unknown: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class ClassificationJob(Base):
    __tablename__ = "classification_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("classification_job"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    # Page this unit of work covers (1-based). NULL = the whole document (rows created before page-level processing).
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    classifier_id: Mapped[str] = mapped_column(ForeignKey("document_classifiers.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_id: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    document: Mapped[Document] = relationship()
    classifier: Mapped[DocumentClassifier] = relationship()
    result: Mapped["ClassificationResult | None"] = relationship(
        back_populates="job",
        uselist=False,
        cascade="all, delete-orphan",
        primaryjoin="ClassificationJob.id == ClassificationResult.job_id",
    )


class ClassificationResult(Base):
    __tablename__ = "classification_results"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("classification_result"))
    job_id: Mapped[str] = mapped_column(ForeignKey("classification_jobs.id"), nullable=False, unique=True)
    raw_model_output: Mapped[Any] = mapped_column(JSONText, nullable=False)
    validated_output: Mapped[Any] = mapped_column(JSONText, nullable=False)
    corrected_output: Mapped[Any | None] = mapped_column(JSONText, nullable=True)
    reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    job: Mapped[ClassificationJob] = relationship(back_populates="result")


class ClassificationBatch(Base):
    __tablename__ = "classification_batches"
    __table_args__ = (Index("ix_classification_batches_created_at_id", "created_at", "id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("classification_batch"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    classifier_id: Mapped[str] = mapped_column(ForeignKey("document_classifiers.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    classifier: Mapped[DocumentClassifier] = relationship()
    items: Mapped[list["ClassificationBatchItem"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="ClassificationBatchItem.created_at",
    )


class ClassificationBatchItem(Base):
    __tablename__ = "classification_batch_items"
    __table_args__ = (
        Index("ix_classification_batch_items_batch_job", "batch_id", "job_id"),
        Index("ix_classification_batch_items_batch_upload_index", "batch_id", "upload_index"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("classification_batch_item"))
    batch_id: Mapped[str] = mapped_column(ForeignKey("classification_batches.id"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    # Page this unit of work covers (1-based). NULL = the whole document (rows created before page-level processing).
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("classification_jobs.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    upload_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    batch: Mapped[ClassificationBatch] = relationship(back_populates="items")
    document: Mapped[Document] = relationship()
    job: Mapped[ClassificationJob] = relationship()


class RequiredFieldChecklist(Base):
    __tablename__ = "required_field_checklists"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("checklist"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RequiredFieldCheckJob(Base):
    __tablename__ = "required_field_check_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("required_check_job"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    # Page this unit of work covers (1-based). NULL = the whole document (rows created before page-level processing).
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checklist_id: Mapped[str] = mapped_column(ForeignKey("required_field_checklists.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_id: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    document: Mapped[Document] = relationship()
    checklist: Mapped[RequiredFieldChecklist] = relationship()
    result: Mapped["RequiredFieldCheckResult | None"] = relationship(
        back_populates="job",
        uselist=False,
        cascade="all, delete-orphan",
        primaryjoin="RequiredFieldCheckJob.id == RequiredFieldCheckResult.job_id",
    )


class RequiredFieldCheckResult(Base):
    __tablename__ = "required_field_check_results"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("required_check_result"))
    job_id: Mapped[str] = mapped_column(ForeignKey("required_field_check_jobs.id"), nullable=False, unique=True)
    raw_model_output: Mapped[Any] = mapped_column(JSONText, nullable=False)
    validated_output: Mapped[Any] = mapped_column(JSONText, nullable=False)
    corrected_output: Mapped[Any | None] = mapped_column(JSONText, nullable=True)
    reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    job: Mapped[RequiredFieldCheckJob] = relationship(back_populates="result")


class RequiredFieldCheckBatch(Base):
    __tablename__ = "required_field_check_batches"
    __table_args__ = (Index("ix_required_field_check_batches_created_at_id", "created_at", "id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("required_check_batch"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    checklist_id: Mapped[str] = mapped_column(ForeignKey("required_field_checklists.id"), nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    checklist: Mapped[RequiredFieldChecklist] = relationship()
    items: Mapped[list["RequiredFieldCheckBatchItem"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="RequiredFieldCheckBatchItem.created_at",
    )


class RequiredFieldCheckBatchItem(Base):
    __tablename__ = "required_field_check_batch_items"
    __table_args__ = (
        Index("ix_required_field_check_batch_items_batch_job", "batch_id", "job_id"),
        Index("ix_required_field_check_batch_items_batch_upload_index", "batch_id", "upload_index"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("required_check_batch_item"))
    batch_id: Mapped[str] = mapped_column(ForeignKey("required_field_check_batches.id"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    # Page this unit of work covers (1-based). NULL = the whole document (rows created before page-level processing).
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("required_field_check_jobs.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    upload_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    batch: Mapped[RequiredFieldCheckBatch] = relationship(back_populates="items")
    document: Mapped[Document] = relationship()
    job: Mapped[RequiredFieldCheckJob] = relationship()


class Batch(Base):
    __tablename__ = "batches"
    __table_args__ = (Index("ix_batches_created_at_id", "created_at", "id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("batch"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    schema_id: Mapped[str] = mapped_column(ForeignKey("schemas.id"), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    schema: Mapped[Schema] = relationship()
    items: Mapped[list["BatchItem"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="BatchItem.created_at",
    )


class BatchItem(Base):
    __tablename__ = "batch_items"
    __table_args__ = (
        Index("ix_batch_items_batch_job", "batch_id", "job_id"),
        Index("ix_batch_items_batch_upload_index", "batch_id", "upload_index"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("batch_item"))
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    # Page this unit of work covers (1-based). NULL = the whole document (rows created before page-level processing).
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("extraction_jobs.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    upload_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    batch: Mapped[Batch] = relationship(back_populates="items")
    document: Mapped[Document] = relationship()
    job: Mapped[ExtractionJob] = relationship()


class ExportPreset(Base):
    __tablename__ = "export_presets"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("preset"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    schema_id: Mapped[str | None] = mapped_column(ForeignKey("schemas.id"), nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    fields_json: Mapped[list[dict[str, Any]]] = mapped_column(JSONText, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    schema: Mapped[Schema | None] = relationship()


class ExportJob(Base):
    __tablename__ = "export_jobs"
    __table_args__ = (
        Index("ix_export_jobs_owner_created_at", "owner_type", "owner_id", "created_at"),
        Index("ix_export_jobs_status_created_at", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("export_job"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    owner_type: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[str] = mapped_column(String, nullable=False)
    format: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    filename: Mapped[str | None] = mapped_column(String, nullable=True)
    storage_path: Mapped[str | None] = mapped_column(String, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class WorkflowDefinition(Base):
    __tablename__ = "workflow_definitions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("workflow"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    definition_json: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    runs: Mapped[list["WorkflowRun"]] = relationship(back_populates="workflow")


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"
    __table_args__ = (
        Index("ix_workflow_runs_created_at_id", "created_at", "id"),
        Index("ix_workflow_runs_queue_group_status_order", "workflow_run_group_id", "status", "queue_order", "created_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("workflow_run"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflow_definitions.id"), nullable=False)
    workflow_name: Mapped[str | None] = mapped_column(String, nullable=True)
    workflow_definition_json: Mapped[dict[str, Any] | None] = mapped_column(JSONText, nullable=True)
    restarted_from_run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    workflow_run_group_id: Mapped[str | None] = mapped_column(String, nullable=True)
    queued_from_run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    queue_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    upload_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    inference_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    inference_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    execution_generation: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    workflow: Mapped[WorkflowDefinition] = relationship(back_populates="runs")
    items: Mapped[list["WorkflowRunItem"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="WorkflowRunItem.filename",
    )


class WorkflowRunItem(Base):
    __tablename__ = "workflow_run_items"
    __table_args__ = (
        Index("ix_workflow_run_items_run_status", "run_id", "status"),
        Index("ix_workflow_run_items_run_upload_index", "run_id", "upload_index"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("workflow_item"))
    run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    # Page this unit of work covers (1-based). NULL = the whole document (rows created before page-level processing).
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    upload_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    upload_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    inference_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    execution_generation: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    result_json: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    run: Mapped[WorkflowRun] = relationship(back_populates="items")
    document: Mapped[Document] = relationship()


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("audit"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_id: Mapped[str] = mapped_column(String, nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class RotationJob(Base):
    __tablename__ = "rotation_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("rotation_job"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    # Page this unit of work covers (1-based). NULL = the whole document (rows created before page-level processing).
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSONText, nullable=True)
    corrected_page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    document: Mapped[Document] = relationship()


class RotationBatch(Base):
    __tablename__ = "rotation_batches"
    __table_args__ = (Index("ix_rotation_batches_created_at_id", "created_at", "id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("rotation_batch"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    items: Mapped[list["RotationBatchItem"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="RotationBatchItem.created_at",
    )


class RotationBatchItem(Base):
    __tablename__ = "rotation_batch_items"
    __table_args__ = (
        Index("ix_rotation_batch_items_batch_job", "batch_id", "job_id"),
        Index("ix_rotation_batch_items_batch_upload_index", "batch_id", "upload_index"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("rotation_batch_item"))
    batch_id: Mapped[str] = mapped_column(ForeignKey("rotation_batches.id"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    job_id: Mapped[str] = mapped_column(ForeignKey("rotation_jobs.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    upload_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    batch: Mapped[RotationBatch] = relationship(back_populates="items")
    document: Mapped[Document] = relationship()
    job: Mapped[RotationJob] = relationship()


class JobQueueEntry(Base):
    """One unit of background work for the in-process job runtime (``app.infra.jobs``).

    ``kind`` names a ``JobRunners`` entry point and ``payload`` holds its positional
    arguments. A worker claims a ``queued`` row by moving it to ``running`` with a lease
    (``lease_owner`` / ``lease_expires_at``) that it keeps extending (``heartbeat_at``);
    a row whose lease expired is put back to ``queued`` and runs again.
    """

    __tablename__ = "job_queue"
    __table_args__ = (
        Index("ix_job_queue_status_available_at", "status", "available_at"),
        Index("ix_job_queue_kind_target", "kind", "target_id"),
        Index("ix_job_queue_dedupe_key", "dedupe_key"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("job_queue"))
    kind: Mapped[str] = mapped_column(String, nullable=False)
    # The domain row the job works on (batch, workflow run, module job, conversion job, export job).
    target_id: Mapped[str | None] = mapped_column(String, nullable=True)
    payload: Mapped[list[Any]] = mapped_column(JSONText, nullable=False, default=list)
    # Queued/running jobs with the same key are not enqueued twice.
    dedupe_key: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    lease_owner: Mapped[str | None] = mapped_column(String, nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    available_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AppSetting(Base):
    """Runtime override of an environment-backed setting (``key`` is the env variable name).

    The environment (and ``.env``) provides the defaults; a row here wins over it. Written by
    ``PUT /api/settings/vlm``.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class TableTemplate(Base):
    """Table extraction template: one document form with one or more repeating-row tables (``{"tables": [TableSpec]}``)."""

    __tablename__ = "table_templates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("table_template"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    definition_json: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    # Editor preview samples: [{document_id, page_number}].
    sample_refs_json: Mapped[list[dict[str, Any]]] = mapped_column(JSONText, nullable=False, default=list)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ephemeral: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class TableExtractionJob(Base):
    __tablename__ = "table_extraction_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("table_job"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    # Page this unit of work covers (1-based). NULL only for a placeholder waiting for its document to convert.
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    template_id: Mapped[str] = mapped_column(ForeignKey("table_templates.id"), nullable=False)
    template_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # The template definition at creation time ({"tables": [...]}), so results stay reproducible.
    definition_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    # Run only these table keys (editor preview); NULL = every table.
    table_keys: Mapped[list[str] | None] = mapped_column(JSONText, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_id: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    document: Mapped[Document] = relationship()
    template: Mapped[TableTemplate] = relationship()
    result: Mapped["TableExtractionResult | None"] = relationship(
        back_populates="job",
        uselist=False,
        cascade="all, delete-orphan",
        primaryjoin="TableExtractionJob.id == TableExtractionResult.job_id",
    )


class TableExtractionResult(Base):
    __tablename__ = "table_extraction_results"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("table_result"))
    job_id: Mapped[str] = mapped_column(ForeignKey("table_extraction_jobs.id"), nullable=False, unique=True)
    # Model response per table key ({table_key: {...}} or {table_key: {"error": ...}}).
    raw_model_output: Mapped[Any] = mapped_column(JSONText, nullable=False)
    # TableResult[] after server-side normalization and validation.
    tables: Mapped[list[Any]] = mapped_column(JSONText, nullable=False, default=list)
    # Reviewer copy of every table with edits applied (TableResult[]); NULL until the first edit.
    corrected_tables: Mapped[list[Any] | None] = mapped_column(JSONText, nullable=True)
    edit_log: Mapped[list[Any]] = mapped_column(JSONText, nullable=False, default=list)
    reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    validation_warnings: Mapped[list[Any]] = mapped_column(JSONText, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    job: Mapped[TableExtractionJob] = relationship(back_populates="result")


class TableExtractionBatch(Base):
    __tablename__ = "table_extraction_batches"
    __table_args__ = (Index("ix_table_extraction_batches_created_at_id", "created_at", "id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("table_batch"))
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    template_id: Mapped[str] = mapped_column(ForeignKey("table_templates.id"), nullable=False)
    template_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Template definition when the batch was created; every page job of the batch runs this snapshot.
    definition_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    template: Mapped[TableTemplate] = relationship()
    items: Mapped[list["TableExtractionBatchItem"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="TableExtractionBatchItem.created_at",
    )


class TableExtractionBatchItem(Base):
    __tablename__ = "table_extraction_batch_items"
    __table_args__ = (
        Index("ix_table_extraction_batch_items_batch_job", "batch_id", "job_id"),
        Index("ix_table_extraction_batch_items_batch_upload_index", "batch_id", "upload_index"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("table_batch_item"))
    batch_id: Mapped[str] = mapped_column(ForeignKey("table_extraction_batches.id"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("table_extraction_jobs.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    upload_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    batch: Mapped[TableExtractionBatch] = relationship(back_populates="items")
    document: Mapped[Document] = relationship()
    job: Mapped[TableExtractionJob] = relationship()
