import hashlib
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.core.config import Settings, get_settings
from app.db.models import Evaluation, Policy, PolicyClause, PolicyVersion, Precedent, User
from app.db.session import get_db
from app.schemas.policy import (
    ClauseMergeRequest,
    ClauseMutation,
    ClauseOut,
    PolicyCreateRequest,
    ClauseSplitRequest,
    PolicyActivationResponse,
    PolicyLookupResponse,
    PolicyOut,
    PolicySimulationResponse,
    PolicyVersionCreate,
    PolicyUploadResponse,
)
from app.services.audit import append_audit
from app.services.embeddings import vector_literal
from app.services.policy import (
    STRICTNESS,
    clause_summary,
    policy_set_digest,
    strictest_action,
    version_summary,
    version_verification_summary,
)
from app.services.policy_ingest import ingest_policy_file, segment_clauses
from app.services.policy_storage import PolicyStorageError, policy_storage_adapter

router = APIRouter(prefix="/policies", tags=["Policy Lifecycle"])


@router.get("/lookups", response_model=PolicyLookupResponse)
def policy_lookups(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
    settings: Settings = Depends(get_settings),
):
    policies = list(db.scalars(select(Policy).where(Policy.organisation_id == user.organisation_id)))
    users = list(db.scalars(select(User).where(User.organisation_id == user.organisation_id)))
    clauses = list(db.scalars(select(PolicyClause).join(PolicyVersion).join(Policy).where(Policy.organisation_id == user.organisation_id)))
    departments = sorted({item.department for item in clauses if item.department and item.department != "ALL"} | {member.department for member in users})
    roles = sorted({role for item in clauses for role in item.roles} | {role for member in users for role in member.roles})
    purposes = sorted({purpose for item in clauses for purpose in item.purposes} | {"General productivity", "Legal research", "Routine drafting", "Financial analysis", "Software troubleshooting"})
    data_classes = sorted({value for item in clauses for value in item.data_classes} | {"PERSONAL_DATA", "FINANCIAL_DATA", "CONFIDENTIAL_BUSINESS_IP", "REGULATED_RECORDS", "PUBLIC_OR_INTERNAL_SAFE"})
    destinations = sorted({value for item in clauses for value in item.destinations})
    return PolicyLookupResponse(
        departments=departments,
        roles=roles,
        purposes=purposes,
        data_classes=data_classes,
        destinations=destinations,
        actions=["ALLOW", "REDACT", "REDIRECT", "REVIEW", "BLOCK"],
        storage_adapters=[
            {"value": "LOCAL_DEMO", "label": settings.policy_demo_adapter_label},
            {"value": "SUPABASE", "label": "Supabase private storage"},
        ],
    )


@router.get("", response_model=list[PolicyOut])
def list_policies(
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
):
    policies = list(
        db.scalars(
            select(Policy)
            .options(selectinload(Policy.versions).selectinload(PolicyVersion.clauses))
            .where(Policy.organisation_id == user.organisation_id)
        )
    )
    return [_policy_payload(policy) for policy in policies]


@router.get("/{policy_id}", response_model=PolicyOut)
def get_policy(
    policy_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
):
    policy = db.scalar(
        select(Policy)
        .options(selectinload(Policy.versions).selectinload(PolicyVersion.clauses))
        .where(Policy.id == policy_id, Policy.organisation_id == user.organisation_id)
    )
    if not policy:
        raise HTTPException(status_code=404, detail="Policy was not found.")
    return _policy_payload(policy)


@router.post("", response_model=PolicyOut)
def create_policy(
    body: PolicyCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    existing = db.scalar(
        select(Policy).where(
            Policy.organisation_id == user.organisation_id,
            Policy.name == body.name,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="A policy with that name already exists.")
    policy = Policy(
        organisation_id=user.organisation_id,
        name=body.name,
        category=body.category,
        owner=body.owner,
        scope=body.scope,
        status="HUMAN_REVIEW" if body.clauses else "DRAFT",
        description=body.description,
        created_by=user.id,
        updated_at=datetime.now(UTC),
    )
    db.add(policy)
    db.flush()
    _create_version_record(db, user, policy, PolicyVersionCreate(version=body.version, clauses=body.clauses))
    db.commit()
    db.refresh(policy)
    policy = db.scalar(
        select(Policy)
        .options(selectinload(Policy.versions).selectinload(PolicyVersion.clauses))
        .where(Policy.id == policy.id, Policy.organisation_id == user.organisation_id)
    )
    return _policy_payload(policy)


@router.post("/uploads", response_model=PolicyUploadResponse)
async def upload_policy(
    file: UploadFile = File(...),
    name: str = Form(...),
    version: str = Form(...),
    category: str = Form(...),
    owner: str = Form(...),
    scope: str = Form(default="ORGANISATION"),
    description: str = Form(default=""),
    policy_id: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
    settings: Settings = Depends(get_settings),
):
    content = await file.read()
    try:
        document = ingest_policy_file(filename=file.filename or "policy-upload", content_type=file.content_type or "", content=content, settings=settings)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    storage = policy_storage_adapter(settings)
    if policy_id:
        policy = db.get(Policy, policy_id)
        if not policy or policy.organisation_id != user.organisation_id:
            raise HTTPException(status_code=404, detail="Policy was not found.")
    else:
        policy = Policy(
            organisation_id=user.organisation_id,
            name=name,
            category=category,
            owner=owner,
            scope=scope,
            status="UPLOADED",
            description=description or None,
            created_by=user.id,
            updated_at=datetime.now(UTC),
        )
        db.add(policy)
        db.flush()
    version_row = PolicyVersion(
        policy_id=policy.id,
        version=version,
        content_hash=hashlib.sha256(document.text.encode()).hexdigest(),
        approved_by=user.id,
        status="UPLOADED",
        source_filename=document.filename,
        storage_adapter=settings.policy_storage_adapter,
        mime_type=document.mime_type,
        size_bytes=document.size_bytes,
        sha256=document.sha256,
        source_kind="UPLOADED_FILE",
        extraction_metadata={},
        malware_scan={},
        verification_summary={},
        uploaded_by=user.id,
        updated_at=datetime.now(UTC),
    )
    db.add(version_row)
    db.flush()
    append_audit(
        db,
        event_type="POLICY_UPLOAD_RECEIVED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="POLICY_VERSION",
        entity_id=version_row.id,
        payload={"policy_id": policy.id, "filename": document.filename, "sha256": document.sha256, "size_bytes": document.size_bytes},
    )
    version_row.status = "SCANNING"
    version_row.malware_scan = document.malware_scan
    append_audit(
        db,
        event_type="POLICY_SCAN_COMPLETED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="POLICY_VERSION",
        entity_id=version_row.id,
        payload=document.malware_scan,
    )
    version_row.status = "EXTRACTING"
    append_audit(
        db,
        event_type="POLICY_EXTRACTION_STARTED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="POLICY_VERSION",
        entity_id=version_row.id,
        payload={"mime_type": document.mime_type},
    )
    try:
        stored = storage.store(
            organisation_id=user.organisation_id,
            version_id=version_row.id,
            filename=document.filename,
            content=content,
            content_type=document.mime_type,
        )
    except PolicyStorageError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    suggestions = segment_clauses(document, settings)
    version_row.storage_adapter = stored.adapter
    version_row.storage_key = stored.key
    version_row.extraction_metadata = {**document.extraction_metadata, "page_count": len(document.pages), "storage_label": getattr(storage, "label", stored.adapter)}
    version_row.status = "HUMAN_REVIEW"
    version_row.verification_summary = {"total": len(suggestions), "verified": 0, "draft": len(suggestions), "deleted": 0, "ready_for_activation": False}
    policy.status = "HUMAN_REVIEW"
    for suggestion in suggestions:
        clause = PolicyClause(
            policy_version_id=version_row.id,
            department=suggestion.suggested_department,
            roles=suggestion.suggested_roles,
            purposes=suggestion.suggested_purposes,
            data_classes=suggestion.suggested_data_classes,
            destinations=suggestion.suggested_destinations,
            clause_ref=suggestion.clause_ref,
            heading=suggestion.heading,
            page_number=suggestion.page_number,
            source_order=suggestion.source_order,
            text=suggestion.text,
            action=suggestion.suggested_action,
            verification_status="DRAFT",
            suggested_metadata={
                "department": suggestion.suggested_department,
                "roles": suggestion.suggested_roles,
                "purposes": suggestion.suggested_purposes,
                "data_classes": suggestion.suggested_data_classes,
                "destinations": suggestion.suggested_destinations,
                "action": suggestion.suggested_action,
            },
            metadata_json={"segmented_from_upload": True},
            embedding=suggestion.embedding,
        )
        db.add(clause)
        db.flush()
        _sync_pgvector(db, clause.id, suggestion.embedding)
    append_audit(
        db,
        event_type="POLICY_EXTRACTION_COMPLETED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="POLICY_VERSION",
        entity_id=version_row.id,
        payload={"clause_count": len(suggestions), "status": version_row.status},
    )
    db.commit()
    return PolicyUploadResponse(
        policy_id=policy.id,
        version_id=version_row.id,
        status="HUMAN_REVIEW",
        storage_adapter=stored.adapter,
        storage_label=getattr(storage, "label", stored.adapter),
        clause_count=len(suggestions),
    )


@router.post("/{policy_id}/versions")
def create_policy_version(
    policy_id: str,
    body: PolicyVersionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    policy = db.get(Policy, policy_id)
    if not policy or policy.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Policy was not found.")
    if db.scalar(select(PolicyVersion).where(PolicyVersion.policy_id == policy.id, PolicyVersion.version == body.version)):
        raise HTTPException(status_code=409, detail="That policy version already exists.")
    version = _create_version_record(db, user, policy, body)
    db.commit()
    return {"policy_id": policy.id, "version_id": version.id, "version": version.version, "status": version.status}


@router.get("/versions/{version_id}/source")
def download_policy_source(
    version_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN")),
    settings: Settings = Depends(get_settings),
):
    version = db.scalar(select(PolicyVersion).join(Policy).where(PolicyVersion.id == version_id, Policy.organisation_id == user.organisation_id))
    if not version or not version.storage_key:
        raise HTTPException(status_code=404, detail="Policy source file was not found.")
    storage = policy_storage_adapter(settings)
    try:
        body, content_type = storage.read(key=version.storage_key)
    except PolicyStorageError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    append_audit(
        db,
        event_type="POLICY_SOURCE_ACCESSED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="POLICY_VERSION",
        entity_id=version.id,
        payload={"filename": version.source_filename},
    )
    db.commit()
    filename = version.source_filename or f"{version.version}.bin"
    return Response(content=body, media_type=content_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/versions/{version_id}/clauses", response_model=ClauseOut)
def add_clause(
    version_id: str,
    body: ClauseMutation,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    version = db.scalar(select(PolicyVersion).join(Policy).where(PolicyVersion.id == version_id, Policy.organisation_id == user.organisation_id))
    if not version:
        raise HTTPException(status_code=404, detail="Policy version was not found.")
    clause = PolicyClause(
        policy_version_id=version.id,
        department=body.department,
        roles=body.roles,
        purposes=body.purposes,
        data_classes=body.data_classes,
        destinations=body.destinations,
        clause_ref=body.clause_ref,
        heading=body.heading,
        page_number=body.page_number,
        source_order=_next_source_order(version),
        text=body.text,
        action=body.action,
        verification_status=body.verification_status,
        human_notes=body.human_notes,
        suggested_metadata={},
        metadata_json={"manually_added": True},
        embedding=[],
        verified_by=user.id if body.verification_status == "VERIFIED" else None,
        verified_at=datetime.now(UTC) if body.verification_status == "VERIFIED" else None,
        updated_at=datetime.now(UTC),
    )
    clause.embedding = _embedding_for_clause(clause)
    db.add(clause)
    db.flush()
    _sync_pgvector(db, clause.id, clause.embedding or [])
    _touch_version(db, version, user, event_type="POLICY_CLAUSE_ADDED", payload={"clause_id": clause.id, "version_id": version.id})
    db.commit()
    return ClauseOut(**clause_summary(clause))


@router.patch("/clauses/{clause_id}", response_model=ClauseOut)
def update_clause(
    clause_id: str,
    body: ClauseMutation,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    clause = db.scalar(select(PolicyClause).join(PolicyVersion).join(Policy).where(PolicyClause.id == clause_id, Policy.organisation_id == user.organisation_id))
    if not clause:
        raise HTTPException(status_code=404, detail="Policy clause was not found.")
    clause.department = body.department
    clause.roles = body.roles
    clause.purposes = body.purposes
    clause.data_classes = body.data_classes
    clause.destinations = body.destinations
    clause.clause_ref = body.clause_ref
    clause.heading = body.heading
    clause.page_number = body.page_number
    clause.text = body.text
    clause.action = body.action
    clause.verification_status = body.verification_status
    clause.human_notes = body.human_notes
    clause.updated_at = datetime.now(UTC)
    clause.embedding = _embedding_for_clause(clause)
    if clause.verification_status == "VERIFIED":
        clause.verified_by = user.id
        clause.verified_at = datetime.now(UTC)
    _sync_pgvector(db, clause.id, clause.embedding or [])
    _touch_version(db, clause.version, user, event_type="POLICY_CLAUSE_EDITED", payload={"clause_id": clause.id, "version_id": clause.version.id})
    db.commit()
    return ClauseOut(**clause_summary(clause))


@router.delete("/clauses/{clause_id}")
def delete_clause(
    clause_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    clause = db.scalar(select(PolicyClause).join(PolicyVersion).join(Policy).where(PolicyClause.id == clause_id, Policy.organisation_id == user.organisation_id))
    if not clause:
        raise HTTPException(status_code=404, detail="Policy clause was not found.")
    clause.verification_status = "DELETED"
    clause.updated_at = datetime.now(UTC)
    _touch_version(db, clause.version, user, event_type="POLICY_CLAUSE_DELETED", payload={"clause_id": clause.id, "version_id": clause.version.id})
    db.commit()
    return {"status": "DELETED", "clause_id": clause.id}


@router.post("/clauses/{clause_id}/split", response_model=list[ClauseOut])
def split_clause(
    clause_id: str,
    body: ClauseSplitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    clause = db.scalar(select(PolicyClause).join(PolicyVersion).join(Policy).where(PolicyClause.id == clause_id, Policy.organisation_id == user.organisation_id))
    if not clause:
        raise HTTPException(status_code=404, detail="Policy clause was not found.")
    clause.verification_status = "DELETED"
    clause.updated_at = datetime.now(UTC)
    created: list[PolicyClause] = []
    for part in body.parts:
        child = PolicyClause(
            policy_version_id=clause.policy_version_id,
            department=part.department,
            roles=part.roles,
            purposes=part.purposes,
            data_classes=part.data_classes,
            destinations=part.destinations,
            clause_ref=part.clause_ref,
            heading=part.heading or clause.heading,
            page_number=part.page_number,
            source_order=_next_source_order(clause.version),
            text=part.text,
            action=part.action,
            verification_status=part.verification_status,
            human_notes=part.human_notes,
            parent_clause_id=clause.id,
            suggested_metadata={},
            metadata_json={"split_from": clause.id},
            embedding=[],
            verified_by=user.id if part.verification_status == "VERIFIED" else None,
            verified_at=datetime.now(UTC) if part.verification_status == "VERIFIED" else None,
        )
        child.embedding = _embedding_for_clause(child)
        db.add(child)
        db.flush()
        _sync_pgvector(db, child.id, child.embedding or [])
        created.append(child)
    _touch_version(db, clause.version, user, event_type="POLICY_CLAUSE_SPLIT", payload={"clause_id": clause.id, "created_ids": [item.id for item in created]})
    db.commit()
    return [ClauseOut(**clause_summary(item)) for item in created]


@router.post("/clauses/merge", response_model=ClauseOut)
def merge_clauses(
    body: ClauseMergeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    clauses = list(
        db.scalars(
            select(PolicyClause).join(PolicyVersion).join(Policy).where(
                PolicyClause.id.in_(body.clause_ids),
                Policy.organisation_id == user.organisation_id,
            )
        )
    )
    if len(clauses) != len(body.clause_ids):
        raise HTTPException(status_code=404, detail="One or more policy clauses were not found.")
    version_ids = {clause.policy_version_id for clause in clauses}
    if len(version_ids) != 1:
        raise HTTPException(status_code=409, detail="Only clauses from the same policy version may be merged.")
    version = clauses[0].version
    for clause in clauses:
        clause.verification_status = "DELETED"
        clause.updated_at = datetime.now(UTC)
    merged = PolicyClause(
        policy_version_id=version.id,
        department=body.merged.department,
        roles=body.merged.roles,
        purposes=body.merged.purposes,
        data_classes=body.merged.data_classes,
        destinations=body.merged.destinations,
        clause_ref=body.merged.clause_ref,
        heading=body.merged.heading,
        page_number=body.merged.page_number,
        source_order=_next_source_order(version),
        text=body.merged.text,
        action=body.merged.action,
        verification_status=body.merged.verification_status,
        human_notes=body.merged.human_notes,
        suggested_metadata={},
        metadata_json={"merged_from": body.clause_ids},
        embedding=[],
        verified_by=user.id if body.merged.verification_status == "VERIFIED" else None,
        verified_at=datetime.now(UTC) if body.merged.verification_status == "VERIFIED" else None,
    )
    merged.embedding = _embedding_for_clause(merged)
    db.add(merged)
    db.flush()
    _sync_pgvector(db, merged.id, merged.embedding or [])
    _touch_version(db, version, user, event_type="POLICY_CLAUSE_MERGED", payload={"merged_id": merged.id, "clause_ids": body.clause_ids})
    db.commit()
    return ClauseOut(**clause_summary(merged))


@router.post("/versions/{version_id}/simulate", response_model=PolicySimulationResponse)
def simulate_policy_activation_by_id(
    version_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    version = db.scalar(select(PolicyVersion).options(selectinload(PolicyVersion.clauses).selectinload(PolicyClause.version)).join(Policy).where(PolicyVersion.id == version_id, Policy.organisation_id == user.organisation_id))
    if not version:
        raise HTTPException(status_code=404, detail="Policy version was not found.")
    return _simulate_version(db, user, version)


@router.post("/{policy_id}/versions/{version_name}/simulate", response_model=PolicySimulationResponse)
def simulate_policy_activation(
    policy_id: str,
    version_name: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    version = _version_by_policy_and_name(db, user, policy_id, version_name)
    return _simulate_version(db, user, version)


@router.post("/versions/{version_id}/activate", response_model=PolicyActivationResponse)
def activate_policy_by_id(
    version_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    version = db.scalar(select(PolicyVersion).options(selectinload(PolicyVersion.clauses)).join(Policy).where(PolicyVersion.id == version_id, Policy.organisation_id == user.organisation_id))
    if not version:
        raise HTTPException(status_code=404, detail="Policy version was not found.")
    return _activate_version(db, user, version)


@router.post("/{policy_id}/versions/{version_name}/activate", response_model=PolicyActivationResponse)
def activate_policy(
    policy_id: str,
    version_name: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("POLICY_ADMIN", "SYSTEM_ADMIN")),
):
    version = _version_by_policy_and_name(db, user, policy_id, version_name)
    return _activate_version(db, user, version)


def _policy_payload(policy: Policy) -> PolicyOut:
    versions = sorted(policy.versions, key=lambda item: (item.activated_at or item.effective_at, item.created_at), reverse=True)
    return PolicyOut(
        id=policy.id,
        name=policy.name,
        category=policy.category,
        owner=policy.owner,
        scope=policy.scope,
        status=policy.status,
        description=policy.description,
        versions=[version_summary(version) for version in versions],
    )


def _create_version_record(db: Session, user: User, policy: Policy, body: PolicyVersionCreate) -> PolicyVersion:
    version = PolicyVersion(
        policy_id=policy.id,
        version=body.version,
        content_hash=hashlib.sha256("\n".join(item.text for item in body.clauses).encode()).hexdigest(),
        approved_by=user.id,
        status="HUMAN_REVIEW" if body.clauses else "DRAFT",
        source_kind="MANUAL_DRAFT",
        storage_adapter="LOCAL_DEMO",
        extraction_metadata={"source_type": "MANUAL_DRAFT"},
        malware_scan={"status": "SKIPPED_LOCAL_DEMO", "adapter": "manual-version"},
        verification_summary={"total": len(body.clauses), "verified": 0, "draft": len(body.clauses), "deleted": 0, "ready_for_activation": False},
        uploaded_by=user.id,
        updated_at=datetime.now(UTC),
    )
    db.add(version)
    db.flush()
    for index, item in enumerate(body.clauses, start=1):
        clause = PolicyClause(
            policy_version_id=version.id,
            department=item.department,
            roles=item.roles,
            purposes=item.purposes,
            data_classes=getattr(item, "data_classes", []),
            destinations=getattr(item, "destinations", []),
            clause_ref=item.clause_ref,
            heading=item.heading,
            page_number=item.page_number,
            source_order=index,
            text=item.text,
            action=item.action,
            verification_status=getattr(item, "verification_status", "DRAFT"),
            human_notes=getattr(item, "human_notes", None),
            suggested_metadata={"manual": True},
            metadata_json={"manual_version": True},
            embedding=[],
            verified_by=user.id if getattr(item, "verification_status", "DRAFT") == "VERIFIED" else None,
            verified_at=datetime.now(UTC) if getattr(item, "verification_status", "DRAFT") == "VERIFIED" else None,
        )
        clause.embedding = _embedding_for_clause(clause)
        db.add(clause)
        db.flush()
        _sync_pgvector(db, clause.id, clause.embedding or [])
    policy.status = "HUMAN_REVIEW"
    append_audit(
        db,
        event_type="POLICY_VERSION_DRAFT_CREATED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="POLICY_VERSION",
        entity_id=version.id,
        payload={"policy_id": policy.id, "version": version.version, "clause_count": len(body.clauses)},
    )
    return version


def _version_by_policy_and_name(db: Session, user: User, policy_id: str, version_name: str) -> PolicyVersion:
    version = db.scalar(
        select(PolicyVersion)
        .options(selectinload(PolicyVersion.clauses))
        .join(Policy)
        .where(
            PolicyVersion.policy_id == policy_id,
            PolicyVersion.version == version_name,
            Policy.organisation_id == user.organisation_id,
        )
    )
    if not version:
        raise HTTPException(status_code=404, detail="Policy version was not found.")
    return version


def _simulate_version(db: Session, user: User, version: PolicyVersion) -> PolicySimulationResponse:
    clauses = [clause for clause in version.clauses if clause.verification_status == "VERIFIED"]
    if not clauses:
        raise HTTPException(status_code=409, detail="A policy version must contain at least one verified clause before simulation.")
    replaced_version_ids = set(
        db.scalars(
            select(PolicyVersion.id).where(
                PolicyVersion.policy_id == version.policy_id,
                PolicyVersion.status == "ACTIVE",
            )
        )
    )
    evaluations = list(db.scalars(select(Evaluation).where(Evaluation.organisation_id == user.organisation_id)))
    changes = []
    projected_action_counts: dict[str, int] = {}
    for evaluation in evaluations:
        surviving = [
            match["action"]
            for match in evaluation.policy_matches
            if match.get("policy_version_id") not in replaced_version_ids and match.get("action") in STRICTNESS
        ]
        candidate_actions = [clause.action for clause in clauses if _clause_applies(clause, evaluation)]
        proposed = _hard_security_floor(evaluation, strictest_action(surviving + candidate_actions, default="BLOCK"))
        projected_action_counts[proposed] = projected_action_counts.get(proposed, 0) + 1
        if proposed != evaluation.action:
            changes.append(
                {
                    "evaluation_id": evaluation.id,
                    "department": evaluation.department,
                    "purpose": evaluation.purpose,
                    "current_action": evaluation.action,
                    "proposed_action": proposed,
                    "reason": "Candidate verified clauses plus immutable security floors.",
                }
            )
    affected = [
        item
        for item in db.scalars(
            select(Precedent).where(
                Precedent.organisation_id == user.organisation_id,
                Precedent.status.in_(["ACTIVE", "PENDING_SECOND_REVIEW"]),
            )
        )
        if item.policy_version_id in replaced_version_ids or replaced_version_ids.intersection(item.policy_version_ids or [])
    ]
    version.status = "SIMULATION"
    version.simulated_at = datetime.now(UTC)
    version.verification_summary = version_verification_summary(version.clauses)
    append_audit(
        db,
        event_type="POLICY_ACTIVATION_SIMULATED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="POLICY_VERSION",
        entity_id=version.id,
        payload={
            "evaluations_examined": len(evaluations),
            "changed_action_count": len(changes),
            "affected_precedent_count": len(affected),
        },
    )
    db.commit()
    return PolicySimulationResponse(
        policy_id=version.policy_id,
        candidate_version_id=version.id,
        candidate_version=version.version,
        evaluations_examined=len(evaluations),
        changed_action_count=len(changes),
        changed_actions=changes[:100],
        projected_action_counts=projected_action_counts,
        affected_precedents=[{"id": item.id, "department": item.department, "scope": item.scope, "status": item.status} for item in affected],
        activation_allowed=True,
        warning="Simulation uses retained evaluation metadata and verified clause filters; raw prompts remain unavailable by design.",
    )


def _activate_version(db: Session, user: User, version: PolicyVersion) -> PolicyActivationResponse:
    summary = version_verification_summary(version.clauses)
    if not summary["ready_for_activation"]:
        raise HTTPException(status_code=409, detail="All non-deleted clauses must be explicitly verified before activation.")
    policy = version.policy
    old_versions = list(
        db.scalars(
            select(PolicyVersion).where(
                PolicyVersion.policy_id == policy.id,
                PolicyVersion.status == "ACTIVE",
            )
        )
    )
    invalidated = 0
    for old in old_versions:
        old.status = "RETIRED"
        old.retired_at = datetime.now(UTC)
        precedents = [
            item
            for item in db.scalars(
                select(Precedent).where(
                    Precedent.organisation_id == user.organisation_id,
                    Precedent.status.in_(["ACTIVE", "PENDING_SECOND_REVIEW"]),
                )
            )
            if old.id == item.policy_version_id or old.id in (item.policy_version_ids or [])
        ]
        for precedent in precedents:
            precedent.status = "INVALIDATED_BY_POLICY"
            invalidated += 1
    version.status = "ACTIVE"
    version.effective_at = datetime.now(UTC)
    version.activated_at = datetime.now(UTC)
    version.activated_by = user.id
    version.verification_summary = summary
    policy.status = "ACTIVE"
    policy.updated_at = datetime.now(UTC)
    append_audit(
        db,
        event_type="POLICY_VERSION_ACTIVATED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="POLICY_VERSION",
        entity_id=version.id,
        payload={"policy_id": policy.id, "version": version.version, "invalidated_precedents": invalidated},
    )
    db.commit()
    return PolicyActivationResponse(status="ACTIVE", version_id=version.id, invalidated_precedents=invalidated)


def _clause_applies(clause: PolicyClause, evaluation: Evaluation) -> bool:
    return (
        clause.verification_status == "VERIFIED"
        and clause.department in {"ALL", evaluation.department}
        and (not clause.roles or evaluation.role_context in clause.roles)
        and (not clause.purposes or evaluation.purpose in clause.purposes)
    )


def _hard_security_floor(evaluation: Evaluation, proposed: str) -> str:
    confirmed = [finding for finding in evaluation.findings if finding.get("confirmed")]
    if any(item.get("category") == "AUTHENTICATION_SECRETS" for item in evaluation.findings):
        return "BLOCK"
    if any(item.get("category") in {"CONFIDENTIAL_BUSINESS_IP", "REGULATED_RECORDS"} for item in confirmed):
        return "BLOCK"
    if confirmed and STRICTNESS.get(proposed, 0) < STRICTNESS["REDACT"]:
        return "REDACT"
    return proposed


def _touch_version(db: Session, version: PolicyVersion, user: User, *, event_type: str, payload: dict) -> None:
    version.updated_at = datetime.now(UTC)
    version.status = "HUMAN_REVIEW"
    version.verification_summary = version_verification_summary(version.clauses)
    version.policy.status = "HUMAN_REVIEW"
    version.policy.updated_at = datetime.now(UTC)
    append_audit(
        db,
        event_type=event_type,
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="POLICY_VERSION",
        entity_id=version.id,
        payload=payload,
    )


def _embedding_for_clause(clause: PolicyClause) -> list[float]:
    from app.services.embeddings import local_embedding

    return local_embedding(f"{clause.clause_ref} {clause.heading or ''} {clause.text}")


def _next_source_order(version: PolicyVersion) -> int:
    if not version.clauses:
        return 1
    return max(clause.source_order for clause in version.clauses) + 1


def _sync_pgvector(db: Session, clause_id: str, embedding: list[float]) -> None:
    if db.bind is None or db.bind.dialect.name != "postgresql":
        return
    inspector = inspect(db.bind)
    try:
        columns = {column["name"] for column in inspector.get_columns("policy_clauses")}
    except Exception:
        return
    if "embedding_vector" not in columns:
        return
    db.execute(
        text("update policy_clauses set embedding_vector = cast(:vector as vector) where id = :clause_id"),
        {"vector": vector_literal(embedding), "clause_id": clause_id},
    )
