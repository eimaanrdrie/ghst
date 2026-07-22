from pydantic import BaseModel, Field


class CalibrationRequest(BaseModel):
    minimum_validated_reviews: int = Field(default=3, ge=3, le=500)


class TrainingJobRegister(BaseModel):
    model_name: str = Field(min_length=3, max_length=120)
    base_model: str = Field(min_length=3, max_length=160)
    backend: str = Field(default="QLORA", pattern="^(QLORA|LORA|DEMO_MANIFEST)$")
    dataset_digest: str = Field(pattern="^[a-f0-9]{64}$")
    output_path: str | None = Field(default=None, max_length=300)
    config: dict
    report: dict


class ModelEvaluationRequest(BaseModel):
    held_out_recall: float = Field(ge=0, le=1)
    macro_f1: float = Field(ge=0, le=1)
    schema_validity: float = Field(ge=0, le=1)
    secret_false_allows: int = Field(ge=0)
    adversarial_passed: bool
    regression_passed: bool
    median_latency_ms: float = Field(gt=0)
    memory_gb: float = Field(gt=0)
    evaluation_dataset_digest: str = Field(pattern="^[a-f0-9]{64}$")


class LifecycleDecision(BaseModel):
    justification: str = Field(min_length=10, max_length=2000)
