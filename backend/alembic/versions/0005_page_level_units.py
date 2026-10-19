"""page-level units of work

Every module job, module batch item and workflow run item now covers one page
(``page_number``, 1-based). Existing rows keep ``NULL`` = the whole document, so
history stays readable.

Idempotent: databases that were already touched by the app's startup
``_run_lightweight_migrations`` (which adds the same columns) upgrade cleanly.

Revision ID: 0005_page_level_units
Revises: 0004_rotation_correction
Create Date: 2026-10-15 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_page_level_units"
down_revision = "0004_rotation_correction"
branch_labels = None
depends_on = None


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


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table_name in PAGE_SCOPED_TABLES:
        if table_name not in tables:
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "page_number" not in columns:
            op.add_column(table_name, sa.Column("page_number", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table_name in PAGE_SCOPED_TABLES:
        if table_name not in tables:
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "page_number" in columns:
            with op.batch_alter_table(table_name) as batch_op:
                batch_op.drop_column("page_number")
