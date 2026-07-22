from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ReviewListItem(BaseModel):
    id: str
    evaluation_id: str
    department: str
    status: str
    severity: str
    requested_by_name: str | None = None
    purpose: str
    destination_origin: str
    risk_score: float
    created_at: datetime
    expires_at: datetime


class ReviewDetail(ReviewListItem):
    prompt: str
    findings: list[dict]
    policy_matches: list[dict]
    model_evidence: dict


class PrecedentScope(BaseModel):
    role_context: str = "EMPLOYEE"
    purpose: str
    data_class: str = "CONFIDENTIAL_BUSINESS_IP"
    risk_ceiling: float = Field(ge=0, le=1)
    control: str = "ALLOW"
    reuse_limit: int = Field(default=50, ge=1, le=500)
    validity_days: int = Field(default=90, ge=1, le=365)


class ReviewDecisionRequest(BaseModel):
    decision: str
    justification: str = Field(min_length=10, max_length=2000)
    create_precedent: bool = False
    precedent_scope: PrecedentScope | None = None


class ReviewDecisionResponse(BaseModel):
    review_id: str
    evaluation_id: str
    status: str
    decision: str
    precedent_id: str | None = None
    precedent_status: str | None = None
    proposed_precedent_id: str | None = None
    proposed_precedent_status: str | None = None
    message: str


class PrecedentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_review_id: str
    department: str
    scope: str
    role_context: str
    purpose: str
    data_class: str
    impact_class: str
    ai_service: str
    tenant: str
    risk_ceiling: float
    control: str
    policy_version_id: str
    policy_version_ids: list[str]
    reviewer_id: str
    justification: str
    expires_at: datetime
    reuse_limit: int
    reuse_count: int
    status: str
    created_at: datetime


class ReviewDelegationCreate(BaseModel):
    reviewer_id: str
    department: str = Field(min_length=2, max_length=80)
    reason: str = Field(min_length=10, max_length=1000)
    validity_days: int = Field(default=30, ge=1, le=180)


class ReviewDelegationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    reviewer_id: str
    department: str
    granted_by: str
    reason: str
    status: str
    expires_at: datetime
    created_at: datetime


class SecondApprovalRequest(BaseModel):
    approved: bool
    justification: str = Field(min_length=10, max_length=2000)


class GlobalScopeRequest(BaseModel):
    scope: str = Field(pattern="^(DEPARTMENT|GLOBAL)$")
    justification: str = Field(min_length=10, max_length=2000)
