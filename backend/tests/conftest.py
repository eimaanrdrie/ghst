import os
import tempfile
from pathlib import Path

TEST_DATABASE_PATH = Path(tempfile.gettempdir()) / f"ghst_pytest_{os.getpid()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE_PATH}"
os.environ["DEMO_MODE"] = "true"
os.environ["JWT_SECRET"] = "test-jwt-secret-with-more-than-32-characters"
os.environ["PROMPT_HMAC_KEY"] = "test-hmac-secret-with-more-than-32-characters"
os.environ["APPROVED_DESTINATION_ORIGIN"] = "http://localhost:3000/ai-sandbox"
os.environ["SUPPORTED_AI_ORIGINS"] = "http://localhost:3000/ai-sandbox,https://chatgpt.com,https://chat.openai.com"

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.base import Base
from app.db.seed import seed_database
from app.db.session import engine
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def database():
    TEST_DATABASE_PATH.unlink(missing_ok=True)
    Base.metadata.drop_all(bind=engine)
    seed_database()
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    TEST_DATABASE_PATH.unlink(missing_ok=True)


@pytest.fixture()
def client():
    return TestClient(app)


def login(client: TestClient, username: str, password: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture()
def legal_headers(client):
    return login(client, "legal.employee@ghst.demo", "DemoLegal!2026")


@pytest.fixture()
def finance_headers(client):
    return login(client, "finance.employee@ghst.demo", "DemoFinance!2026")


@pytest.fixture()
def reviewer_headers(client):
    return login(client, "legal.reviewer@ghst.demo", "DemoReview!2026")


@pytest.fixture()
def second_reviewer_headers(client):
    return login(client, "legal.reviewer2@ghst.demo", "DemoReview2!2026")


@pytest.fixture()
def policy_headers(client):
    return login(client, "policy.admin@ghst.demo", "DemoPolicy!2026")


@pytest.fixture()
def auditor_headers(client):
    return login(client, "auditor@ghst.demo", "DemoAudit!2026")


@pytest.fixture()
def system_headers(client):
    return login(client, "system.admin@ghst.demo", "DemoSystem!2026")
