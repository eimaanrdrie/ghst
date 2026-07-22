import re
from collections import Counter

from sqlalchemy import inspect, or_, select, text
from sqlalchemy.orm import Session

from app.db.models import Policy, PolicyClause, PolicyVersion
from app.services.embeddings import cosine_similarity, local_embedding, vector_literal

STRICTNESS = {"ALLOW": 1, "REDACT": 2, "REDIRECT": 3, "REVIEW": 4, "BLOCK": 5}


def retrieve_policies(
    db: Session,
    organisation_id: str,
    department: str,
    roles: list[str],
    purpose: str,
    text_value: str,
    *,
    data_class: str,
    destination_origin: str,
    destination_service: str | None = None,
) -> list[dict]:
    query = f"{purpose} {text_value[:4000]}".strip()
    filters = {
        "organisation_id": organisation_id,
        "department": department,
        "roles": roles,
        "purpose": purpose,
        "data_class": data_class,
        "destination_origin": destination_origin,
        "destination_service": destination_service,
        "destination_approved": destination_origin.rstrip("/") in {"http://localhost:3000/ai-sandbox", "https://chatgpt.com", "https://chat.openai.com"},
    }
    ranked = _rank_with_pgvector(db, query, filters)
    if ranked is None:
        ranked = _rank_with_fallback(db, query, filters)
    return _prune_irrelevant_restrictive_matches(ranked)[:8]


def fallback_review_policy_match(
    db: Session,
    organisation_id: str,
    department: str,
) -> dict | None:
    row = db.execute(
        select(PolicyClause, PolicyVersion, Policy)
        .join(PolicyVersion, PolicyClause.policy_version_id == PolicyVersion.id)
        .join(Policy, PolicyVersion.policy_id == Policy.id)
        .where(
            Policy.organisation_id == organisation_id,
            Policy.category == "HUMAN_REVIEW",
            Policy.status == "ACTIVE",
            PolicyVersion.status == "ACTIVE",
            PolicyClause.verification_status == "VERIFIED",
            PolicyClause.action == "REVIEW",
            or_(PolicyClause.department == "ALL", PolicyClause.department == department),
        )
        .order_by(PolicyClause.page_number.asc(), PolicyClause.source_order.asc())
    ).first()
    if not row:
        return None
    clause, version, policy = row
    return _match_payload(clause, version, policy, 0.35)


def active_policy_version(policy_matches: list[dict]) -> str:
    versions = active_policy_versions(policy_matches)
    return versions[0] if versions else "NO_ACTIVE_POLICY"


def active_policy_versions(policy_matches: list[dict]) -> list[str]:
    return sorted({item["policy_version_id"] for item in policy_matches if item.get("policy_version_id")})


def strictest_action(actions: list[str], default: str = "BLOCK") -> str:
    applicable = [action for action in actions if action in STRICTNESS]
    return max(applicable, key=lambda item: STRICTNESS[item]) if applicable else default


def policy_set_digest(policy_matches: list[dict]) -> str:
    return "|".join(active_policy_versions(policy_matches))


def version_summary(version: PolicyVersion) -> dict:
    return {
        "id": version.id,
        "version": version.version,
        "status": version.status,
        "source_filename": version.source_filename,
        "storage_adapter": version.storage_adapter,
        "mime_type": version.mime_type,
        "size_bytes": version.size_bytes,
        "sha256": version.sha256,
        "source_kind": version.source_kind,
        "extraction_metadata": version.extraction_metadata,
        "malware_scan": version.malware_scan,
        "verification_summary": version.verification_summary,
        "extraction_error": version.extraction_error,
        "effective_at": version.effective_at,
        "clauses": [clause_summary(clause) for clause in sorted(version.clauses, key=lambda item: (item.page_number, item.source_order, item.clause_ref))],
    }


def clause_summary(clause: PolicyClause) -> dict:
    return {
        "id": clause.id,
        "clause_ref": clause.clause_ref,
        "text": clause.text,
        "department": clause.department,
        "roles": clause.roles,
        "purposes": clause.purposes,
        "data_classes": clause.data_classes,
        "destinations": clause.destinations,
        "action": clause.action,
        "page_number": clause.page_number,
        "heading": clause.heading,
        "verification_status": clause.verification_status,
        "human_notes": clause.human_notes,
        "source_order": clause.source_order,
        "suggested_metadata": clause.suggested_metadata,
        "metadata_json": clause.metadata_json,
        "verified_by": clause.verified_by,
        "verified_at": clause.verified_at,
    }


def version_verification_summary(clauses: list[PolicyClause]) -> dict:
    counts = Counter(clause.verification_status for clause in clauses)
    return {
        "total": len(clauses),
        "verified": counts.get("VERIFIED", 0),
        "draft": counts.get("DRAFT", 0) + counts.get("SUGGESTED", 0),
        "deleted": counts.get("DELETED", 0),
        "ready_for_activation": len(clauses) > 0 and counts.get("VERIFIED", 0) == len([clause for clause in clauses if clause.verification_status != "DELETED"]),
    }


def _rank_with_fallback(db: Session, query: str, filters: dict) -> list[dict]:
    rows = db.execute(_base_statement(filters["organisation_id"], filters["department"])).all()
    query_embedding = local_embedding(query)
    ranked: list[dict] = []
    for clause, version, policy in rows:
        if not _clause_matches_filters(clause, filters):
            continue
        lexical = _jaccard(_tokens(query), _tokens(clause.text))
        semantic = cosine_similarity(query_embedding, clause.embedding or local_embedding(clause.text))
        metadata_bonus = 0.15 if clause.department == filters["department"] else 0.05
        score = min(1.0, 0.4 * lexical + 0.45 * semantic + metadata_bonus)
        ranked.append(_match_payload(clause, version, policy, round(score, 4)))
    return sorted(ranked, key=lambda item: (item["score"], STRICTNESS.get(item["action"], 0)), reverse=True)


def _rank_with_pgvector(db: Session, query: str, filters: dict) -> list[dict] | None:
    if db.bind is None or db.bind.dialect.name != "postgresql":
        return None
    inspector = inspect(db.bind)
    try:
        columns = {column["name"] for column in inspector.get_columns("policy_clauses")}
    except Exception:
        return None
    if "embedding_vector" not in columns:
        return None
    vector = vector_literal(local_embedding(query))
    sql = text(
        """
        select
          pc.id as clause_id,
          pv.id as policy_version_id,
          pv.version as policy_version,
          p.name as policy_name,
          pc.clause_ref,
          pc.department,
          pc.action,
          pc.text,
          pc.page_number,
          pc.heading,
          1 - (pc.embedding_vector <=> cast(:query_vector as vector)) as semantic_score
        from policy_clauses pc
        join policy_versions pv on pc.policy_version_id = pv.id
        join policies p on pv.policy_id = p.id
        where p.organisation_id = :organisation_id
          and p.status = 'ACTIVE'
          and pv.status = 'ACTIVE'
          and pc.verification_status = 'VERIFIED'
          and (pc.department = 'ALL' or pc.department = :department)
        order by semantic_score desc
        limit 40
        """
    )
    rows = db.execute(sql, {"query_vector": vector, "organisation_id": filters["organisation_id"], "department": filters["department"]}).mappings().all()
    clause_ids = [row["clause_id"] for row in rows]
    if not clause_ids:
        return []
    mapped = {
        clause.id: (clause, clause.version, clause.version.policy)
        for clause in db.scalars(select(PolicyClause).where(PolicyClause.id.in_(clause_ids)))
    }
    ranked: list[dict] = []
    for row in rows:
        bundle = mapped.get(row["clause_id"])
        if not bundle:
            continue
        clause, version, policy = bundle
        if not _clause_matches_filters(clause, filters):
            continue
        lexical = _jaccard(_tokens(query), _tokens(clause.text))
        score = min(1.0, 0.25 * lexical + 0.6 * max(0.0, float(row["semantic_score"])) + (0.15 if clause.department == filters["department"] else 0.05))
        ranked.append(_match_payload(clause, version, policy, round(score, 4)))
    return sorted(ranked, key=lambda item: (item["score"], STRICTNESS.get(item["action"], 0)), reverse=True)


def _base_statement(organisation_id: str, department: str):
    return (
        select(PolicyClause, PolicyVersion, Policy)
        .join(PolicyVersion, PolicyClause.policy_version_id == PolicyVersion.id)
        .join(Policy, PolicyVersion.policy_id == Policy.id)
        .where(
            Policy.organisation_id == organisation_id,
            Policy.status == "ACTIVE",
            PolicyVersion.status == "ACTIVE",
            PolicyClause.verification_status == "VERIFIED",
            or_(PolicyClause.department == "ALL", PolicyClause.department == department),
        )
    )


def _clause_matches_filters(clause: PolicyClause, filters: dict) -> bool:
    if clause.roles and not set(filters["roles"]).intersection(clause.roles):
        return False
    if clause.purposes and filters["purpose"] not in clause.purposes:
        return False
    if clause.data_classes and filters["data_class"] not in clause.data_classes:
        return False
    if clause.destinations:
        if "UNAPPROVED_ONLY" in clause.destinations and filters["destination_approved"]:
            return False
        destination_values = {filters["destination_origin"], filters["destination_service"] or ""}
        if not any(value in destination_values for value in clause.destinations):
            return False
    return True


def _match_payload(clause: PolicyClause, version: PolicyVersion, policy: Policy, score: float) -> dict:
    citation = f"{policy.name} {version.version} §{clause.clause_ref} p.{clause.page_number}"
    if clause.heading:
        citation += f" ({clause.heading})"
    return {
        "clause_id": clause.id,
        "policy": policy.name,
        "policy_version_id": version.id,
        "policy_version": version.version,
        "clause": clause.clause_ref,
        "scope": clause.department,
        "action": clause.action,
        "score": score,
        "text": clause.text,
        "page": clause.page_number,
        "heading": clause.heading,
        "citation": citation,
    }


def _tokens(value: str) -> set[str]:
    return {token for token in re.findall(r"[\w]+", value.lower()) if len(token) > 2}


def _jaccard(left: set[str], right: set[str]) -> float:
    return len(left & right) / max(1, len(left | right))


def _prune_irrelevant_restrictive_matches(ranked: list[dict]) -> list[dict]:
    top_allow_score = max((item["score"] for item in ranked if item["action"] == "ALLOW"), default=0.0)
    pruned: list[dict] = []
    for item in ranked:
        if item["action"] != "ALLOW" and item["score"] < 0.3 and top_allow_score >= item["score"]:
            continue
        pruned.append(item)
    return pruned
