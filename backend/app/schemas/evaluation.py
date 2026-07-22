from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import Action, FindingOut, PolicyMatchOut, RiskOut


class EvaluationResponse(BaseModel):
    evaluation_id: str
    state: str
    action: Action
    department: str
    purpose: str
    destination_origin: str
    risk: RiskOut
    findings: list[FindingOut]
    policy_matches: list[PolicyMatchOut]
    reason_codes: list[str]
    learning_source: str
    precedent_id: str | None = None
    message: str
    review_id: str | None = None
    redirect_origin: str | None = None
    redacted_text: str | None = None
    model_evidence: dict
    created_at: datetime


class RedactRequest(BaseModel):
    prompt: str = Field(min_length=1)
    destination_origin: str
    purpose: str
    session_id: str = "web-session"
    device_id: str = "managed-demo-device"


class ChallengeRequest(BaseModel):
    reason: str = Field(min_length=8, max_length=1000)


class GrantRequest(BaseModel):
    prompt: str = Field(min_length=1)
    device_id: str = Field(min_length=3, max_length=120)


class GrantResponse(BaseModel):
    clearance_grant: str
    expires_at: datetime
    destination_id: str


class GatewayRequest(BaseModel):
    model: str = "mock-approved-model"
    messages: list[dict]
    clearance_grant: str | None = None
    device_id: str = "managed-demo-device"


class GatewayResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[dict]
    governance: dict

