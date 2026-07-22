from pydantic import BaseModel, Field


class UsabilityTaskResult(BaseModel):
    task_id: str = Field(min_length=2, max_length=80)
    completed: bool
    duration_seconds: float = Field(ge=0, le=3600)
    errors: int = Field(default=0, ge=0, le=100)


class UsabilityStudySubmission(BaseModel):
    task_results: list[UsabilityTaskResult] = Field(min_length=5, max_length=20)
    sus_answers: list[int] = Field(min_length=10, max_length=10)
