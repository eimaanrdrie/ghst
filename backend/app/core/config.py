from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../.env", extra="ignore")

    environment: str = "development"
    demo_mode: bool = True
    fail_closed: bool = True
    log_level: str = "INFO"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    database_url: str = "sqlite:///./ghst_demo.db"
    database_pool_size: int = Field(default=5, ge=1, le=20)
    database_max_overflow: int = Field(default=5, ge=0, le=40)
    database_pool_recycle_seconds: int = Field(default=300, ge=30, le=3600)
    cors_origins: str = "http://localhost:3000"

    jwt_secret: str = "development-only-jwt-secret-change-me"
    prompt_hmac_key: str = "development-only-hmac-secret-change-me"
    review_encryption_key: str = ""
    grant_ed25519_private_key: str = ""
    grant_ed25519_public_key: str = ""

    supported_ai_origins: str = "http://localhost:3000/ai-sandbox,https://chatgpt.com,https://chat.openai.com"
    approved_destination_origin: str = "http://localhost:3000/ai-sandbox"
    approved_destination_service: str = "GHST Sandbox AI"
    approved_destination_tenant: str = "demo-tenant"
    approved_model_class: str = "mock-approved-model"

    policy_storage_adapter: Literal["LOCAL_DEMO", "SUPABASE"] = "LOCAL_DEMO"
    policy_local_storage_root: str = "./private_policy_store"
    policy_demo_adapter_label: str = "Local storage demo adapter"
    supabase_project_url: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "ghst-policy-memory"
    policy_max_upload_bytes: int = 15_728_640
    policy_ocr_enabled: bool = True
    policy_ocr_language: str = "eng"
    policy_signature_scan_limit_bytes: int = 4096
    malware_scan_command: str = ""
    policy_embedding_dimensions: int = 128

    max_prompt_chars: int = 12_000
    max_pdf_bytes: int = 5_242_880
    max_pdf_pages: int = 25
    pdf_parse_timeout_seconds: float = 20.0
    ocr_enabled: bool = True
    ocr_language: str = "eng"
    ocr_command: str = "tesseract"
    pdf_renderer_command: str = "pdftoppm"
    review_ttl_seconds: int = 900
    clearance_ttl_seconds: int = 60
    precedent_valid_days: int = 90
    ace_similarity_threshold: float = 0.72
    local_model_confidence_threshold: float = 0.78
    second_reviewer_risk_threshold: float = 0.6
    session_risk_ttl_seconds: int = 1800

    local_model: str = "qwen3.5:9b"
    local_model_fallback: str = "qwen3.5:4b"
    ollama_url: str = "http://localhost:11434"
    downstream_mode: Literal["mock", "real"] = "mock"
    downstream_provider: Literal["openai_compatible", "azure_openai"] = "openai_compatible"
    downstream_base_url: str = ""
    downstream_api_key: str = ""
    downstream_chat_path: str = "/v1/chat/completions"
    downstream_model: str = ""
    downstream_ca_bundle: str = ""
    downstream_timeout_seconds: float = 20.0

    @field_validator("jwt_secret", "prompt_hmac_key")
    @classmethod
    def validate_secrets(cls, value: str) -> str:
        if len(value) < 24:
            raise ValueError("security keys must contain at least 24 characters")
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def supported_origin_list(self) -> list[str]:
        return [item.strip() for item in self.supported_ai_origins.split(",") if item.strip()]

    @property
    def database_provider(self) -> str:
        value = self.database_url.lower()
        if value.startswith("sqlite"):
            return "SQLITE"
        if "supabase.co" in value:
            return "SUPABASE_POSTGRESQL"
        if value.startswith("postgresql") or value.startswith("postgres"):
            return "POSTGRESQL"
        return "UNKNOWN"

    @property
    def uses_supabase(self) -> bool:
        return self.database_provider == "SUPABASE_POSTGRESQL"


@lru_cache
def get_settings() -> Settings:
    return Settings()
