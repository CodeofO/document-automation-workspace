"""runtime settings overrides

``app_settings`` holds the values saved through ``PUT /api/settings/vlm``. The environment
(and ``.env``) stays the source of defaults; nothing is copied from it here.

Revision ID: 0007_app_settings
Revises: 0006_job_queue
Create Date: 2026-10-15 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_app_settings"
down_revision = "0006_job_queue"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "app_settings" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
