import mimetypes
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

import httpx

from app.core.config import Settings


@dataclass
class StoredPolicyAsset:
    adapter: str
    key: str
    size_bytes: int
    content_type: str


class PolicyStorageError(RuntimeError):
    pass


class PolicyStorageAdapter:
    label: str

    def store(self, *, organisation_id: str, version_id: str, filename: str, content: bytes, content_type: str) -> StoredPolicyAsset:
        raise NotImplementedError

    def read(self, *, key: str) -> tuple[bytes, str]:
        raise NotImplementedError


class LocalDemoPolicyStorageAdapter(PolicyStorageAdapter):
    label = "Local storage demo adapter"

    def __init__(self, settings: Settings):
        self.root = Path(settings.policy_local_storage_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def store(self, *, organisation_id: str, version_id: str, filename: str, content: bytes, content_type: str) -> StoredPolicyAsset:
        target = self.root / organisation_id / version_id
        target.mkdir(parents=True, exist_ok=True)
        path = target / filename
        path.write_bytes(content)
        return StoredPolicyAsset(adapter="LOCAL_DEMO", key=str(path.relative_to(self.root)).replace("\\", "/"), size_bytes=len(content), content_type=content_type)

    def read(self, *, key: str) -> tuple[bytes, str]:
        path = (self.root / key).resolve()
        if self.root not in path.parents and path != self.root:
            raise PolicyStorageError("Policy asset path escapes the configured local storage root.")
        if not path.exists():
            raise PolicyStorageError("The requested policy asset was not found in local demo storage.")
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return path.read_bytes(), content_type


class SupabasePolicyStorageAdapter(PolicyStorageAdapter):
    label = "Supabase private storage"

    def __init__(self, settings: Settings):
        if not settings.supabase_project_url or not settings.supabase_service_role_key:
            raise PolicyStorageError("Supabase storage requires SUPABASE_PROJECT_URL and SUPABASE_SERVICE_ROLE_KEY.")
        self.base_url = settings.supabase_project_url.rstrip("/")
        self.service_key = settings.supabase_service_role_key
        self.bucket = settings.supabase_storage_bucket

    def store(self, *, organisation_id: str, version_id: str, filename: str, content: bytes, content_type: str) -> StoredPolicyAsset:
        key = f"{organisation_id}/{version_id}/{filename}"
        url = f"{self.base_url}/storage/v1/object/{self.bucket}/{quote(key)}"
        headers = {
            "Authorization": f"Bearer {self.service_key}",
            "apikey": self.service_key,
            "x-upsert": "true",
            "Content-Type": content_type,
        }
        with httpx.Client(timeout=20.0, trust_env=False) as client:
            response = client.post(url, headers=headers, content=content)
        if response.status_code >= 400:
            raise PolicyStorageError(f"Supabase storage rejected the policy upload ({response.status_code}).")
        return StoredPolicyAsset(adapter="SUPABASE", key=key, size_bytes=len(content), content_type=content_type)

    def read(self, *, key: str) -> tuple[bytes, str]:
        url = f"{self.base_url}/storage/v1/object/{self.bucket}/{quote(key)}"
        headers = {
            "Authorization": f"Bearer {self.service_key}",
            "apikey": self.service_key,
        }
        with httpx.Client(timeout=20.0, trust_env=False) as client:
            response = client.get(url, headers=headers)
        if response.status_code >= 400:
            raise PolicyStorageError(f"Supabase storage could not fetch the policy asset ({response.status_code}).")
        return response.content, response.headers.get("content-type", "application/octet-stream")


def policy_storage_adapter(settings: Settings) -> PolicyStorageAdapter:
    if settings.policy_storage_adapter == "SUPABASE":
        return SupabasePolicyStorageAdapter(settings)
    adapter = LocalDemoPolicyStorageAdapter(settings)
    adapter.label = settings.policy_demo_adapter_label
    return adapter
