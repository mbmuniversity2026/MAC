"""Add face_photo_path to face_templates; re-size face_encoding for ArcFace embeddings.

Revision ID: 20260510_0006
Revises: 20260507_0005
Create Date: 2026-05-10
"""

from alembic import op
import sqlalchemy as sa

revision = "20260510_0006"
down_revision = "20260507_0005"
branch_labels = None
depends_on = None


def _col_exists(inspector, table: str, col: str) -> bool:
    return col in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if "face_templates" in insp.get_table_names():
        # Add face_photo_path column (nullable — existing rows have None)
        if not _col_exists(insp, "face_templates", "face_photo_path"):
            op.add_column(
                "face_templates",
                sa.Column("face_photo_path", sa.String(200), nullable=True),
            )

        # The face_encoding column was previously used for SHA-512 (64 bytes).
        # insightface stores 512 * 4 = 2048 bytes. LargeBinary has no length
        # constraint in PostgreSQL so no ALTER needed — existing rows will be
        # re-registered by students on next login.


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "face_templates" in insp.get_table_names():
        if _col_exists(insp, "face_templates", "face_photo_path"):
            op.drop_column("face_templates", "face_photo_path")
