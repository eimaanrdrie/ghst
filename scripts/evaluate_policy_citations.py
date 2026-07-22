"""Measure policy-citation correctness on labelled synthetic scenarios."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
database_path = Path(tempfile.gettempdir()) / f"ghst_policy_{os.getpid()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{database_path}"
os.environ["JWT_SECRET"] = "policy-check-jwt-secret-with-more-than-32-characters"
os.environ["PROMPT_HMAC_KEY"] = "policy-check-hmac-secret-with-more-than-32-characters"
sys.path.insert(0, str(ROOT / "backend"))

from app.db.seed import seed_database  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.services.policy import retrieve_policies  # noqa: E402


def main() -> int:
    try:
        seed_database()
        scenarios = []
        for index in range(10):
            scenarios.append(("Legal", "Legal research", f"Summarise public court decision DEMO-{index} without client information.", "Enterprise Data Classification and AI Handling Policy"))
            scenarios.append(("Finance", "Financial analysis", f"Analyse unreleased revenue forecast DEMO-{index}.", "Enterprise Data Classification and AI Handling Policy"))
        correct = 0
        with SessionLocal() as db:
            for department, purpose, text, expected_policy in scenarios:
                matches = retrieve_policies(db, "org_ghst_demo", department, ["EMPLOYEE"], purpose, text)
                if matches and matches[0]["policy"] == expected_policy:
                    correct += 1
        report = {
            "dataset": "ghst-labelled-policy-scenarios-v1",
            "scenarios": len(scenarios),
            "correct_top_citations": correct,
            "citation_accuracy": round(correct / len(scenarios), 4),
            "threshold": 0.9,
        }
        report["passed"] = report["citation_accuracy"] >= report["threshold"]
        (ROOT / "data" / "policy_citation_report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
        return 0 if report["passed"] else 1
    finally:
        database_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())

