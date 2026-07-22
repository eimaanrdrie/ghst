import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


def now_utc() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("usr"))
    username: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(Text)
    organisation_id: Mapped[str] = mapped_column(String(40), index=True, default="org_ghst_demo")
    department: Mapped[str] = mapped_column(String(80), index=True)
    roles: Mapped[list[str]] = mapped_column(JsonType, default=list)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Destination(Base):
    __tablename__ = "destinations"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("dst"))
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    service: Mapped[str] = mapped_column(String(100))
    origin: Mapped[str] = mapped_column(String(300), unique=True)
    tenant: Mapped[str] = mapped_column(String(100))
    model_class: Mapped[str] = mapped_column(String(100))
    trust_status: Mapped[str] = mapped_column(String(30), default="APPROVED")
    redirect_origin: Mapped[str | None] = mapped_column(String(300), nullable=True)


class Policy(Base):
    __tablename__ = "policies"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("pol"))
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(180))
    category: Mapped[str] = mapped_column(String(60), index=True)
    owner: Mapped[str] = mapped_column(String(120))
    scope: Mapped[str] = mapped_column(String(120), default="ORGANISATION")
    status: Mapped[str] = mapped_column(String(30), default="DRAFT")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    versions: Mapped[list["PolicyVersion"]] = relationship(back_populates="policy")


class PolicyVersion(Base):
    __tablename__ = "policy_versions"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("pov"))
    policy_id: Mapped[str] = mapped_column(ForeignKey("policies.id"), index=True)
    version: Mapped[str] = mapped_column(String(30))
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    content_hash: Mapped[str] = mapped_column(String(64))
    approved_by: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(30), default="UPLOADED", index=True)
    source_filename: Mapped[str | None] = mapped_column(String(240), nullable=True)
    storage_adapter: Mapped[str] = mapped_column(String(30), default="LOCAL_DEMO")
    storage_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source_kind: Mapped[str] = mapped_column(String(30), default="SEEDED")
    extraction_metadata: Mapped[dict] = mapped_column(JsonType, default=dict)
    malware_scan: Mapped[dict] = mapped_column(JsonType, default=dict)
    verification_summary: Mapped[dict] = mapped_column(JsonType, default=dict)
    extraction_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    activated_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    simulated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    policy: Mapped[Policy] = relationship(back_populates="versions")
    clauses: Mapped[list["PolicyClause"]] = relationship(back_populates="version")


class PolicyClause(Base):
    __tablename__ = "policy_clauses"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("clause"))
    policy_version_id: Mapped[str] = mapped_column(ForeignKey("policy_versions.id"), index=True)
    department: Mapped[str] = mapped_column(String(80), default="ALL", index=True)
    roles: Mapped[list[str]] = mapped_column(JsonType, default=list)
    purposes: Mapped[list[str]] = mapped_column(JsonType, default=list)
    data_classes: Mapped[list[str]] = mapped_column(JsonType, default=list)
    destinations: Mapped[list[str]] = mapped_column(JsonType, default=list)
    clause_ref: Mapped[str] = mapped_column(String(50))
    heading: Mapped[str | None] = mapped_column(String(240), nullable=True)
    page_number: Mapped[int] = mapped_column(Integer, default=1)
    source_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    text: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(String(30))
    verification_status: Mapped[str] = mapped_column(String(30), default="VERIFIED", index=True)
    suggested_metadata: Mapped[dict] = mapped_column(JsonType, default=dict)
    metadata_json: Mapped[dict] = mapped_column(JsonType, default=dict)
    human_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_clause_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(JsonType, nullable=True)
    verified_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    version: Mapped[PolicyVersion] = relationship(back_populates="clauses")


class Evaluation(Base):
    __tablename__ = "evaluations"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("eval"))
    session_id: Mapped[str] = mapped_column(String(80), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    department: Mapped[str] = mapped_column(String(80), index=True)
    role_context: Mapped[str] = mapped_column(String(80))
    purpose: Mapped[str] = mapped_column(String(120), index=True)
    destination_id: Mapped[str | None] = mapped_column(ForeignKey("destinations.id"), nullable=True)
    destination_origin: Mapped[str] = mapped_column(String(300))
    prompt_hmac: Mapped[str] = mapped_column(String(64), index=True)
    state: Mapped[str] = mapped_column(String(40), index=True)
    action: Mapped[str] = mapped_column(String(30), index=True)
    risk_score: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String(20))
    uncertainty: Mapped[float] = mapped_column(Float, default=0)
    findings: Mapped[list[dict]] = mapped_column(JsonType, default=list)
    policy_matches: Mapped[list[dict]] = mapped_column(JsonType, default=list)
    reason_codes: Mapped[list[str]] = mapped_column(JsonType, default=list)
    message: Mapped[str] = mapped_column(Text)
    model_evidence: Mapped[dict] = mapped_column(JsonType, default=dict)
    learning_source: Mapped[str] = mapped_column(String(30), default="POLICY")
    precedent_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    parent_evaluation_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class FindingRecord(Base):
    __tablename__ = "findings"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("finding"))
    evaluation_id: Mapped[str] = mapped_column(ForeignKey("evaluations.id"), index=True)
    category: Mapped[str] = mapped_column(String(80), index=True)
    severity: Mapped[str] = mapped_column(String(20))
    detector: Mapped[str] = mapped_column(String(100))
    confidence: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(30))
    location: Mapped[dict] = mapped_column(JsonType, default=dict)


class PolicyMatchRecord(Base):
    __tablename__ = "policy_matches"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("match"))
    evaluation_id: Mapped[str] = mapped_column(ForeignKey("evaluations.id"), index=True)
    clause_id: Mapped[str] = mapped_column(ForeignKey("policy_clauses.id"), index=True)
    rank: Mapped[int] = mapped_column(Integer)
    score: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(String(200))


class Review(Base):
    __tablename__ = "reviews"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("rev"))
    evaluation_id: Mapped[str] = mapped_column(ForeignKey("evaluations.id"), unique=True)
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    department: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True)
    severity: Mapped[str] = mapped_column(String(20), default="MEDIUM")
    encrypted_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    semantic_signature: Mapped[list[str]] = mapped_column(JsonType, default=list)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decision: Mapped[str | None] = mapped_column(String(30), nullable=True)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ReviewDelegation(Base):
    __tablename__ = "review_delegations"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("dlg"))
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    department: Mapped[str] = mapped_column(String(80), index=True)
    granted_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Precedent(Base):
    __tablename__ = "precedents"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ace"))
    source_review_id: Mapped[str] = mapped_column(ForeignKey("reviews.id"), index=True)
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    department: Mapped[str] = mapped_column(String(80), index=True)
    scope: Mapped[str] = mapped_column(String(30), default="DEPARTMENT", index=True)
    role_context: Mapped[str] = mapped_column(String(80))
    purpose: Mapped[str] = mapped_column(String(120), index=True)
    data_class: Mapped[str] = mapped_column(String(80))
    impact_class: Mapped[str] = mapped_column(String(40), default="STANDARD", index=True)
    ai_service: Mapped[str] = mapped_column(String(100))
    tenant: Mapped[str] = mapped_column(String(100))
    risk_ceiling: Mapped[float] = mapped_column(Float)
    control: Mapped[str] = mapped_column(String(30))
    policy_version_id: Mapped[str] = mapped_column(String(40), index=True)
    policy_version_ids: Mapped[list[str]] = mapped_column(JsonType, default=list)
    reviewer_id: Mapped[str] = mapped_column(String(40))
    justification: Mapped[str] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    embedding: Mapped[list[float] | None] = mapped_column(JsonType, nullable=True)
    term_hashes: Mapped[list[str]] = mapped_column(JsonType, default=list)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    reuse_limit: Mapped[int] = mapped_column(Integer, default=50)
    reuse_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(40), default="ACTIVE", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PrecedentApproval(Base):
    __tablename__ = "precedent_approvals"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("pap"))
    precedent_id: Mapped[str] = mapped_column(ForeignKey("precedents.id"), unique=True, index=True)
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    approver_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SessionRiskState(Base):
    __tablename__ = "session_risk_states"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ses"))
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(String(80), index=True)
    feature_counts: Mapped[dict] = mapped_column(JsonType, default=dict)
    cumulative_score: Mapped[float] = mapped_column(Float, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ClearanceGrantRecord(Base):
    __tablename__ = "clearance_grants"
    jti: Mapped[str] = mapped_column(String(60), primary_key=True)
    evaluation_id: Mapped[str] = mapped_column(String(40), index=True)
    destination_id: Mapped[str] = mapped_column(String(40))
    subject: Mapped[str] = mapped_column(String(40))
    nonce: Mapped[str] = mapped_column(String(80), unique=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    sequence: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String(40), unique=True, default=lambda: new_id("aud"))
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    actor_id: Mapped[str] = mapped_column(String(40), index=True)
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    department: Mapped[str] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[str] = mapped_column(String(50), index=True)
    payload: Mapped[dict] = mapped_column(JsonType, default=dict)
    previous_hash: Mapped[str] = mapped_column(String(64))
    event_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("mdl"))
    organisation_id: Mapped[str] = mapped_column(String(40), index=True, default="org_ghst_demo")
    model_name: Mapped[str] = mapped_column(String(120), unique=True)
    model_digest: Mapped[str] = mapped_column(String(64))
    base_model: Mapped[str | None] = mapped_column(String(160), nullable=True)
    adapter_type: Mapped[str] = mapped_column(String(30), default="BASE")
    dataset_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detector_versions: Mapped[dict] = mapped_column(JsonType, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="CANDIDATE")
    metrics: Mapped[dict] = mapped_column(JsonType, default=dict)
    previous_model_id: Mapped[str | None] = mapped_column(ForeignKey("model_versions.id"), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    deployed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ModelTrainingJob(Base):
    __tablename__ = "model_training_jobs"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("job"))
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    model_name: Mapped[str] = mapped_column(String(120))
    backend: Mapped[str] = mapped_column(String(40), default="QLORA")
    dataset_digest: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(30), default="REGISTERED", index=True)
    config: Mapped[dict] = mapped_column(JsonType, default=dict)
    report: Mapped[dict] = mapped_column(JsonType, default=dict)
    output_path: Mapped[str | None] = mapped_column(String(300), nullable=True)
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LearningArtefact(Base):
    __tablename__ = "learning_artefacts"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("learn"))
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    artefact_type: Mapped[str] = mapped_column(String(60), default="ACE_PRECEDENT")
    source_decision_ids: Mapped[list[str]] = mapped_column(JsonType, default=list)
    version: Mapped[str] = mapped_column(String(40), default="1.0")
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    approved_by: Mapped[str] = mapped_column(String(40))
    precedent_id: Mapped[str | None] = mapped_column(ForeignKey("precedents.id"), nullable=True)
    provenance: Mapped[dict] = mapped_column(JsonType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class CalibrationRecommendation(Base):
    __tablename__ = "calibration_recommendations"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("cal"))
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    version: Mapped[str] = mapped_column(String(40))
    source_review_ids: Mapped[list[str]] = mapped_column(JsonType, default=list)
    proposed_config: Mapped[dict] = mapped_column(JsonType, default=dict)
    evidence: Mapped[dict] = mapped_column(JsonType, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UsabilityStudyResponse(Base):
    __tablename__ = "usability_study_responses"
    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("uxr"))
    organisation_id: Mapped[str] = mapped_column(String(40), index=True)
    participant_hash: Mapped[str] = mapped_column(String(64), index=True)
    role_context: Mapped[str] = mapped_column(String(80))
    department_group: Mapped[str] = mapped_column(String(80), index=True)
    task_results: Mapped[list[dict]] = mapped_column(JsonType, default=list)
    sus_answers: Mapped[list[int]] = mapped_column(JsonType, default=list)
    task_completion_rate: Mapped[float] = mapped_column(Float)
    sus_score: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
