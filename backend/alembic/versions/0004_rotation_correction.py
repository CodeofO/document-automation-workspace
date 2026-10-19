"""rotation correction module

Revision ID: 0004_rotation_correction
Revises: 0003_workspace_scope_columns
Create Date: 2026-10-15 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_rotation_correction"
down_revision = "0003_workspace_scope_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "document_pages" in tables:
        columns = {column["name"] for column in inspector.get_columns("document_pages")}
        if "rotation_applied" not in columns:
            op.add_column("document_pages", sa.Column("rotation_applied", sa.Integer(), nullable=False, server_default="0"))

    if "rotation_jobs" not in tables:
        op.create_table(
            "rotation_jobs",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("workspace_id", sa.String(), nullable=True),
            sa.Column("document_id", sa.String(), sa.ForeignKey("documents.id"), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("result_json", sa.Text(), nullable=True),
            sa.Column("corrected_page_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_rotation_jobs_workspace_id", "rotation_jobs", ["workspace_id"])

    if "rotation_batches" not in tables:
        op.create_table(
            "rotation_batches",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("workspace_id", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_rotation_batches_workspace_id", "rotation_batches", ["workspace_id"])
        op.create_index("ix_rotation_batches_created_at_id", "rotation_batches", ["created_at", "id"])

    if "rotation_batch_items" not in tables:
        op.create_table(
            "rotation_batch_items",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("batch_id", sa.String(), sa.ForeignKey("rotation_batches.id"), nullable=False),
            sa.Column("document_id", sa.String(), sa.ForeignKey("documents.id"), nullable=False),
            sa.Column("job_id", sa.String(), sa.ForeignKey("rotation_jobs.id"), nullable=False),
            sa.Column("filename", sa.String(), nullable=False),
            sa.Column("upload_index", sa.Integer(), nullable=True),
            sa.Column("client_file_id", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_rotation_batch_items_batch_job", "rotation_batch_items", ["batch_id", "job_id"])
        op.create_index("ix_rotation_batch_items_batch_upload_index", "rotation_batch_items", ["batch_id", "upload_index"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    for table_name in ["rotation_batch_items", "rotation_batches", "rotation_jobs"]:
        if table_name in tables:
            op.drop_table(table_name)
    if "document_pages" in tables:
        columns = {column["name"] for column in inspector.get_columns("document_pages")}
        if "rotation_applied" in columns:
            op.drop_column("document_pages", "rotation_applied")
