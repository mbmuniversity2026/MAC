"""Initial schema — bootstrap all tables from Base.metadata.

Captures the entire schema (existing tables + Session 1 additions) in one
shot. Subsequent migrations should use op.create_table / op.add_column
normally; this one is the baseline.

Revision ID: 20260426_0001
Revises:
Create Date: 2026-04-26
"""

from alembic import op
import sqlalchemy as sa  # noqa: F401  (kept for op.batch_alter_table users)

# revision identifiers, used by Alembic.
revision = "20260426_0001"
down_revision = None
branch_labels = None
depends_on = None


def _all_models_loaded():
    """Import every model module so Base.metadata is fully populated."""
    import mac.models.user  # noqa: F401
    import mac.models.guardrail  # noqa: F401
    import mac.models.quota  # noqa: F401
    import mac.models.rag  # noqa: F401
    import mac.models.node  # noqa: F401
    import mac.models.attendance  # noqa: F401
    import mac.models.doubt  # noqa: F401
    import mac.models.notification  # noqa: F401
    import mac.models.agent  # noqa: F401
    import mac.models.notebook  # noqa: F401
    import mac.models.copy_check  # noqa: F401
    import mac.models.model_submission  # noqa: F401
    # Session 1 additions
    import mac.models.feature_flag  # noqa: F401
    import mac.models.academic  # noqa: F401
    import mac.models.cluster  # noqa: F401
    import mac.models.file_share  # noqa: F401
    import mac.models.video  # noqa: F401
    import mac.models.system_config  # noqa: F401


def upgrade() -> None:
    _all_models_loaded()
    from mac.database import Base
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    _all_models_loaded()
    from mac.database import Base
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
