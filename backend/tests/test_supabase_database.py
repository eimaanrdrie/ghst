from pathlib import Path

import yaml

from app.core.config import Settings
from app.db.session import engine_options


def test_supabase_session_pooler_is_detected_and_pooled():
    settings = Settings(
        database_url="postgresql+psycopg://postgres.demo:encoded@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require",
        database_pool_size=4,
        database_max_overflow=2,
    )
    options = engine_options(settings)
    assert settings.database_provider == "SUPABASE_POSTGRESQL"
    assert options["pool_pre_ping"] is True
    assert options["pool_size"] == 4
    assert options["max_overflow"] == 2
    assert "connect_args" not in options


def test_supabase_transaction_pooler_disables_prepared_statements():
    settings = Settings(
        database_url="postgresql+psycopg://postgres.demo:encoded@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require"
    )
    assert engine_options(settings)["connect_args"] == {"prepare_threshold": None}


def test_supabase_migration_enables_rls_and_revokes_data_api_roles():
    migration = Path(__file__).parents[1] / "alembic" / "versions" / "0003_supabase_database_hardening.py"
    source = migration.read_text(encoding="utf-8")
    assert "ENABLE ROW LEVEL SECURITY" in source
    assert '"anon", "authenticated"' in source
    assert "REVOKE ALL PRIVILEGES" in source


def test_production_compose_uses_server_side_supabase_only():
    root = Path(__file__).parents[2]
    compose = yaml.safe_load((root / "docker-compose.production.yml").read_text(encoding="utf-8"))
    assert "postgres" not in compose["services"]
    assert compose["services"]["api"]["environment"]["DATABASE_URL"] == "${SUPABASE_DATABASE_URL}"
    assert "controlled_egress" in compose["services"]["api"]["networks"]
    assert "NEXT_PUBLIC_SUPABASE" not in (root / ".env.example").read_text(encoding="utf-8")
