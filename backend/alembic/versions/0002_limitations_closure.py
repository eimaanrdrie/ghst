"""Close deferred governance and learning lifecycle gaps.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

from app.db.base import Base
from app.db import models  # noqa: F401

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _add_column(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column)


def upgrade() -> None:
    bind = op.get_bind()
    # 0001 intentionally builds from metadata for clean hackathon installs. These
    # checks also make the upgrade safe for databases already created by 0001.
    _add_column("precedents", sa.Column("scope", sa.String(30), nullable=False, server_default="DEPARTMENT"))
    _add_column("precedents", sa.Column("impact_class", sa.String(40), nullable=False, server_default="STANDARD"))
    _add_column("precedents", sa.Column("policy_version_ids", sa.JSON(), nullable=False, server_default="[]"))
    _add_column("model_versions", sa.Column("organisation_id", sa.String(40), nullable=False, server_default="org_ghst_demo"))
    _add_column("model_versions", sa.Column("base_model", sa.String(160), nullable=True))
    _add_column("model_versions", sa.Column("adapter_type", sa.String(30), nullable=False, server_default="BASE"))
    _add_column("model_versions", sa.Column("dataset_digest", sa.String(64), nullable=True))
    _add_column("model_versions", sa.Column("previous_model_id", sa.String(40), nullable=True))
    _add_column("model_versions", sa.Column("approved_by", sa.String(40), nullable=True))
    _add_column("model_versions", sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
    _add_column("model_versions", sa.Column("deployed_at", sa.DateTime(timezone=True), nullable=True))

    for table_name in (
        "review_delegations",
        "precedent_approvals",
        "session_risk_states",
        "model_training_jobs",
        "calibration_recommendations",
        "usability_study_responses",
    ):
        Base.metadata.tables[table_name].create(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())
    for table_name in (
        "calibration_recommendations",
        "usability_study_responses",
        "model_training_jobs",
        "session_risk_states",
        "precedent_approvals",
        "review_delegations",
    ):
        if table_name in existing:
            op.drop_table(table_name)
    for name in (
        "deployed_at", "created_at", "approved_by", "previous_model_id",
        "dataset_digest", "adapter_type", "base_model", "organisation_id",
    ):
        if name in _columns("model_versions"):
            op.drop_column("model_versions", name)
    if "scope" in _columns("precedents"):
        op.drop_column("precedents", "scope")
    if "impact_class" in _columns("precedents"):
        op.drop_column("precedents", "impact_class")
    if "policy_version_ids" in _columns("precedents"):
        op.drop_column("precedents", "policy_version_ids")
