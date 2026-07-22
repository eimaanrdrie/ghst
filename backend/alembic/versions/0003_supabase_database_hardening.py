"""Harden public-schema governance tables for Supabase Data API isolation.

Revision ID: 0003
Revises: 0002
"""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

GOVERNANCE_TABLES = (
    "users", "destinations", "policies", "policy_versions", "policy_clauses",
    "evaluations", "findings", "policy_matches", "reviews", "review_delegations",
    "precedents", "precedent_approvals", "session_risk_states", "clearance_grants",
    "audit_events", "model_versions", "model_training_jobs", "learning_artefacts",
    "calibration_recommendations", "usability_study_responses",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    existing_tables = set(sa.inspect(bind).get_table_names(schema="public"))
    existing_roles = set(bind.execute(sa.text("SELECT rolname FROM pg_roles")).scalars())
    exposed_roles = tuple(role for role in ("anon", "authenticated") if role in existing_roles)
    for table in GOVERNANCE_TABLES:
        if table not in existing_tables:
            continue
        op.execute(sa.text(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY'))
        for role in exposed_roles:
            # Identifiers are selected exclusively from the constant tuples above.
            op.execute(sa.text(f'REVOKE ALL PRIVILEGES ON TABLE public."{table}" FROM "{role}"'))


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    existing_tables = set(sa.inspect(bind).get_table_names(schema="public"))
    for table in GOVERNANCE_TABLES:
        if table in existing_tables:
            op.execute(sa.text(f'ALTER TABLE public."{table}" DISABLE ROW LEVEL SECURITY'))

