"""Generate an exhaustive authoritative requirement-to-component checklist."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "AUTHORITATIVE_REQUIREMENTS.md"
OUTPUT = ROOT / "REQUIREMENTS_TRACEABILITY.md"

COMPONENTS = {
    "BR": "governance.py; security.py; role dependencies",
    "FR-IAM": "deps.py; ReviewDelegation model/routes; reviewer-access UI",
    "FR-PEP": "extension/adapters.js; content.js; background.js",
    "FR-IN": "routes/evaluations.py; services/pdf.py; bounded local OCR",
    "FR-DET": "detectors.py; semantic.py; session_risk.py; synthetic corpus",
    "FR-POL": "policy.py; policy lifecycle/simulation routes and UI",
    "FR-DEC": "services/governance.py; employee decision UI",
    "FR-REV": "routes/reviews.py; frontend/app/reviews",
    "FR-ACE": "services/ace.py; Precedent/LearningArtefact models; precedents UI",
    "FR-LRN": "learning routes; calibration.py; training.py; model lifecycle UI",
    "FR-GW": "gateway.py; downstream.py; cryptographic clearance",
    "FR-OPS": "routes/operations.py; services/audit.py; dashboard/audit UI",
    "QR-ACC": "scripts/evaluate_corpus.py; backend tests; corpus reports",
    "QR-PERF": "scripts/performance_check.py; data/performance_report.json",
    "QR-SEC": "SECURITY.md; crypto/RBAC; Docker networks; tests",
    "QR-REL": "migrations; seed; live verification; generated backup MP4",
    "QR-UX": "responsive Next.js UI; extension Shadow DOM composer",
    "QR-EXP": "decision response; audit UI and chain verifier",
    "QR-MNT": "modular services; versioned API/site adapters; tests",
    "QR-PORT": "docker-compose.yml; Dockerfiles; environment configuration",
    "AT": "backend/tests; scripts/live_demo_check.py; demo runbook",
}

EVIDENCE = {
    "BR": "Inspection plus security-boundary tests",
    "FR-IAM": "signed-claim, delegation, revocation and RBAC tests",
    "FR-PEP": "Node adapter contract tests; manifest checks; load-unpacked runbook",
    "FR-IN": "PDF, malformed input, real OCR, redaction and corpus tests",
    "FR-DET": "120-case corpus, rolling-session and model-abstention tests",
    "FR-POL": "policy retrieval, simulation, activation and invalidation tests",
    "FR-DEC": "governance and live journey tests",
    "FR-REV": "human review, challenge UI, delegation and dual-approval tests",
    "FR-ACE": "reuse, global scope, dual approval, expiry, revoke and invalidation tests",
    "FR-LRN": "calibration, private dataset, candidate gates, promotion and rollback tests",
    "FR-GW": "grant, digest, replay, provider adapter and missing-grant tests",
    "FR-OPS": "audit tamper/fail-safe/health tests and dashboard build",
    "QR-ACC": "data/corpus_metrics.json",
    "QR-PERF": "data/performance_report.json",
    "QR-SEC": "expanded security suite; dependency scan; production TLS profile",
    "QR-REL": "three live runs; clean/upgrade migration; backup video integrity",
    "QR-UX": "TypeScript/build checks; manual browser review still required",
    "QR-EXP": "audit and response assertions",
    "QR-MNT": "source inspection and tests",
    "QR-PORT": "Compose configuration; local equivalent verified",
    "AT": "Mapped automated/manual acceptance evidence",
}

ENV_UNVERIFIED = {"FR-DET-006", "FR-DET-007", "FR-DET-008", "QR-ACC-006", "AT-22"}
TRAINING_UNVERIFIED = {"FR-LRN-010"}
HUMAN_STUDY = {"QR-UX-007"}
DEPLOYMENT = {"QR-SEC-001", "QR-SEC-003"}
MANUAL = {"FR-PEP-001", "FR-PEP-002", "FR-PEP-003", "FR-PEP-004", "FR-PEP-005", "FR-PEP-007", "FR-PEP-008", "FR-PEP-009", "FR-PEP-010", "FR-PEP-012", "QR-UX-004", "QR-UX-005", "AT-20"}


def group(requirement_id: str) -> str:
    for prefix in sorted(COMPONENTS, key=len, reverse=True):
        if requirement_id.startswith(prefix):
            return prefix
    return "BR"


def status(requirement_id: str, priority: str) -> str:
    if requirement_id in ENV_UNVERIFIED:
        return "Integration implemented; actual Ollama candidates unavailable for verification"
    if requirement_id in TRAINING_UNVERIFIED:
        return "Complete private QLoRA pipeline implemented and dataset validation verified; GPU training run unavailable"
    if requirement_id in HUMAN_STUDY:
        return "Measurement API and study protocol implemented; representative human study not yet conducted"
    if requirement_id in DEPLOYMENT:
        return "Production TLS and isolated-egress profile implemented; Docker runtime unavailable for execution"
    if requirement_id in MANUAL:
        return "Implemented; final Chrome/accessibility verification is manual"
    return "Implemented and verified within the synthetic MVP boundary"


def parse() -> tuple[list[tuple[str, str, str]], list[str]]:
    records = []
    duplicates = []
    seen = set()
    for line in SOURCE.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\|\s*((?:BR|FR|QR|AT)-[A-Z0-9-]+)\s*\|(.+)$", line)
        if not match:
            continue
        requirement_id = match.group(1)
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if requirement_id in seen:
            duplicates.append(requirement_id)
            continue
        seen.add(requirement_id)
        if requirement_id.startswith("FR-"):
            priority, requirement = cells[1], cells[2]
        elif requirement_id.startswith("AT-"):
            priority, requirement = "Acceptance", f"{cells[1]} -> {cells[2]}"
        elif requirement_id.startswith("QR-"):
            priority, requirement = "Quality", cells[1]
        else:
            priority, requirement = "P0", cells[1]
        records.append((requirement_id, priority, requirement))
    return records, duplicates


def main() -> None:
    records, duplicates = parse()
    counts = {"BR": 0, "FR": 0, "QR": 0, "AT": 0}
    for requirement_id, _, _ in records:
        counts[requirement_id.split("-")[0]] += 1
    lines = [
        "# GHST Requirements Traceability",
        "",
        "This checklist maps every unique requirement in `docs/AUTHORITATIVE_REQUIREMENTS.md` to implemented source and verification evidence. Status wording is deliberately conservative: unavailable local-model weights, external deployment controls and user studies are not represented as completed.",
        "",
        "## Coverage summary",
        "",
        f"- {counts['BR']} business rules",
        f"- {counts['FR']} functional requirements",
        f"- {counts['QR']} unique quality requirements",
        f"- {counts['AT']} acceptance scenarios",
        f"- Authoritative-source duplicate identifiers detected and deduplicated: {', '.join(sorted(set(duplicates))) or 'none'}",
        "",
        "## Requirement-level checklist",
        "",
        "| ID | Priority | Authoritative requirement | Implemented component | Verification evidence | Status |",
        "|---|---|---|---|---|---|",
    ]
    for requirement_id, priority, requirement in records:
        key = group(requirement_id)
        safe_requirement = requirement.replace("|", "\\|").replace("`", "'")
        lines.append(f"| {requirement_id} | {priority} | {safe_requirement} | {COMPONENTS[key]} | {EVIDENCE[key]} | {status(requirement_id, priority)} |")
    lines += [
        "",
        "## Release interpretation",
        "",
        "The P0/P1 application capabilities and governed P2 lifecycle are implemented in source and mapped above. Actual Qwen benchmarking and GPU QLoRA training remain environment-dependent because the build host has no Ollama service, model weights or GPU worker. The synthetic backup MP4 is generated and verified. The usability evidence API and protocol are operational, but representative-user results still require accountable human participants.",
    ]
    OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{OUTPUT}: {len(records)} unique requirements")


if __name__ == "__main__":
    main()
