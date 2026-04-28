"""Alembic migrations env.

The application engine is async (asyncpg / aiosqlite); migrations use a
sync engine derived from the same URL via the conversion below. Standard
pattern — keeps Alembic simple and avoids the async-engine-of-sync-URL
mismatch that an earlier revision of this file had.
"""

from logging.config import fileConfig

from sqlalchemy import pool, engine_from_config

from alembic import context

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import all models so Base.metadata knows about them
from mac.database import Base  # noqa: E402
import mac.models.user  # noqa: F401, E402
import mac.models.guardrail  # noqa: F401, E402
import mac.models.quota  # noqa: F401, E402
import mac.models.rag  # noqa: F401, E402
import mac.models.node  # noqa: F401, E402
import mac.models.attendance  # noqa: F401, E402
import mac.models.doubt  # noqa: F401, E402
import mac.models.notification  # noqa: F401, E402
import mac.models.agent  # noqa: F401, E402
import mac.models.notebook  # noqa: F401, E402
import mac.models.copy_check  # noqa: F401, E402
import mac.models.model_submission  # noqa: F401, E402
# Session 1: new tables
import mac.models.feature_flag  # noqa: F401, E402
import mac.models.academic  # noqa: F401, E402
import mac.models.cluster  # noqa: F401, E402
import mac.models.file_share  # noqa: F401, E402
import mac.models.video  # noqa: F401, E402
import mac.models.system_config  # noqa: F401, E402

target_metadata = Base.metadata

# Override sqlalchemy.url from config.py settings
from mac.config import settings  # noqa: E402
config.set_main_option("sqlalchemy.url", settings.database_url.replace("+aiosqlite", "").replace("+asyncpg", "+psycopg2"))


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode with a sync engine."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        do_run_migrations(connection)
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
