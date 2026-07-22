#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.training import load_governed_dataset, run_qlora  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Run or validate GHST private adapter training.")
    parser.add_argument("--dataset", type=Path, default=ROOT / "data" / "private_training_examples.json")
    parser.add_argument("--base-model", default="Qwen/Qwen3-4B")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "ghst-private-qlora")
    parser.add_argument("--backend", choices=("validate", "qlora"), default="validate")
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    examples, digest = load_governed_dataset(args.dataset)
    report = {
        "trained": False,
        "backend": "VALIDATION_ONLY",
        "deidentified": True,
        "balanced": True,
        "examples": len(examples),
        "dataset_digest": digest,
        "base_model": args.base_model,
    }
    if args.backend == "qlora":
        args.output.mkdir(parents=True, exist_ok=True)
        report.update(run_qlora(
            examples=examples,
            base_model=args.base_model,
            output_dir=args.output,
            epochs=args.epochs,
        ))
    report_path = args.report or (
        ROOT / "data" / "private_training_validation_report.json"
        if args.backend == "validate"
        else args.output.parent / "training_report.json"
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({**report, "report_path": str(report_path)}, indent=2))


if __name__ == "__main__":
    main()
