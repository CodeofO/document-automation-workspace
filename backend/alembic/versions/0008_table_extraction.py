"""table extraction module

``table_templates`` → ``table_extraction_jobs`` → ``table_extraction_results`` plus
``table_extraction_batches`` / ``table_extraction_batch_items`` (docs/table-extraction-design.md §3).
Tables that already exist (e.g. created by ``create_all`` in tests or an older startup path)
are skipped, as are their indexes.

Revision ID: 0008_table_extraction
Revises: 0007_app_settings
Create Date: 2026-10-19 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_table_extraction"
down_revision = "0007_app_settings"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _ensure_index(name: str, table: str, columns: list[str]) -> None:
    if name not in {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}:
        op.create_index(name, table, columns, unique=False)


def upgrade() -> None:
    tables = _tables()
    if "table_templates" not in tables:
        op.create_table(
            "table_templates",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("workspace_id", sa.String(), nullable=True),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("display_name", sa.String(), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("current_version", sa.Integer(), nullable=False),
            sa.Column("definition_json", sa.Text(), nullable=False),
            sa.Column("sample_refs_json", sa.Text(), nullable=False),
            sa.Column("pinned", sa.Boolean(), nullable=False),
            sa.Column("ephemeral", sa.Boolean(), nullable=False),
            sa.Column("archived", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    _ensure_index("ix_table_templates_workspace_id", "table_templates", ["workspace_id"])

    if "table_extraction_jobs" not in tables:
        op.create_table(
            "table_extraction_jobs",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("workspace_id", sa.String(), nullable=True),
            sa.Column("document_id", sa.String(), nullable=False),
            sa.Column("page_number", sa.Integer(), nullable=True),
            sa.Column("template_id", sa.String(), nullable=False),
            sa.Column("template_version", sa.Integer(), nullable=False),
            sa.Column("definition_snapshot", sa.Text(), nullable=False),
            sa.Column("table_keys", sa.Text(), nullable=True),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("result_id", sa.String(), nullable=True),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["document_id"], ["documents.id"]),
            sa.ForeignKeyConstraint(["template_id"], ["table_templates.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _ensure_index("ix_table_extraction_jobs_workspace_id", "table_extraction_jobs", ["workspace_id"])

    if "table_extraction_results" not in tables:
        op.create_table(
            "table_extraction_results",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("job_id", sa.String(), nullable=False),
            sa.Column("raw_model_output", sa.Text(), nullable=False),
            sa.Column("tables", sa.Text(), nullable=False),
            sa.Column("corrected_tables", sa.Text(), nullable=True),
            sa.Column("edit_log", sa.Text(), nullable=False),
            sa.Column("reviewed", sa.Boolean(), nullable=False),
            sa.Column("validation_warnings", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["job_id"], ["table_extraction_jobs.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("job_id"),
        )

    if "table_extraction_batches" not in tables:
        op.create_table(
            "table_extraction_batches",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("workspace_id", sa.String(), nullable=True),
            sa.Column("template_id", sa.String(), nullable=False),
            sa.Column("template_version", sa.Integer(), nullable=False),
            sa.Column("definition_snapshot", sa.Text(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("total_count", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["template_id"], ["table_templates.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _ensure_index("ix_table_extraction_batches_workspace_id", "table_extraction_batches", ["workspace_id"])
    _ensure_index("ix_table_extraction_batches_created_at_id", "table_extraction_batches", ["created_at", "id"])

    if "table_extraction_batch_items" not in tables:
        op.create_table(
            "table_extraction_batch_items",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("batch_id", sa.String(), nullable=False),
            sa.Column("document_id", sa.String(), nullable=False),
            sa.Column("page_number", sa.Integer(), nullable=True),
            sa.Column("job_id", sa.String(), nullable=False),
            sa.Column("filename", sa.String(), nullable=False),
            sa.Column("upload_index", sa.Integer(), nullable=True),
            sa.Column("client_file_id", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["batch_id"], ["table_extraction_batches.id"]),
            sa.ForeignKeyConstraint(["document_id"], ["documents.id"]),
            sa.ForeignKeyConstraint(["job_id"], ["table_extraction_jobs.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _ensure_index("ix_table_extraction_batch_items_batch_job", "table_extraction_batch_items", ["batch_id", "job_id"])
    _ensure_index("ix_table_extraction_batch_items_batch_upload_index", "table_extraction_batch_items", ["batch_id", "upload_index"])


def downgrade() -> None:
    op.drop_table("table_extraction_batch_items")
    op.drop_table("table_extraction_batches")
    op.drop_table("table_extraction_results")
    op.drop_table("table_extraction_jobs")
    op.drop_table("table_templates")
