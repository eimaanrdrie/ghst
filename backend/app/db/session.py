from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()


def engine_options(database_settings=settings) -> dict:
    """Return safe engine options for SQLite, PostgreSQL and Supabase Supavisor."""
    options: dict = {"pool_pre_ping": True}
    if database_settings.database_url.startswith("sqlite"):
        options["connect_args"] = {"check_same_thread": False}
        return options
    options.update({
        "pool_size": database_settings.database_pool_size,
        "max_overflow": database_settings.database_max_overflow,
        "pool_recycle": database_settings.database_pool_recycle_seconds,
    })
    # Supabase transaction mode (port 6543) does not support prepared
    # statements. Session mode (5432) remains the recommended FastAPI path.
    if "pooler.supabase.com:6543" in database_settings.database_url.lower():
        options["connect_args"] = {"prepare_threshold": None}
    return options


engine = create_engine(settings.database_url, **engine_options(settings))
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
