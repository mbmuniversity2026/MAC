"""Database engine & session factory."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from mac.config import settings

# SQLite needs special connect_args; PostgreSQL via asyncpg needs ssl for cloud providers
connect_args = {}
if settings.is_sqlite:
    connect_args = {"check_same_thread": False}
elif "neon.tech" in settings.database_url or "supabase" in settings.database_url:
    connect_args = {"ssl": "require"}

engine = create_async_engine(
    settings.database_url,
    echo=settings.mac_debug,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=30,
    pool_recycle=1800,
    pool_timeout=30,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """Create all tables (dev only — production uses Alembic).
    Uses checkfirst=True per-table to avoid race condition with multiple workers.
    """
    import sqlalchemy.exc
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all, checkfirst=True)
    except sqlalchemy.exc.IntegrityError:
        # Another worker already created tables concurrently — that's fine
        pass
