import hashlib
import mimetypes
import re
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree

from app.core.config import Settings
from app.services.embeddings import local_embedding
from app.services.pdf import PdfClassificationError, extract_pdf_pages

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
TXT_MIME = "text/plain"
ALLOWED_MIME_TYPES = {PDF_MIME, DOCX_MIME, TXT_MIME}


class PolicyIngestError(ValueError):
    pass


@dataclass
class DocumentPage:
    page_number: int
    text: str


@dataclass
class IngestedPolicyDocument:
    filename: str
    mime_type: str
    sha256: str
    size_bytes: int
    pages: list[DocumentPage]
    text: str
    malware_scan: dict
    extraction_metadata: dict


@dataclass
class ClauseSuggestion:
    clause_ref: str
    text: str
    page_number: int
    heading: str | None
    source_order: int
    suggested_action: str
    suggested_department: str
    suggested_roles: list[str]
    suggested_purposes: list[str]
    suggested_data_classes: list[str]
    suggested_destinations: list[str]
    embedding: list[float]


def sanitize_filename(filename: str) -> str:
    candidate = Path(filename or "policy-upload").name
    candidate = re.sub(r"[^A-Za-z0-9._-]+", "-", candidate).strip("-.")
    return candidate or "policy-upload"


def ingest_policy_file(
    *,
    filename: str,
    content_type: str,
    content: bytes,
    settings: Settings,
) -> IngestedPolicyDocument:
    safe_name = sanitize_filename(filename)
    mime_type = detect_policy_mime_type(content=content, filename=safe_name, declared_type=content_type, settings=settings)
    if mime_type not in ALLOWED_MIME_TYPES:
        raise PolicyIngestError("Only PDF, DOCX and TXT policy uploads are supported.")
    if len(content) > settings.policy_max_upload_bytes:
        raise PolicyIngestError(f"Policy upload exceeds the configured {settings.policy_max_upload_bytes:,}-byte safety limit.")
    sha256 = hashlib.sha256(content).hexdigest()
    malware_scan = run_malware_scan(content=content, filename=safe_name, mime_type=mime_type, settings=settings)
    pages, extraction_metadata = extract_policy_text(content=content, mime_type=mime_type, settings=settings)
    text = "\n\n".join(page.text for page in pages if page.text).strip()
    if not text:
        raise PolicyIngestError("No classifiable policy text was extracted from the uploaded document.")
    return IngestedPolicyDocument(
        filename=safe_name,
        mime_type=mime_type,
        sha256=sha256,
        size_bytes=len(content),
        pages=pages,
        text=text,
        malware_scan=malware_scan,
        extraction_metadata=extraction_metadata,
    )


def detect_policy_mime_type(*, content: bytes, filename: str, declared_type: str, settings: Settings) -> str:
    sniff = content[: settings.policy_signature_scan_limit_bytes]
    guessed = mimetypes.guess_type(filename)[0] or ""
    if sniff.startswith(b"%PDF"):
        mime_type = PDF_MIME
    elif sniff.startswith(b"PK\x03\x04"):
        mime_type = DOCX_MIME if filename.lower().endswith(".docx") else "application/zip"
    else:
        try:
            sniff.decode("utf-8")
            mime_type = TXT_MIME
        except UnicodeDecodeError as exc:
            raise PolicyIngestError("The uploaded file signature does not match a supported policy format.") from exc
    if declared_type and declared_type not in {mime_type, "application/octet-stream", guessed, ""}:
        raise PolicyIngestError("The uploaded file MIME type does not match the detected file signature.")
    if mime_type == "application/zip":
        raise PolicyIngestError("The uploaded ZIP archive is not a valid DOCX policy document.")
    return mime_type


def run_malware_scan(*, content: bytes, filename: str, mime_type: str, settings: Settings) -> dict:
    if not settings.malware_scan_command:
        return {
            "status": "SKIPPED_LOCAL_DEMO",
            "adapter": "local-malware-scan-demo",
            "message": "No malware scan command is configured for this environment.",
        }
    with tempfile.TemporaryDirectory(prefix="ghst-policy-scan-") as directory:
        path = Path(directory) / filename
        path.write_bytes(content)
        command = settings.malware_scan_command.format(path=str(path), mime=mime_type)
        result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=20.0)
        if result.returncode != 0:
            raise PolicyIngestError("The configured malware scanner rejected the uploaded policy document.")
        return {
            "status": "PASSED",
            "adapter": settings.malware_scan_command.split()[0],
            "stdout": result.stdout.strip()[:500],
        }


def extract_policy_text(*, content: bytes, mime_type: str, settings: Settings) -> tuple[list[DocumentPage], dict]:
    if mime_type == PDF_MIME:
        try:
            pages = [
                DocumentPage(page_number=page.page_number, text=page.text.strip())
                for page in extract_pdf_pages(
                    content,
                    settings.policy_max_upload_bytes,
                    settings.max_pdf_pages,
                    ocr_enabled=settings.policy_ocr_enabled,
                    ocr_language=settings.policy_ocr_language,
                    ocr_command=settings.ocr_command,
                    renderer_command=settings.pdf_renderer_command,
                    ocr_timeout_seconds=max(2.0, settings.pdf_parse_timeout_seconds - 1.0),
                )
            ]
        except PdfClassificationError as exc:
            raise PolicyIngestError(str(exc)) from exc
        return pages, {"source_type": "PDF", "ocr_enabled": settings.policy_ocr_enabled}
    if mime_type == DOCX_MIME:
        return extract_docx_pages(content), {"source_type": "DOCX", "ocr_enabled": False}
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PolicyIngestError("TXT policies must be valid UTF-8 text.") from exc
    return [DocumentPage(page_number=1, text=text.strip())], {"source_type": "TXT", "ocr_enabled": False}


def extract_docx_pages(content: bytes) -> list[DocumentPage]:
    try:
        from io import BytesIO

        with zipfile.ZipFile(BytesIO(content)) as archive:
            names = set(archive.namelist())
            if "EncryptedPackage" in names:
                raise PolicyIngestError("Encrypted DOCX files cannot be ingested safely.")
            if "word/document.xml" not in names:
                raise PolicyIngestError("The DOCX file is malformed or missing word/document.xml.")
            xml_root = ElementTree.fromstring(archive.read("word/document.xml"))
    except PolicyIngestError:
        raise
    except Exception as exc:
        raise PolicyIngestError("The DOCX file is malformed or cannot be parsed safely.") from exc
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for paragraph in xml_root.findall(".//w:p", namespace):
        text = "".join(node.text or "" for node in paragraph.findall(".//w:t", namespace)).strip()
        if text:
            paragraphs.append(text)
    if not paragraphs:
        raise PolicyIngestError("The DOCX file does not contain extractable policy text.")
    return [DocumentPage(page_number=1, text="\n".join(paragraphs))]


def segment_clauses(document: IngestedPolicyDocument, settings: Settings) -> list[ClauseSuggestion]:
    clauses: list[ClauseSuggestion] = []
    heading: str | None = None
    order = 0
    for page in document.pages:
        blocks = [block.strip() for block in re.split(r"\n\s*\n", page.text) if block.strip()]
        for block in blocks:
            lines = [line.strip() for line in block.splitlines() if line.strip()]
            if not lines:
                continue
            if _looks_like_heading(lines[0]) and len(lines) > 1:
                heading = lines[0]
                lines = lines[1:]
            if not lines:
                continue
            fragments = _split_block(lines)
            for fragment in fragments:
                text = fragment.strip()
                if len(text) < 20:
                    continue
                order += 1
                clause_ref = detect_clause_ref(text, order)
                suggestion = metadata_suggestion(text)
                clauses.append(
                    ClauseSuggestion(
                        clause_ref=clause_ref,
                        text=text,
                        page_number=page.page_number,
                        heading=heading,
                        source_order=order,
                        suggested_action=suggestion["action"],
                        suggested_department=suggestion["department"],
                        suggested_roles=suggestion["roles"],
                        suggested_purposes=suggestion["purposes"],
                        suggested_data_classes=suggestion["data_classes"],
                        suggested_destinations=suggestion["destinations"],
                        embedding=local_embedding(text, settings.policy_embedding_dimensions),
                    )
                )
    if not clauses:
        raise PolicyIngestError("No reviewable clauses were segmented from the uploaded policy document.")
    return clauses


def detect_clause_ref(text: str, ordinal: int) -> str:
    match = re.match(r"^(?:clause|section)?\s*([0-9]+(?:\.[0-9]+)*)", text, re.I)
    if match:
        return match.group(1)
    return f"{ordinal}"


def metadata_suggestion(text: str) -> dict:
    lowered = text.lower()
    if any(word in lowered for word in ("must not", "prohibited", "blocked", "cannot be sent")):
        action = "BLOCK"
    elif "human review" in lowered or "reviewer" in lowered:
        action = "REVIEW"
    elif "redirect" in lowered or "approved destination" in lowered:
        action = "REDIRECT"
    elif "redact" in lowered or "remove identifiers" in lowered:
        action = "REDACT"
    else:
        action = "ALLOW"
    department = "Finance" if "finance" in lowered or "payroll" in lowered else "Legal" if "legal" in lowered or "privileged" in lowered else "ALL"
    roles = ["EMPLOYEE"] if "employee" in lowered else []
    purposes = [purpose for purpose in ("Legal research", "Financial analysis", "Routine drafting", "Software troubleshooting") if purpose.lower() in lowered]
    data_classes = []
    if "financial" in lowered or "payroll" in lowered:
        data_classes.append("FINANCIAL_DATA")
    if "personal" in lowered or "identifier" in lowered:
        data_classes.append("PERSONAL_DATA")
    if "confidential" in lowered or "proprietary" in lowered:
        data_classes.append("CONFIDENTIAL_BUSINESS_IP")
    if "medical" in lowered or "privileged" in lowered:
        data_classes.append("REGULATED_RECORDS")
    destinations = []
    if "chatgpt" in lowered:
        destinations.append("https://chatgpt.com")
    if "sandbox" in lowered or "approved ai destination" in lowered:
        destinations.append("http://localhost:3000/ai-sandbox")
    return {
        "action": action,
        "department": department,
        "roles": roles,
        "purposes": purposes,
        "data_classes": data_classes,
        "destinations": destinations,
    }


def _looks_like_heading(line: str) -> bool:
    trimmed = line.strip()
    if not trimmed:
        return False
    return trimmed.isupper() or trimmed.lower().startswith(("policy", "standard", "section"))


def _split_block(lines: list[str]) -> list[str]:
    combined = "\n".join(lines)
    chunks = re.split(r"(?m)(?=^(?:clause|section)?\s*[0-9]+(?:\.[0-9]+)*[\).:\s])", combined)
    return [chunk.strip() for chunk in chunks if chunk.strip()]
