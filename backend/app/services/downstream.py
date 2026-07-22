from typing import Protocol
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import Settings


class DownstreamError(RuntimeError):
    pass


class Choice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    index: int = 0
    message: dict
    finish_reason: str | None = None


class ApprovedProviderResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    choices: list[Choice] = Field(min_length=1)


class DownstreamAdapter(Protocol):
    name: str

    def send(self, *, model: str, messages: list[dict]) -> list[dict]: ...


class TransparentDemoAdapter:
    name = "transparent-local-demo"

    def send(self, *, model: str, messages: list[dict]) -> list[dict]:
        return [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "GHST Sandbox AI received a policy-cleared, non-sensitive request. This is the explicit local demo downstream adapter.",
            },
            "finish_reason": "stop",
        }]


class OpenAICompatibleAdapter:
    name = "approved-openai-compatible"

    def __init__(self, settings: Settings):
        self.settings = settings
        parsed = urlparse(settings.downstream_base_url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise DownstreamError("A real approved downstream must use a configured HTTPS origin.")
        if not settings.downstream_api_key:
            raise DownstreamError("The approved downstream credential is not configured.")

    def send(self, *, model: str, messages: list[dict]) -> list[dict]:
        provider = self.settings.downstream_provider
        headers = {"Content-Type": "application/json"}
        if provider == "azure_openai":
            headers["api-key"] = self.settings.downstream_api_key
        else:
            headers["Authorization"] = f"Bearer {self.settings.downstream_api_key}"
        verify: bool | str = self.settings.downstream_ca_bundle or True
        try:
            with httpx.Client(
                timeout=self.settings.downstream_timeout_seconds,
                trust_env=False,
                verify=verify,
            ) as client:
                response = client.post(
                    self.settings.downstream_base_url.rstrip("/") + self.settings.downstream_chat_path,
                    headers=headers,
                    json={"model": self.settings.downstream_model or model, "messages": messages},
                )
                response.raise_for_status()
                validated = ApprovedProviderResponse.model_validate(response.json())
                return [choice.model_dump() for choice in validated.choices]
        except (httpx.HTTPError, ValueError) as exc:
            raise DownstreamError("The approved downstream rejected or returned an invalid response.") from exc


def downstream_adapter(settings: Settings) -> DownstreamAdapter:
    if settings.downstream_mode == "mock":
        return TransparentDemoAdapter()
    return OpenAICompatibleAdapter(settings)
