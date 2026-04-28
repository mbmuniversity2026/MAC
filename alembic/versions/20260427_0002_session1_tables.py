"""Session 1 new tables + User column additions.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-27
"""
from alembic import op
import sqlalchemy as sa

revision = "20260427_0002"
down_revision = "20260426_0001"
branch_labels = None
depends_on = None


def _table_exists(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def _column_exists(inspector, table_name: str, column_name: str) -> bool:
    if not _table_exists(inspector, table_name):
        return False
    return any(col["name"] == column_name for col in inspector.get_columns(table_name))


def _index_exists(inspector, table_name: str, index_name: str) -> bool:
    if not _table_exists(inspector, table_name):
        return False
    return any(idx["name"] == index_name for idx in inspector.get_indexes(table_name))


def _safe_create_index(table_name: str, index_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not _table_exists(insp, table_name):
        return
    if _index_exists(insp, table_name, index_name):
        return
    existing_cols = {col["name"] for col in insp.get_columns(table_name)}
    if not all(col in existing_cols for col in columns):
        return
    op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # ── feature_flags ──────────────────────────────────────
    if not _table_exists(insp, "feature_flags"):
        op.create_table(
            "feature_flags",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("key", sa.String(100), nullable=False, unique=True),
            sa.Column("label", sa.String(200), nullable=False, default=""),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("enabled", sa.Boolean, nullable=False, default=True),
            sa.Column("allowed_roles", sa.JSON, nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.String(36), nullable=True),
        )
    _safe_create_index("feature_flags", "ix_feature_flags_key", ["key"])

    # ── system_config ──────────────────────────────────────
    if not _table_exists(insp, "system_config"):
        op.create_table(
            "system_config",
            sa.Column("key", sa.String(100), primary_key=True),
            sa.Column("value", sa.Text, nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    # ── branches ──────────────────────────────────────────
    if not _table_exists(insp, "branches"):
        op.create_table(
            "branches",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("code", sa.String(20), nullable=False, unique=True),
            sa.Column("hod_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )

    # ── sections ──────────────────────────────────────────
    if not _table_exists(insp, "sections"):
        op.create_table(
            "sections",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(50), nullable=False),
            sa.Column("year", sa.Integer, nullable=False),
            sa.Column("faculty_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
    _safe_create_index("sections", "ix_sections_branch", ["branch_id"])

    # ── cluster_heartbeats ─────────────────────────────────
    if not _table_exists(insp, "cluster_heartbeats"):
        op.create_table(
            "cluster_heartbeats",
            sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
            sa.Column("node_id", sa.String(36), sa.ForeignKey("worker_nodes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("gpu_util", sa.SmallInteger, nullable=True),
            sa.Column("cpu_util", sa.SmallInteger, nullable=True),
            sa.Column("ram_used_mb", sa.Integer, nullable=True),
            sa.Column("vram_used_mb", sa.Integer, nullable=True),
            sa.Column("active_model", sa.String(128), nullable=True),
            sa.Column("queue_depth", sa.SmallInteger, nullable=True),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        )
    _safe_create_index("cluster_heartbeats", "idx_hb_node_time", ["node_id", "recorded_at"])

    # ── shared_files ───────────────────────────────────────
    if not _table_exists(insp, "shared_files"):
        op.create_table(
            "shared_files",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("filename", sa.String(500), nullable=False),
            sa.Column("original_name", sa.String(500), nullable=False),
            sa.Column("mime_type", sa.String(100), nullable=True),
            sa.Column("size_bytes", sa.Integer, nullable=False, default=0),
            sa.Column("is_public", sa.Boolean, nullable=False, default=False),
            sa.Column("share_token", sa.String(64), nullable=True, unique=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
    _safe_create_index("shared_files", "ix_shared_files_owner", ["owner_id"])
    _safe_create_index("shared_files", "ix_shared_files_token", ["share_token"])

    # ── file_downloads ─────────────────────────────────────
    if not _table_exists(insp, "file_downloads"):
        op.create_table(
            "file_downloads",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("file_id", sa.String(36), sa.ForeignKey("shared_files.id", ondelete="CASCADE"), nullable=False),
            sa.Column("downloader_id", sa.String(36), nullable=True),
            sa.Column("ip_address", sa.String(45), nullable=True),
            sa.Column("downloaded_at", sa.DateTime(timezone=True), nullable=True),
        )

    # ── video_projects ─────────────────────────────────────
    if not _table_exists(insp, "video_projects"):
        op.create_table(
            "video_projects",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(300), nullable=False),
            sa.Column("status", sa.String(30), nullable=False, default="draft"),
            sa.Column("config", sa.JSON, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    # ── video_jobs ─────────────────────────────────────────
    if not _table_exists(insp, "video_jobs"):
        op.create_table(
            "video_jobs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("project_id", sa.String(36), sa.ForeignKey("video_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("status", sa.String(30), nullable=False, default="queued"),
            sa.Column("progress_pct", sa.Integer, nullable=False, default=0),
            sa.Column("output_path", sa.String(500), nullable=True),
            sa.Column("error", sa.Text, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        )

    # ── User column additions ──────────────────────────────
    user_cols = {col["name"] for col in insp.get_columns("users")}
    with op.batch_alter_table("users") as batch:
        if "branch_id" not in user_cols:
            batch.add_column(sa.Column("branch_id", sa.String(36), nullable=True))
        if "section_id" not in user_cols:
            batch.add_column(sa.Column("section_id", sa.String(36), nullable=True))
        if "year" not in user_cols:
            batch.add_column(sa.Column("year", sa.Integer, nullable=True))
        if "can_create_users" not in user_cols:
            batch.add_column(sa.Column("can_create_users", sa.Boolean, nullable=False, server_default="0"))
        if "is_founder" not in user_cols:
            batch.add_column(sa.Column("is_founder", sa.Boolean, nullable=False, server_default="0"))
        if "storage_quota_mb" not in user_cols:
            batch.add_column(sa.Column("storage_quota_mb", sa.Integer, nullable=False, server_default="2048"))
        if "storage_used_mb" not in user_cols:
            batch.add_column(sa.Column("storage_used_mb", sa.Integer, nullable=False, server_default="0"))
        if "cc_enabled" not in user_cols:
            batch.add_column(sa.Column("cc_enabled", sa.Boolean, nullable=False, server_default="1"))
        if "forced_theme" not in user_cols:
            batch.add_column(sa.Column("forced_theme", sa.String(8), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        for col in ["branch_id", "section_id", "year", "can_create_users",
                    "is_founder", "storage_quota_mb", "storage_used_mb", "cc_enabled", "forced_theme"]:
            batch.drop_column(col)

    for table in ["video_jobs", "video_projects", "file_downloads", "shared_files",
                  "cluster_heartbeats", "sections", "branches", "system_config", "feature_flags"]:
        op.drop_table(table)
