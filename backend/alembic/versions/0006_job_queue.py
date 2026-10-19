"""durable job queue + schema reconciliation

1. Brings every database to the full schema the models describe. Until now some columns
   and tables were only ever added by the app's startup ``create_all`` and its
   ``_run_lightweight_migrations`` ALTERs (both removed in this release): the library
   tables, upload bookkeeping columns, workflow run timing/queue/generation columns and
   their indexes. Each step is skipped when the column/table/index already exists, so a
   database that was kept current by the startup migrator, one built by the old
   ``create_all``-based 0001, and one built from the frozen 0001 baseline all end up
   identical. The legacy ``schemas.schema_json`` backfill from ``schema_versions`` is
   carried over as well.
2. Adds ``job_queue``, the table behind the in-process job runtime (``app.infra.jobs``).

Revision ID: 0006_job_queue
Revises: 0005_page_level_units
Create Date: 2026-10-15 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_job_queue"
down_revision = "0005_page_level_units"
branch_labels = None
depends_on = None


LEGACY_COLUMNS: dict[str, list[tuple[str, sa.types.TypeEngine, dict]]] = {
    "documents": [
        ("library_path", sa.String(), {}),
        ("error_message", sa.Text(), {}),
        ("document_type", sa.String(), {}),
        ("language", sa.String(), {}),
        ("ai_summary", sa.Text(), {}),
        ("recommendation_reasoning", sa.Text(), {}),
        ("deleted_at", sa.DateTime(), {}),
    ],
    "schemas": [
        ("schema_json", sa.Text(), {}),
        ("is_template", sa.Boolean(), {"nullable": False, "server_default": "0"}),
        ("template_category", sa.String(), {}),
        ("pinned", sa.Boolean(), {"nullable": False, "server_default": "0"}),
        ("ephemeral", sa.Boolean(), {"nullable": False, "server_default": "0"}),
        ("archived", sa.Boolean(), {"nullable": False, "server_default": "0"}),
    ],
    "extraction_results": [
        ("reviewed_fields", sa.Text(), {"nullable": False, "server_default": "[]"}),
    ],
    "batch_items": [("client_file_id", sa.String(), {}), ("upload_index", sa.Integer(), {})],
    "classification_batch_items": [("client_file_id", sa.String(), {}), ("upload_index", sa.Integer(), {})],
    "required_field_check_batch_items": [("client_file_id", sa.String(), {}), ("upload_index", sa.Integer(), {})],
    "workflow_runs": [
        ("workflow_name", sa.String(), {}),
        ("workflow_definition_json", sa.Text(), {}),
        ("restarted_from_run_id", sa.String(), {}),
        ("workflow_run_group_id", sa.String(), {}),
        ("queued_from_run_id", sa.String(), {}),
        ("queue_order", sa.Integer(), {}),
        ("upload_duration_ms", sa.Integer(), {}),
        ("inference_duration_ms", sa.Integer(), {}),
        ("started_at", sa.DateTime(), {}),
        ("inference_started_at", sa.DateTime(), {}),
        ("execution_generation", sa.Integer(), {"nullable": False, "server_default": "0"}),
    ],
    "workflow_run_items": [
        ("client_file_id", sa.String(), {}),
        ("upload_index", sa.Integer(), {}),
        ("upload_duration_ms", sa.Integer(), {}),
        ("inference_duration_ms", sa.Integer(), {}),
        ("execution_generation", sa.Integer(), {"nullable": False, "server_default": "0"}),
    ],
    "document_pages": [
        ("rotation_applied", sa.Integer(), {"nullable": False, "server_default": "0"}),
    ],
}

# workspace_id (0003/0004) and page_number (0005) on every table that has them in the models.
SCOPED_TABLES = [
    "documents",
    "document_library_folders",
    "schemas",
    "extraction_jobs",
    "raw_extractions",
    "document_classifiers",
    "classification_jobs",
    "classification_batches",
    "required_field_checklists",
    "required_field_check_jobs",
    "required_field_check_batches",
    "rotation_jobs",
    "rotation_batches",
    "batches",
    "export_presets",
    "export_jobs",
    "workflow_definitions",
    "workflow_runs",
    "audit_events",
]
PAGE_SCOPED_TABLES = [
    "extraction_jobs",
    "classification_jobs",
    "required_field_check_jobs",
    "rotation_jobs",
    "batch_items",
    "classification_batch_items",
    "required_field_check_batch_items",
    "workflow_run_items",
]

INDEX_SPECS = [
    ("ix_workflow_runs_created_at_id", "workflow_runs", ["created_at", "id"], False),
    ("ix_workflow_runs_queue_group_status_order", "workflow_runs", ["workflow_run_group_id", "status", "queue_order", "created_at"], False),
    ("ix_workflow_run_items_run_status", "workflow_run_items", ["run_id", "status"], False),
    ("ix_workflow_run_items_run_upload_index", "workflow_run_items", ["run_id", "upload_index"], False),
    ("ix_batches_created_at_id", "batches", ["created_at", "id"], False),
    ("ix_batch_items_batch_job", "batch_items", ["batch_id", "job_id"], False),
    ("ix_batch_items_batch_upload_index", "batch_items", ["batch_id", "upload_index"], False),
    ("ix_rotation_batches_created_at_id", "rotation_batches", ["created_at", "id"], False),
    ("ix_rotation_batch_items_batch_job", "rotation_batch_items", ["batch_id", "job_id"], False),
    ("ix_rotation_batch_items_batch_upload_index", "rotation_batch_items", ["batch_id", "upload_index"], False),
    ("ix_classification_batches_created_at_id", "classification_batches", ["created_at", "id"], False),
    ("ix_classification_batch_items_batch_job", "classification_batch_items", ["batch_id", "job_id"], False),
    ("ix_classification_batch_items_batch_upload_index", "classification_batch_items", ["batch_id", "upload_index"], False),
    ("ix_required_field_check_batches_created_at_id", "required_field_check_batches", ["created_at", "id"], False),
    ("ix_required_field_check_batch_items_batch_job", "required_field_check_batch_items", ["batch_id", "job_id"], False),
    (
        "ix_required_field_check_batch_items_batch_upload_index",
        "required_field_check_batch_items",
        ["batch_id", "upload_index"],
        False,
    ),
    ("ix_export_jobs_owner_created_at", "export_jobs", ["owner_type", "owner_id", "created_at"], False),
    ("ix_export_jobs_status_created_at", "export_jobs", ["status", "created_at"], False),
    ("ix_document_library_folders_workspace_path", "document_library_folders", ["workspace_id", "path"], True),
    *((f"ix_{table}_workspace_id", table, ["workspace_id"], False) for table in SCOPED_TABLES),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "document_conversion_jobs" not in tables:
        op.create_table(
            "document_conversion_jobs",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("document_id", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["document_id"], ["documents.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    if "document_library_folders" not in tables:
        op.create_table(
            "document_library_folders",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("workspace_id", sa.String(), nullable=True),
            sa.Column("path", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    tables = set(sa.inspect(bind).get_table_names())

    columns_to_add = {table: list(specs) for table, specs in LEGACY_COLUMNS.items()}
    for table in SCOPED_TABLES:
        columns_to_add.setdefault(table, []).insert(0, ("workspace_id", sa.String(), {}))
    for table in PAGE_SCOPED_TABLES:
        columns_to_add.setdefault(table, []).append(("page_number", sa.Integer(), {}))
    for table, specs in columns_to_add.items():
        if table not in tables:
            continue
        existing = {column["name"] for column in sa.inspect(bind).get_columns(table)}
        for name, type_, options in specs:
            if name not in existing:
                op.add_column(
                    table, sa.Column(name, type_, nullable=options.get("nullable", True), server_default=options.get("server_default"))
                )

    inspector = sa.inspect(bind)
    for index_name, table, columns, unique in INDEX_SPECS:
        if table not in tables:
            continue
        if not set(columns) <= {column["name"] for column in inspector.get_columns(table)}:
            continue  # a partial legacy table; nothing to index
        if index_name not in {index["name"] for index in inspector.get_indexes(table)}:
            op.create_index(index_name, table, columns, unique=unique)

    if "schema_versions" in tables:
        # Carried over from the startup migrator: very old databases kept the schema body only in schema_versions.
        op.execute(
            """
            UPDATE schemas
            SET schema_json = (
                SELECT schema_versions.schema_json
                FROM schema_versions
                WHERE schema_versions.schema_id = schemas.id
                  AND schema_versions.version = schemas.current_version
                LIMIT 1
            )
            WHERE (schema_json IS NULL OR schema_json = '' OR schema_json = '{}')
              AND EXISTS (
                SELECT 1
                FROM schema_versions
                WHERE schema_versions.schema_id = schemas.id
                  AND schema_versions.version = schemas.current_version
              )
            """
        )

    if "job_queue" not in tables:
        op.create_table(
            "job_queue",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("target_id", sa.String(), nullable=True),
            sa.Column("payload", sa.Text(), nullable=False),
            sa.Column("dedupe_key", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("max_attempts", sa.Integer(), nullable=False),
            sa.Column("lease_owner", sa.String(), nullable=True),
            sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
            sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
            sa.Column("available_at", sa.DateTime(), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_job_queue_status_available_at", "job_queue", ["status", "available_at"])
        op.create_index("ix_job_queue_kind_target", "job_queue", ["kind", "target_id"])
        op.create_index("ix_job_queue_dedupe_key", "job_queue", ["dedupe_key"])


def downgrade() -> None:
    # Only the queue is dropped: the reconciled columns are part of the schema 0005 already
    # assumed (the startup migrator used to add them).
    op.drop_index("ix_job_queue_dedupe_key", table_name="job_queue")
    op.drop_index("ix_job_queue_kind_target", table_name="job_queue")
    op.drop_index("ix_job_queue_status_available_at", table_name="job_queue")
    op.drop_table("job_queue")
