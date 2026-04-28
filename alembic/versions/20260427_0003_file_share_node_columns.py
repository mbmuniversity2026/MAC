"""Add missing columns: file_share full schema, node notebook_port/tags.

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-27
"""
from alembic import op
import sqlalchemy as sa

revision = "20260427_0003"
down_revision = "20260427_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # ── shared_files — add columns the model expects ────────
    shared_file_cols = {col["name"] for col in insp.get_columns("shared_files")}
    with op.batch_alter_table("shared_files") as batch:
        # Rename original_name → display_name (SQLite can't rename; add + copy approach)
        if "display_name" not in shared_file_cols:
            batch.add_column(sa.Column("display_name", sa.String(512), nullable=True))
        if "storage_path" not in shared_file_cols:
            batch.add_column(sa.Column("storage_path", sa.String(1024), nullable=True))
        if "uploaded_by" not in shared_file_cols:
            batch.add_column(sa.Column("uploaded_by", sa.String(36), nullable=True))
        if "recipient_type" not in shared_file_cols:
            batch.add_column(sa.Column("recipient_type", sa.String(16), nullable=True, server_default="all"))
        if "recipient_json" not in shared_file_cols:
            batch.add_column(sa.Column("recipient_json", sa.JSON, nullable=True))
        if "download_count" not in shared_file_cols:
            batch.add_column(sa.Column("download_count", sa.Integer, nullable=False, server_default="0"))

    # ── worker_nodes — notebook_port and tags ────────────────
    worker_cols = {col["name"] for col in insp.get_columns("worker_nodes")}
    with op.batch_alter_table("worker_nodes") as batch:
        if "notebook_port" not in worker_cols:
            batch.add_column(sa.Column("notebook_port", sa.Integer, nullable=True))
        if "tags" not in worker_cols:
            batch.add_column(sa.Column("tags", sa.String(500), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("worker_nodes") as batch:
        batch.drop_column("tags")
        batch.drop_column("notebook_port")

    with op.batch_alter_table("shared_files") as batch:
        for col in ["download_count", "recipient_json", "recipient_type",
                    "uploaded_by", "storage_path", "display_name"]:
            batch.drop_column(col)
