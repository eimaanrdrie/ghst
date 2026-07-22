import hashlib
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import encrypted_review_payload, hash_password
from app.db.base import Base
from app.db.models import (
    CalibrationRecommendation,
    Destination,
    Evaluation,
    LearningArtefact,
    ModelTrainingJob,
    ModelVersion,
    Policy,
    PolicyClause,
    PolicyVersion,
    Precedent,
    PrecedentApproval,
    Review,
    User,
)
from app.services.embeddings import local_embedding
from app.services.policy import version_verification_summary
from app.db.session import SessionLocal, engine


DEMO_USERS = [
    ("legal.employee@ghst.demo", "Aisha Rahman", "Legal", ["EMPLOYEE"], "DemoLegal!2026"),
    ("finance.employee@ghst.demo", "Daniel Lim", "Finance", ["EMPLOYEE"], "DemoFinance!2026"),
    ("engineering.employee@ghst.demo", "Marcus Tan", "Engineering", ["EMPLOYEE"], "DemoEng!2026"),
    ("hr.employee@ghst.demo", "Sara Wong", "Human Resources", ["EMPLOYEE"], "DemoHR!2026"),
    ("legal.reviewer@ghst.demo", "Maya Chen", "Legal", ["REVIEWER"], "DemoReview!2026"),
    ("legal.reviewer2@ghst.demo", "Omar Aziz", "Legal", ["REVIEWER"], "DemoReview2!2026"),
    ("finance.reviewer@ghst.demo", "Hafiz Ismail", "Finance", ["REVIEWER"], "DemoReview!2026"),
    ("policy.admin@ghst.demo", "Priya Nair", "Governance", ["POLICY_ADMIN"], "DemoPolicy!2026"),
    ("auditor@ghst.demo", "Noah Williams", "Audit", ["AUDITOR"], "DemoAudit!2026"),
    ("system.admin@ghst.demo", "Elena Garcia", "Technology", ["SYSTEM_ADMIN"], "DemoSystem!2026"),
]


def seed_database() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        _seed_users(db)
        _seed_destination(db)
        _seed_policies(db)
        _seed_evaluations(db)
        _seed_reviews(db)
        _seed_models(db)
        _seed_learning(db)
        db.commit()


def _seed_users(db: Session) -> None:
    for username, name, department, roles, password in DEMO_USERS:
        if not db.scalar(select(User).where(User.username == username)):
            db.add(User(
                username=username,
                display_name=name,
                password_hash=hash_password(password),
                organisation_id="org_ghst_demo",
                department=department,
                roles=roles,
            ))


def _seed_destination(db: Session) -> None:
    settings = get_settings()
    origins = [settings.approved_destination_origin, *settings.supported_origin_list]
    for origin in dict.fromkeys(item.rstrip("/") for item in origins if item.strip()):
        if db.scalar(select(Destination).where(Destination.origin == origin)):
            continue
        parsed = urlparse(origin)
        host = parsed.netloc or origin
        is_primary = origin == settings.approved_destination_origin.rstrip("/")
        db.add(Destination(
            organisation_id="org_ghst_demo",
            service=settings.approved_destination_service if is_primary else host,
            origin=origin,
            tenant=settings.approved_destination_tenant if is_primary else host,
            model_class=settings.approved_model_class,
            trust_status="APPROVED",
        ))


def _seed_policies(db: Session) -> None:
    if db.scalar(select(Policy).where(Policy.organisation_id == "org_ghst_demo")):
        return
    definitions = [
        (
            "Enterprise Data Classification and AI Handling Policy", "DATA_HANDLING", "Chief Privacy Officer", "DATA-1.0",
            [
                ("ALL", "3.1", "Restricted or Confidential data shall not be transmitted to employee-facing external AI services. Personal and financial identifiers must be removed before release.", "BLOCK", [], ["CONFIDENTIAL_BUSINESS_IP", "REGULATED_RECORDS", "FINANCIAL_DATA", "PERSONAL_DATA"]),
                ("Finance", "3.4", "Unreleased revenue, forecasts, payroll, banking and payment records are Restricted Finance data and must be blocked from external AI services.", "BLOCK", ["Financial analysis"], ["FINANCIAL_DATA"]),
                ("Legal", "3.7", "Public court decisions and public legislation may be analysed at an approved AI destination when no client, privileged or personal information is included.", "ALLOW", ["Legal research"], ["PUBLIC_OR_INTERNAL_SAFE"]),
            ],
        ),
        (
            "Approved AI Destinations Standard", "APPROVED_DESTINATIONS", "CISO", "DEST-1.0",
            [("ALL", "2.1", "Only the organisation-approved GHST Sandbox AI tenant may receive policy-cleared non-sensitive prompts. Other destinations must be redirected or blocked.", "REDIRECT", [], [])],
        ),
        (
            "Acceptable Enterprise AI Use Policy", "ACCEPTABLE_USE", "AI Governance Council", "AUP-1.0",
            [
                ("ALL", "4.2", "Routine drafting, summarisation and research are permitted only after data classification and destination validation.", "ALLOW", [], ["PUBLIC_OR_INTERNAL_SAFE"]),
                ("ALL", "4.8", "Consequential employment, credit, health or legal determinations require authorised human review and may not be delegated solely to an AI model.", "REVIEW", ["Legal decision", "Medical advice", "Credit decision", "Hiring decision", "Terminate employee"], ["PUBLIC_OR_INTERNAL_SAFE"]),
            ],
        ),
        (
            "Human Review and Governance Precedent Policy", "HUMAN_REVIEW", "AI Governance Council", "HUMAN-1.0",
            [("ALL", "5.1", "Novel, ambiguous, low-confidence or organisation-specific requests require a departmental reviewer. Reuse is permitted only through an active, bounded, expiring and revocable ACE precedent.", "REVIEW", ["Legal decision", "Medical advice", "Credit decision", "Hiring decision", "Terminate employee"], ["PUBLIC_OR_INTERNAL_SAFE"])],
        ),
    ]
    for name, category, owner, version_name, clauses in definitions:
        policy = Policy(
            organisation_id="org_ghst_demo", name=name, category=category,
            owner=owner, scope="ORGANISATION", status="ACTIVE", description="Seeded GHST baseline policy set.",
            created_by="seeded-policy-authority",
        )
        db.add(policy)
        db.flush()
        content = "\n".join(item[2] for item in clauses)
        version = PolicyVersion(
            policy_id=policy.id,
            version=version_name,
            content_hash=hashlib.sha256(content.encode()).hexdigest(),
            approved_by="seeded-policy-authority",
            status="ACTIVE",
            source_kind="SEEDED",
            storage_adapter="LOCAL_DEMO",
            extraction_metadata={"source_type": "SEEDED"},
            malware_scan={"status": "SKIPPED_LOCAL_DEMO", "adapter": "seed-data"},
        )
        db.add(version)
        db.flush()
        created_clauses: list[PolicyClause] = []
        for department, ref, text, action, purposes, data_classes in clauses:
            clause = PolicyClause(
                policy_version_id=version.id,
                department=department,
                roles=[],
                purposes=purposes,
                data_classes=data_classes,
                destinations=["UNAPPROVED_ONLY"] if category == "APPROVED_DESTINATIONS" else [],
                clause_ref=ref,
                heading=name,
                page_number=1,
                source_order=len(created_clauses) + 1,
                text=text,
                action=action,
                verification_status="VERIFIED",
                suggested_metadata={"seeded": True},
                metadata_json={"seeded": True, "human_verified": True},
                embedding=local_embedding(text),
                verified_by="seeded-policy-authority",
            )
            db.add(clause)
            created_clauses.append(clause)
        version.verification_summary = version_verification_summary(created_clauses)


def _seed_models(db: Session) -> None:
    legacy_candidate = db.scalar(select(ModelVersion).where(
        ModelVersion.model_name == "Long-context candidate for legal-and-finance blended review v2026.07"
    ))
    if legacy_candidate:
        db.delete(legacy_candidate)

    candidates = [
        (
            "Qwen3.5:4B + GHST adapter v2.9",
            "RETIRED",
            {
                "training_report": {"validated": True},
                "evaluated": True,
                "held_out_recall": 0.962,
                "macro_f1": 0.901,
                "schema_validity": 0.988,
                "secret_false_allows": 1.2,
                "p95_latency_ms": 700,
                "evaluation_dataset_digest": hashlib.sha256(b"eval-retired-v2.9").hexdigest(),
            },
        ),
        (
            "Qwen3.5:4B + GHST adapter v3.1",
            "PRODUCTION",
            {
                "training_report": {"validated": True},
                "evaluated": True,
                "held_out_recall": 0.978,
                "macro_f1": 0.941,
                "schema_validity": 0.994,
                "secret_false_allows": 0.8,
                "p95_latency_ms": 620,
                "evaluation_dataset_digest": hashlib.sha256(b"eval-prod-v3.1").hexdigest(),
            },
        ),
        (
            "Private QLoRA adapter v3.2",
            "SHADOW",
            {
                "training_report": {"validated": True},
                "evaluated": True,
                "held_out_recall": 0.972,
                "macro_f1": 0.934,
                "schema_validity": 0.991,
                "secret_false_allows": 0.0,
                "p95_latency_ms": 640,
                "evaluation_dataset_digest": hashlib.sha256(b"eval-shadow-v3.2").hexdigest(),
            },
        ),
        (
            "Private QLoRA adapter v3.3",
            "EVALUATED",
            {
                "training_report": {"validated": True},
                "evaluated": True,
                "held_out_recall": 0.968,
                "macro_f1": 0.928,
                "schema_validity": 0.989,
                "secret_false_allows": 0.4,
                "p95_latency_ms": 658,
                "evaluation_dataset_digest": hashlib.sha256(b"eval-candidate-v3.3").hexdigest(),
                "gates": {
                    "recall": True,
                    "macro_f1": True,
                    "schema_validity": True,
                    "secret_false_allows": True,
                    "adversarial": True,
                    "regression": True,
                },
            },
        ),
    ]
    previous_id: str | None = None
    for name, status, metrics in candidates:
        item = db.scalar(select(ModelVersion).where(ModelVersion.model_name == name))
        if not item:
            item = ModelVersion(
                organisation_id="org_ghst_demo",
                model_name=name,
                model_digest=hashlib.sha256(name.encode()).hexdigest(),
                base_model="Qwen3.5:4B" if "Qwen3.5" in name else name,
                adapter_type="QLORA" if "adapter" in name else "DEMO_ADAPTER",
                detector_versions={"deterministic": "ghst-dlp-v1.0.0"},
            )
            db.add(item)
            db.flush()
        item.status = status
        item.metrics = metrics
        item.dataset_digest = metrics.get("evaluation_dataset_digest")
        item.previous_model_id = previous_id if status == "PRODUCTION" else item.previous_model_id
        item.created_at = item.created_at
        if status == "PRODUCTION":
            item.approved_by = _user_id(db, "policy.admin@ghst.demo")
            item.deployed_at = item.deployed_at or datetime.now(UTC)
        elif status == "RETIRED":
            item.approved_by = _user_id(db, "policy.admin@ghst.demo")
            item.deployed_at = item.deployed_at or datetime.now(UTC)
        elif status == "SHADOW":
            item.approved_by = None
            item.deployed_at = None
        elif status == "EVALUATED":
            item.approved_by = None
            item.deployed_at = None
        previous_id = item.id


def _seed_evaluations(db: Session) -> None:
    destination = db.scalar(select(Destination).where(Destination.organisation_id == "org_ghst_demo"))
    destination_id = destination.id if destination else None
    destination_origin = destination.origin if destination else "http://localhost:3000/ai-sandbox"
    legal_allow_match = _policy_match(db, "Enterprise Data Classification and AI Handling Policy", "3.7")
    review_match = _policy_match(db, "Human Review and Governance Precedent Policy", "5.1")
    determination_match = _policy_match(db, "Acceptable Enterprise AI Use Policy", "4.8")
    redirect_match = _policy_match(db, "Approved AI Destinations Standard", "2.1")
    block_match = _policy_match(db, "Enterprise Data Classification and AI Handling Policy", "3.1")
    seed_specs = [
        ("eng_eval_001", "engineering.employee@ghst.demo", "Engineering", "Architecture summarization", "ALLOW", 0.12, "LOW", [redirect_match], [], {"seeded": True}),
        ("eng_eval_002", "engineering.employee@ghst.demo", "Engineering", "Code migration checklist", "ALLOW", 0.09, "LOW", [redirect_match], [], {"seeded": True}),
        ("eng_eval_003", "engineering.employee@ghst.demo", "Engineering", "Production secrets review", "BLOCK", 0.92, "CRITICAL", [block_match], [{"category": "CONFIDENTIAL_BUSINESS_IP", "severity": "CRITICAL", "detector": "secret-classifier", "confidence": 0.99, "confirmed": True}], {"seeded": True}),
        ("eng_eval_004", "engineering.employee@ghst.demo", "Engineering", "Incident timeline redact", "REDACT", 0.48, "MEDIUM", [block_match], [{"category": "PERSONAL_DATA", "severity": "MEDIUM", "detector": "pii-redactor", "confidence": 0.81, "confirmed": False}], {"seeded": True}),
        ("fin_eval_001", "finance.employee@ghst.demo", "Finance", "Quarterly variance summary", "ALLOW", 0.15, "LOW", [redirect_match], [], {"seeded": True}),
        ("fin_eval_002", "finance.employee@ghst.demo", "Finance", "Payroll export analysis", "BLOCK", 0.88, "HIGH", [block_match], [{"category": "FINANCIAL_DATA", "severity": "HIGH", "detector": "finance-policy-detector", "confidence": 0.97, "confirmed": True}], {"seeded": True}),
        ("fin_eval_003", "finance.employee@ghst.demo", "Finance", "Forecast cleanup", "REDACT", 0.41, "MEDIUM", [block_match], [{"category": "FINANCIAL_DATA", "severity": "MEDIUM", "detector": "finance-policy-detector", "confidence": 0.72, "confirmed": False}], {"seeded": True}),
        ("fin_eval_004", "finance.employee@ghst.demo", "Finance", "Audit prep narrative", "ALLOW", 0.11, "LOW", [redirect_match], [], {"seeded": True}),
        ("legal_eval_001", "legal.employee@ghst.demo", "Legal", "Public case memo", "ALLOW", 0.08, "LOW", [legal_allow_match, redirect_match], [], {"seeded": True}),
        ("legal_eval_002", "legal.employee@ghst.demo", "Legal", "Privileged matter classification", "REVIEW", 0.73, "HIGH", [review_match, determination_match], [{"category": "PRIVILEGED_MATTER", "severity": "HIGH", "detector": "legal-boundary-check", "confidence": 0.76, "confirmed": False}], {"semantic_router": {"organisation_defined_class": "HIGH_IMPACT", "high_impact": True}, "seeded": True}),
        ("legal_eval_003", "legal.employee@ghst.demo", "Legal", "Contract clause cleanup", "REDACT", 0.46, "MEDIUM", [review_match], [{"category": "CLIENT_IDENTIFIER", "severity": "MEDIUM", "detector": "pii-redactor", "confidence": 0.7, "confirmed": False}], {"seeded": True}),
        ("legal_eval_004", "legal.employee@ghst.demo", "Legal", "Regulation digest", "ALLOW", 0.1, "LOW", [legal_allow_match, redirect_match], [], {"seeded": True}),
        ("hr_eval_001", "hr.employee@ghst.demo", "Human Resources", "Recruitment summary", "ALLOW", 0.14, "LOW", [redirect_match], [], {"seeded": True}),
        ("hr_eval_002", "hr.employee@ghst.demo", "Human Resources", "Termination recommendation", "REVIEW", 0.81, "HIGH", [review_match, determination_match], [{"category": "EMPLOYMENT_DECISION", "severity": "HIGH", "detector": "consequential-use-check", "confidence": 0.88, "confirmed": False}], {"semantic_router": {"organisation_defined_class": "HIGH_IMPACT", "high_impact": True}, "seeded": True}),
        ("hr_eval_003", "hr.employee@ghst.demo", "Human Resources", "Employee roster cleanup", "REDACT", 0.38, "MEDIUM", [block_match], [{"category": "PERSONAL_DATA", "severity": "MEDIUM", "detector": "pii-redactor", "confidence": 0.74, "confirmed": False}], {"seeded": True}),
        ("gov_eval_001", "policy.admin@ghst.demo", "Governance", "Policy training note", "ALLOW", 0.06, "LOW", [redirect_match], [], {"seeded": True}),
    ]

    for session_id, username, department, purpose, action, risk_score, risk_level, policy_matches, findings, model_evidence in seed_specs:
        existing = db.scalar(select(Evaluation).where(Evaluation.session_id == session_id))
        user_id = _user_id(db, username)
        if not existing:
            existing = Evaluation(
                session_id=session_id,
                user_id=user_id,
                organisation_id="org_ghst_demo",
                department=department,
                role_context="EMPLOYEE" if "employee" in username else "POLICY_ADMIN",
                purpose=purpose,
                destination_id=destination_id,
                destination_origin=destination_origin,
                prompt_hmac=hashlib.sha256(session_id.encode()).hexdigest(),
                state=action,
                action=action,
                risk_score=risk_score,
                risk_level=risk_level,
            )
            db.add(existing)
        existing.state = action
        existing.action = action
        existing.risk_score = risk_score
        existing.risk_level = risk_level
        existing.uncertainty = round(min(0.95, risk_score / 2), 3)
        existing.findings = findings
        existing.policy_matches = [match for match in policy_matches if match]
        existing.reason_codes = ["SEEDED_TELEMETRY"]
        existing.message = f"Seeded control-plane telemetry for {department}."
        existing.model_evidence = model_evidence
        existing.learning_source = "POLICY"


def _seed_reviews(db: Session) -> None:
    settings = get_settings()
    review_specs = [
        {
            "evaluation_session_id": "legal_eval_002",
            "prompt": "Assess whether this privileged client matter summary can be sent to the approved legal sandbox for drafting support.",
            "severity": "HIGH",
            "signature": ["privileged-matter", "external-release", "legal-review"],
            "created_minutes_ago": 18,
            "expires_minutes_ahead": 120,
        },
        {
            "evaluation_session_id": "legal_eval_003",
            "prompt": "Review this client contract clause cleanup request before any external redrafting assistance is used.",
            "severity": "MEDIUM",
            "signature": ["contract-cleanup", "client-identifier", "legal-review"],
            "created_minutes_ago": 7,
            "expires_minutes_ahead": 105,
        },
        {
            "evaluation_session_id": "hr_eval_002",
            "prompt": "Draft a termination recommendation for an employee using the attached performance notes and prior warnings.",
            "severity": "HIGH",
            "signature": ["employment-decision", "human-review", "hr-boundary"],
            "created_minutes_ago": 11,
            "expires_minutes_ahead": 90,
        },
        {
            "evaluation_session_id": "hr_eval_003",
            "prompt": "Check whether this employee roster cleanup request needs a safer version before using external summarisation.",
            "severity": "MEDIUM",
            "signature": ["employee-roster", "pii-review", "hr-review"],
            "created_minutes_ago": 5,
            "expires_minutes_ahead": 80,
        },
        {
            "evaluation_session_id": "fin_eval_003",
            "prompt": "Review the forecast cleanup request and confirm if it can proceed only after removing sensitive finance details.",
            "severity": "MEDIUM",
            "signature": ["forecast-cleanup", "finance-review", "sensitive-finance"],
            "created_minutes_ago": 9,
            "expires_minutes_ahead": 95,
        },
        {
            "evaluation_session_id": "fin_eval_002",
            "prompt": "Verify whether this payroll export analysis must stay blocked from any external AI processing.",
            "severity": "HIGH",
            "signature": ["payroll-export", "finance-review", "blocked-finance"],
            "created_minutes_ago": 14,
            "expires_minutes_ahead": 110,
        },
    ]
    for spec in review_specs:
        evaluation = db.scalar(select(Evaluation).where(Evaluation.session_id == spec["evaluation_session_id"]))
        if not evaluation:
            continue
        review = db.scalar(select(Review).where(Review.evaluation_id == evaluation.id))
        created_at = datetime.now(UTC) - timedelta(minutes=spec["created_minutes_ago"])
        expires_at = datetime.now(UTC) + timedelta(minutes=spec["expires_minutes_ahead"])
        payload = {
            "prompt": spec["prompt"],
            "findings": evaluation.findings,
            "policy_matches": evaluation.policy_matches,
            "model_evidence": evaluation.model_evidence,
        }
        if not review:
            review = Review(
                evaluation_id=evaluation.id,
                requested_by=evaluation.user_id,
                organisation_id=evaluation.organisation_id,
                department=evaluation.department,
                status="PENDING",
                severity=spec["severity"],
                encrypted_payload=encrypted_review_payload(payload, settings),
                semantic_signature=spec["signature"],
                expires_at=expires_at,
                created_at=created_at,
            )
            db.add(review)
        review.status = "PENDING"
        review.severity = spec["severity"]
        review.semantic_signature = spec["signature"]
        review.encrypted_payload = encrypted_review_payload(payload, settings)
        review.reviewer_id = None
        review.decision = None
        review.justification = None
        review.decided_at = None
        review.created_at = created_at
        review.expires_at = expires_at

    _seed_pending_second_review_precedent(db)


def _seed_pending_second_review_precedent(db: Session) -> None:
    review = db.scalar(select(Review).join(Evaluation, Review.evaluation_id == Evaluation.id).where(
        Evaluation.session_id == "legal_eval_002"
    ))
    evaluation = db.scalar(select(Evaluation).where(Evaluation.session_id == "legal_eval_002"))
    destination = db.scalar(select(Destination).where(Destination.organisation_id == "org_ghst_demo"))
    first_reviewer_id = _user_id(db, "legal.reviewer2@ghst.demo")
    if not review or not evaluation or not destination or not evaluation.policy_matches:
        return

    precedent = db.scalar(select(Precedent).where(Precedent.source_review_id == review.id))
    if not precedent:
        precedent = Precedent(
            source_review_id=review.id,
            organisation_id="org_ghst_demo",
            department=evaluation.department,
            scope="DEPARTMENT",
            role_context="EMPLOYEE",
            purpose=evaluation.purpose,
            data_class="PUBLIC_OR_INTERNAL_SAFE",
            impact_class="HIGH_IMPACT",
            ai_service=destination.service,
            tenant=destination.tenant,
            risk_ceiling=min(0.95, evaluation.risk_score + 0.05),
            control="ALLOW",
            policy_version_id=evaluation.policy_matches[0]["policy_version_id"],
            policy_version_ids=sorted({item["policy_version_id"] for item in evaluation.policy_matches}),
            reviewer_id=first_reviewer_id,
            justification="First reviewer confirmed the bounded legal context but second review is still required.",
            fingerprint=hashlib.sha256("|".join(review.semantic_signature).encode()).hexdigest(),
            embedding=None,
            term_hashes=review.semantic_signature,
            expires_at=datetime.now(UTC) + timedelta(days=60),
            reuse_limit=25,
            status="PENDING_SECOND_REVIEW",
        )
        db.add(precedent)
        db.flush()
    else:
        precedent.status = "PENDING_SECOND_REVIEW"
        precedent.reviewer_id = first_reviewer_id
        precedent.justification = "First reviewer confirmed the bounded legal context but second review is still required."
        precedent.policy_version_id = evaluation.policy_matches[0]["policy_version_id"]
        precedent.policy_version_ids = sorted({item["policy_version_id"] for item in evaluation.policy_matches})
        precedent.expires_at = datetime.now(UTC) + timedelta(days=60)

    artefact = db.scalar(select(LearningArtefact).where(LearningArtefact.precedent_id == precedent.id))
    if not artefact:
        artefact = LearningArtefact(
            organisation_id="org_ghst_demo",
            artefact_type="ACE_PRECEDENT",
            source_decision_ids=[review.id],
            version="1.0",
            status="PENDING",
            approved_by=first_reviewer_id,
            precedent_id=precedent.id,
            provenance={
                "department": evaluation.department,
                "reviewer_id": first_reviewer_id,
                "policy_version_id": precedent.policy_version_id,
                "model_weights_changed": False,
            },
        )
        db.add(artefact)
    else:
        artefact.status = "PENDING"
        artefact.approved_by = first_reviewer_id

    approval = db.scalar(select(PrecedentApproval).where(PrecedentApproval.precedent_id == precedent.id))
    if not approval:
        db.add(PrecedentApproval(
            precedent_id=precedent.id,
            requested_by=first_reviewer_id,
            status="PENDING",
        ))
    else:
        approval.requested_by = first_reviewer_id
        approval.approver_id = None
        approval.status = "PENDING"
        approval.justification = None
        approval.decided_at = None


def _seed_learning(db: Session) -> None:
    admin_id = _user_id(db, "policy.admin@ghst.demo")
    calibration_specs = [
        (
            "CAL-2026-016",
            "RETIRED",
            {"local_model_confidence_threshold": 0.79, "ace_similarity_threshold": 0.84},
            {"validated_reviews": 82, "projected_false_allows": -12, "hard_rules_mutable": False},
            admin_id,
        ),
        (
            "CAL-2026-017",
            "ACTIVE",
            {"local_model_confidence_threshold": 0.81, "ace_similarity_threshold": 0.86},
            {"validated_reviews": 82, "projected_false_allows": -18, "hard_rules_mutable": False},
            admin_id,
        ),
        (
            "CAL-2026-018",
            "DRAFT",
            {"local_model_confidence_threshold": 0.82, "ace_similarity_threshold": 0.88},
            {"validated_reviews": 84, "projected_false_allows": -22, "hard_rules_mutable": False},
            None,
        ),
        (
            "CAL-2026-019",
            "DRAFT",
            {"local_model_confidence_threshold": 0.83, "ace_similarity_threshold": 0.89},
            {"validated_reviews": 36, "projected_false_allows": -24, "hard_rules_mutable": False},
            None,
        ),
    ]
    for version, status, proposed_config, evidence, approver_id in calibration_specs:
        calibration = db.scalar(select(CalibrationRecommendation).where(CalibrationRecommendation.version == version))
        if not calibration:
            calibration = CalibrationRecommendation(
                organisation_id="org_ghst_demo",
                version=version,
                source_review_ids=["rev_finance_001", "rev_legal_002", "rev_ops_003"],
                created_by=admin_id,
            )
            db.add(calibration)
            db.flush()
        calibration.status = status
        calibration.proposed_config = proposed_config
        calibration.evidence = evidence
        calibration.approved_by = approver_id
        calibration.activated_at = datetime.now(UTC) if approver_id else None

    jobs = [
        (
            "Private QLoRA adapter v3.2",
            "CANDIDATE_CREATED",
            hashlib.sha256(b"training-v3.2").hexdigest(),
            {"base_model": "Qwen3.5:4B", "rank": 16},
            {"trained": True, "deidentified": True, "balanced": True},
            "models/private-qlora-v3.2",
        ),
        (
            "Private QLoRA adapter v3.3",
            "COMPLETED",
            hashlib.sha256(b"training-v3.3").hexdigest(),
            {"base_model": "Qwen3.5:4B", "rank": 32},
            {"trained": True, "deidentified": True, "balanced": True, "adversarial_eval_ready": True},
            "models/private-qlora-v3.3",
        ),
        (
            "Finance retrieval adapter v1.4",
            "COMPLETED",
            hashlib.sha256(b"training-finance-v1.4").hexdigest(),
            {"base_model": "Qwen3.5:4B", "rank": 8},
            {"trained": True, "deidentified": True, "balanced": True, "held_out_digest": "fin-248"},
            "models/finance-retrieval-v1.4",
        ),
    ]
    for model_name, status, digest, config, report, output_path in jobs:
        job = db.scalar(select(ModelTrainingJob).where(ModelTrainingJob.model_name == model_name))
        if not job:
            job = ModelTrainingJob(
                organisation_id="org_ghst_demo",
                model_name=model_name,
                backend="QLORA",
                dataset_digest=digest,
                requested_by=admin_id,
            )
            db.add(job)
            db.flush()
        job.status = status
        job.config = config
        job.report = report
        job.output_path = output_path


def _user_id(db: Session, username: str) -> str:
    user = db.scalar(select(User).where(User.username == username))
    return user.id if user else username


def _policy_match(db: Session, policy_name: str, clause_ref: str) -> dict | None:
    row = db.execute(
        select(Policy, PolicyVersion, PolicyClause)
        .join(PolicyVersion, PolicyVersion.policy_id == Policy.id)
        .join(PolicyClause, PolicyClause.policy_version_id == PolicyVersion.id)
        .where(Policy.organisation_id == "org_ghst_demo", Policy.name == policy_name, PolicyClause.clause_ref == clause_ref)
    ).first()
    if not row:
        return None
    policy, version, clause = row
    return {
        "clause_id": clause.id,
        "policy": policy.name,
        "policy_version_id": version.id,
        "policy_version": version.version,
        "clause": clause.clause_ref,
        "scope": clause.department,
        "action": clause.action,
        "score": 0.92,
        "text": clause.text,
        "page_number": clause.page_number,
    }


if __name__ == "__main__":
    seed_database()
    print("GHST database seeded with synthetic demonstration data.")
