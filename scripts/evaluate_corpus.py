"""Evaluate deterministic class recall and false-Allow safety on the synthetic corpus."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.detectors import detect  # noqa: E402


def main() -> int:
    corpus = json.loads((ROOT / "data" / "synthetic_corpus.json").read_text())
    held_out = [item for item in corpus["cases"] if item["partition"] == "held_out"]
    sensitive = [item for item in held_out if item["expected_category"] != "NONE"]
    hits = 0
    false_allow_secrets = 0
    per_class = Counter()
    totals = Counter()
    predictions = []
    for item in held_out:
        findings = detect(item["text"])
        categories = {finding["category"] for finding in findings}
        expected = item["expected_category"]
        predicted = findings[0]["category"] if findings else "NONE"
        predictions.append((expected, predicted))
        if expected != "NONE":
            totals[expected] += 1
            if expected in categories:
                hits += 1
                per_class[expected] += 1
            if expected == "AUTHENTICATION_SECRETS" and expected not in categories:
                false_allow_secrets += 1
    classes = ["NONE", "PERSONAL_DATA", "FINANCIAL_DATA", "AUTHENTICATION_SECRETS", "CONFIDENTIAL_BUSINESS_IP", "REGULATED_RECORDS"]
    f1_values = []
    for category in classes:
        tp = sum(expected == category and predicted == category for expected, predicted in predictions)
        fp = sum(expected != category and predicted == category for expected, predicted in predictions)
        fn = sum(expected == category and predicted != category for expected, predicted in predictions)
        precision = tp / max(1, tp + fp)
        recall = tp / max(1, tp + fn)
        f1_values.append(2 * precision * recall / max(1e-9, precision + recall))
    report = {
        "corpus": corpus["name"],
        "cases": corpus["count"],
        "held_out_cases": len(held_out),
        "sensitive_cases": len(sensitive),
        "supported_class_recall": round(hits / len(sensitive), 4),
        "macro_f1": round(sum(f1_values) / len(f1_values), 4),
        "per_class_recall": {name: round(per_class[name] / total, 4) for name, total in totals.items()},
        "high_severity_secret_false_allows": false_allow_secrets,
        "note": "Deterministic supported-class benchmark; contextual model metrics require scripts/benchmark_models.py and local Ollama models.",
    }
    (ROOT / "data" / "corpus_metrics.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0 if report["supported_class_recall"] >= 0.95 and report["macro_f1"] >= 0.85 and false_allow_secrets == 0 else 1



if __name__ == "__main__":
    raise SystemExit(main())
