from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


Action = Literal["ALLOW", "REDACT", "REDIRECT", "REVIEW", "BLOCK"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class FindingOut(BaseModel):
    category: str
    severity: str
    confidence: float
    detector: str
    source: str
    start: int
    end: int
    masked_preview: str
    redactable: bool
    confirmed: bool


class PolicyMatchOut(BaseModel):
    clause_id: str
    policy: str
    policy_version_id: str
    policy_version: str
    clause: str
    scope: str
    action: str
    score: float
    text: str
    page: int | None = None
    heading: str | None = None
    citation: str | None = None


class RiskOut(BaseModel):
    score: float
    level: str
    uncertainty: float


class ErrorBody(BaseModel):
    code: str
    message: str
    recovery: str | None = None
    request_id: str | None = None


class Paginated(BaseModel):
    items: list[Any]
    total: int
