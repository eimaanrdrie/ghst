"""Add policy memory ingestion, verification, and citation fields.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _add_column(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column)


def upgrade() -> None:
    bind = op.get_bind()

    for column in (
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    ):
        _add_column("policies", column)

    for column in (
        sa.Column("source_filename", sa.String(length=240), nullable=True),
        sa.Column("storage_adapter", sa.String(length=30), nullable=False, server_default="LOCAL_DEMO"),
        sa.Column("storage_key", sa.String(length=300), nullable=True),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("source_kind", sa.String(length=30), nullable=False, server_default="SEEDED"),
        sa.Column("extraction_metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("malware_scan", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("verification_summary", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("extraction_error", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.String(length=40), nullable=True),
        sa.Column("activated_by", sa.String(length=40), nullable=True),
        sa.Column("simulated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    ):
        _add_column("policy_versions", column)

    for column in (
        sa.Column("data_classes", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("destinations", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("heading", sa.String(length=240), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("source_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verification_status", sa.String(length=30), nullable=False, server_default="VERIFIED"),
        sa.Column("suggested_metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("human_notes", sa.Text(), nullable=True),
        sa.Column("parent_clause_id", sa.String(length=40), nullable=True),
        sa.Column("verified_by", sa.String(length=40), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    ):
        _add_column("policy_clauses", column)

    if bind.dialect.name == "postgresql":
        op.execute(sa.text("create extension if not exists vector"))
        existing = _columns("policy_clauses")
        if "embedding_vector" not in existing:
            op.execute(sa.text("alter table policy_clauses add column embedding_vector vector(128)"))


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql" and "embedding_vector" in _columns("policy_clauses"):
        op.execute(sa.text("alter table policy_clauses drop column embedding_vector"))

    for name in (
        "updated_at", "created_at", "verified_at", "verified_by", "parent_clause_id",
        "human_notes", "suggested_metadata", "verification_status", "source_order",
        "page_number", "heading", "destinations", "data_classes",
    ):
        if name in _columns("policy_clauses"):
            op.drop_column("policy_clauses", name)

    for name in (
        "updated_at", "created_at", "retired_at", "activated_at", "simulated_at",
        "activated_by", "uploaded_by", "extraction_error", "verification_summary",
        "malware_scan", "extraction_metadata", "source_kind", "sha256", "size_bytes",
        "mime_type", "storage_key", "storage_adapter", "source_filename",
    ):
        if name in _columns("policy_versions"):
            op.drop_column("policy_versions", name)

    for name in ("updated_at", "created_at", "created_by", "description"):
        if name in _columns("policies"):
            op.drop_column("policies", name)
