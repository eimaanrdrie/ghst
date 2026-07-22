"""Measure prototype governance latency on the current reference environment."""
from __future__ import annotations

import json
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
database_path = Path(tempfile.gettempdir()) / f"ghst_perf_{os.getpid()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{database_path}"
os.environ["DEMO_MODE"] = "true"
os.environ["JWT_SECRET"] = "performance-jwt-secret-with-more-than-32-characters"
os.environ["PROMPT_HMAC_KEY"] = "performance-hmac-secret-with-more-than-32-characters"
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from app.db.seed import seed_database  # noqa: E402
from app.main import app  # noqa: E402


def percentile(values: list[float], fraction: float) -> float:
    return sorted(values)[min(len(values) - 1, int(len(values) * fraction))]


def main() -> int:
    try:
        seed_database()
        client = TestClient(app)
        login = client.post("/api/v1/auth/login", json={"username": "legal.employee@ghst.demo", "password": "DemoLegal!2026"})
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        latencies = []
        gateway_latencies = []
        for index in range(25):
            prompt = f"Summarise public Federal Court decision DEMO-PERF-{index}."
            start = time.perf_counter()
            evaluated = client.post("/api/v1/evaluations", headers=headers, data={"prompt": prompt, "purpose": "Legal research", "destination_origin": "http://localhost:3000/ai-sandbox", "session_id": f"perf-{index}", "device_id": "perf-device"})
            latencies.append((time.perf_counter() - start) * 1000)
            assert evaluated.json()["action"] == "ALLOW"
            grant = client.post(f"/api/v1/evaluations/{evaluated.json()['evaluation_id']}/clearance-grant", headers=headers, json={"prompt": prompt, "device_id": "perf-device"}).json()
            start = time.perf_counter()
            gateway = client.post("/api/v1/gateway/v1/chat/completions", headers=headers, json={"model": "mock-approved-model", "messages": [{"role": "user", "content": prompt}], "clearance_grant": grant["clearance_grant"], "device_id": "perf-device"})
            gateway_latencies.append((time.perf_counter() - start) * 1000)
            assert gateway.status_code == 200
        report = {
            "environment": "Codex reference container; SQLite demo mode",
            "iterations": len(latencies),
            "deterministic_evaluation_median_ms": round(statistics.median(latencies), 2),
            "deterministic_evaluation_p95_ms": round(percentile(latencies, .95), 2),
            "gateway_fast_path_median_ms": round(statistics.median(gateway_latencies), 2),
            "gateway_fast_path_p95_ms": round(percentile(gateway_latencies, .95), 2),
            "targets": {"deterministic_ms": 500, "automated_p95_ms": 10000, "gateway_ms": 300},
        }
        report["passed"] = report["deterministic_evaluation_p95_ms"] < 500 and report["gateway_fast_path_p95_ms"] < 300
        (ROOT / "data" / "performance_report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
        return 0 if report["passed"] else 1
    finally:
        database_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())

