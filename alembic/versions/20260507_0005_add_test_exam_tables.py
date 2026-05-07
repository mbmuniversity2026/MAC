"""Add test exam tables: test_exams, test_questions, test_options, test_submissions, student_answers.

Revision ID: 20260507_0005
Revises: 20260428_0004
Create Date: 2026-05-07
"""

from alembic import op
import sqlalchemy as sa

revision = "20260507_0005"
down_revision = "20260428_0004"
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # ── test_exams ─────────────────────────────────────────
    if not _table_exists(insp, "test_exams"):
        op.create_table(
            "test_exams",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("title", sa.String(300), nullable=False),
            sa.Column("subject", sa.String(150), nullable=False),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("instructions", sa.Text, nullable=True),
            sa.Column("duration_minutes", sa.Integer, nullable=False, server_default="60"),
            sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_test_exams_created_by", "test_exams", ["created_by"])
        op.create_index("ix_test_exams_status", "test_exams", ["status"])

    # ── test_questions ─────────────────────────────────────
    if not _table_exists(insp, "test_questions"):
        op.create_table(
            "test_questions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("exam_id", sa.String(36), sa.ForeignKey("test_exams.id", ondelete="CASCADE"), nullable=False),
            sa.Column("question_type", sa.String(20), nullable=False, server_default="mcq"),
            sa.Column("question_text", sa.Text, nullable=False),
            sa.Column("marks", sa.Float, nullable=False, server_default="1.0"),
            sa.Column("order_index", sa.Integer, nullable=False, server_default="0"),
            sa.Column("model_answer", sa.Text, nullable=True),
            sa.Column("explanation", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_test_questions_exam_id", "test_questions", ["exam_id"])

    # ── test_options ───────────────────────────────────────
    if not _table_exists(insp, "test_options"):
        op.create_table(
            "test_options",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("question_id", sa.String(36), sa.ForeignKey("test_questions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("option_text", sa.Text, nullable=False),
            sa.Column("is_correct", sa.Boolean, nullable=False, server_default="false"),
            sa.Column("order_index", sa.Integer, nullable=False, server_default="0"),
        )
        op.create_index("ix_test_options_question_id", "test_options", ["question_id"])

    # ── test_submissions ───────────────────────────────────
    if not _table_exists(insp, "test_submissions"):
        op.create_table(
            "test_submissions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("exam_id", sa.String(36), sa.ForeignKey("test_exams.id", ondelete="CASCADE"), nullable=False),
            sa.Column("student_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="in_progress"),
            sa.Column("total_score", sa.Float, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_test_submissions_exam_id", "test_submissions", ["exam_id"])
        op.create_index("ix_test_submissions_student_id", "test_submissions", ["student_id"])

    # ── student_answers ────────────────────────────────────
    if not _table_exists(insp, "student_answers"):
        op.create_table(
            "student_answers",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("submission_id", sa.String(36), sa.ForeignKey("test_submissions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("question_id", sa.String(36), sa.ForeignKey("test_questions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("selected_option_ids", sa.JSON, nullable=True),
            sa.Column("written_text", sa.Text, nullable=True),
            sa.Column("ai_score", sa.Float, nullable=True),
            sa.Column("ai_feedback", sa.Text, nullable=True),
            sa.Column("manual_score", sa.Float, nullable=True),
            sa.Column("is_correct", sa.Boolean, nullable=True),
        )
        op.create_index("ix_student_answers_submission_id", "student_answers", ["submission_id"])
        op.create_index("ix_student_answers_question_id", "student_answers", ["question_id"])


def downgrade() -> None:
    op.drop_table("student_answers")
    op.drop_table("test_submissions")
    op.drop_table("test_options")
    op.drop_table("test_questions")
    op.drop_table("test_exams")
