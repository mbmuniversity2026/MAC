"""Add role column to student_registry for student/faculty/admin separation.

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-28
"""
from alembic import op
import sqlalchemy as sa

revision = "20260428_0004"
down_revision = "20260427_0003"
branch_labels = None
depends_on = None


def _column_exists(inspector, table_name: str, column_name: str) -> bool:
    if table_name not in inspector.get_table_names():
        return False
    return any(col["name"] == column_name for col in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # Add role column to student_registry (default 'student' for existing entries)
    if not _column_exists(insp, "student_registry", "role"):
        op.add_column(
            "student_registry",
            sa.Column("role", sa.String(20), nullable=False, server_default="student"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if _column_exists(insp, "student_registry", "role"):
        op.drop_column("student_registry", "role")
