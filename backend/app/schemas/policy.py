from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


PolicyAction = Literal["ALLOW", "REDACT", "REDIRECT", "REVIEW", "BLOCK"]
PolicyLifecycle = Literal["UPLOADED", "SCANNING", "EXTRACTING", "HUMAN_REVIEW", "SIMULATION", "ACTIVE", "RETIRED"]
VerificationStatus = Literal["DRAFT", "SUGGESTED", "VERIFIED", "DELETED"]


class PolicyUploadResponse(BaseModel):
    policy_id: str
    version_id: str
    status: PolicyLifecycle
    storage_adapter: str
    storage_label: str
    clause_count: int


class PolicyLookupResponse(BaseModel):
    departments: list[str]
    roles: list[str]
    purposes: list[str]
    data_classes: list[str]
    destinations: list[str]
    actions: list[PolicyAction]
    storage_adapters: list[dict]


class ClauseMutation(BaseModel):
    clause_ref: str = Field(min_length=1, max_length=50)
    text: str = Field(min_length=10)
    department: str = "ALL"
    roles: list[str] = []
    purposes: list[str] = []
    data_classes: list[str] = []
    destinations: list[str] = []
    action: PolicyAction
    page_number: int = Field(default=1, ge=1)
    heading: str | None = Field(default=None, max_length=240)
    verification_status: VerificationStatus = "VERIFIED"
    human_notes: str | None = Field(default=None, max_length=2000)


class ClauseSplitRequest(BaseModel):
    parts: list[ClauseMutation] = Field(min_length=2)


class ClauseMergeRequest(BaseModel):
    clause_ids: list[str] = Field(min_length=2)
    merged: ClauseMutation


class ClauseOut(BaseModel):
    id: str
    clause_ref: str
    text: str
    department: str
    roles: list[str]
    purposes: list[str]
    data_classes: list[str]
    destinations: list[str]
    action: PolicyAction
    page_number: int
    heading: str | None
    verification_status: str
    human_notes: str | None = None
    source_order: int
    suggested_metadata: dict
    metadata_json: dict
    verified_by: str | None = None
    verified_at: datetime | None = None


class PolicyVersionOut(BaseModel):
    id: str
    version: str
    status: str
    source_filename: str | None = None
    storage_adapter: str
    mime_type: str | None = None
    size_bytes: int
    sha256: str | None = None
    source_kind: str
    extraction_metadata: dict
    malware_scan: dict
    verification_summary: dict
    extraction_error: str | None = None
    effective_at: datetime
    clauses: list[ClauseOut]


class PolicyOut(BaseModel):
    id: str
    name: str
    category: str
    owner: str
    scope: str
    status: str
    description: str | None = None
    versions: list[PolicyVersionOut]


class PolicyUploadMetadata(BaseModel):
    name: str = Field(min_length=3, max_length=180)
    version: str = Field(min_length=1, max_length=30)
    category: str = Field(min_length=2, max_length=60)
    owner: str = Field(min_length=2, max_length=120)
    scope: str = Field(default="ORGANISATION", min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    policy_id: str | None = None


class PolicyVersionCreate(BaseModel):
    version: str = Field(min_length=1, max_length=30)
    clauses: list[ClauseMutation]


class PolicyCreateRequest(BaseModel):
    name: str = Field(min_length=3, max_length=180)
    category: str = Field(min_length=2, max_length=60)
    owner: str = Field(min_length=2, max_length=120)
    scope: str = Field(default="ORGANISATION", min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    version: str = Field(min_length=1, max_length=30)
    clauses: list[ClauseMutation]


class PolicySimulationResponse(BaseModel):
    policy_id: str
    candidate_version_id: str
    candidate_version: str
    evaluations_examined: int
    changed_action_count: int
    changed_actions: list[dict]
    projected_action_counts: dict[str, int]
    affected_precedents: list[dict]
    activation_allowed: bool
    warning: str


class PolicyActivationResponse(BaseModel):
    status: str
    version_id: str
    invalidated_precedents: int


class AuditVerifyResponse(BaseModel):
    valid: bool
    checked_events: int
    first_broken_sequence: int | None = None
    message: str
