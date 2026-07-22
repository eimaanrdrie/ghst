import asyncio

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.config import Settings, get_settings
from app.db.models import Evaluation, Review, User
from app.db.session import get_db
from app.schemas.evaluation import ChallengeRequest, EvaluationResponse, RedactRequest
from app.services.audit import append_audit
from app.services.governance import create_redacted_candidate, evaluate, response_for
from app.services.pdf import PdfClassificationError, extract_pdf

router = APIRouter(prefix="/evaluations", tags=["Governance Evaluations"])


@router.post("", response_model=EvaluationResponse)
async def create_evaluation(
    prompt: str = Form(default=""),
    purpose: str = Form(default="General productivity"),
    destination_origin: str = Form(...),
    session_id: str = Form(default="web-session"),
    device_id: str = Form(default="managed-demo-device"),
    claimed_department: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    # claimed_department is intentionally ignored: department comes from the signed identity.
    file_text = None
    file_error = None
    if file:
        if file.content_type not in {"application/pdf", "application/octet-stream"}:
            file_error = "CLASSIFICATION_UNAVAILABLE: only text-based PDF files are supported."
        else:
            try:
                file_bytes = await file.read()
                file_text = await asyncio.wait_for(
                    asyncio.to_thread(
                        extract_pdf,
                        file_bytes,
                        settings.max_pdf_bytes,
                        settings.max_pdf_pages,
                        ocr_enabled=settings.ocr_enabled,
                        ocr_language=settings.ocr_language,
                        ocr_command=settings.ocr_command,
                        renderer_command=settings.pdf_renderer_command,
                        ocr_timeout_seconds=max(2.0, settings.pdf_parse_timeout_seconds - 1.0),
                    ),
                    timeout=settings.pdf_parse_timeout_seconds,
                )
            except TimeoutError:
                file_error = "CLASSIFICATION_UNAVAILABLE: PDF/OCR parsing exceeded the configured safety limit."
            except PdfClassificationError as exc:
                file_error = f"CLASSIFICATION_UNAVAILABLE: {exc}"
    try:
        evaluation, review, redirect = evaluate(
            db,
            user=user,
            prompt=prompt,
            purpose=purpose,
            destination_origin=destination_origin,
            session_id=session_id,
            settings=settings,
            file_text=file_text,
            file_error=file_error,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return response_for(evaluation, review, redirect)


@router.get("/{evaluation_id}", response_model=EvaluationResponse)
def get_evaluation(
    evaluation_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    evaluation = db.get(Evaluation, evaluation_id)
    if not evaluation or evaluation.organisation_id != user.organisation_id:
        raise HTTPException(status_code=404, detail="Evaluation was not found.")
    if "EMPLOYEE" in user.roles and evaluation.user_id != user.id:
        raise HTTPException(status_code=403, detail="Employees may view only their own evaluations.")
    review = db.scalar(select(Review).where(Review.evaluation_id == evaluation.id))
    return response_for(evaluation, review)


@router.post("/{evaluation_id}/redact", response_model=EvaluationResponse)
def redact_evaluation(
    evaluation_id: str,
    body: RedactRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    original = db.get(Evaluation, evaluation_id)
    if not original or original.user_id != user.id:
        raise HTTPException(status_code=404, detail="Evaluation was not found.")
    if original.action != "REDACT":
        raise HTTPException(status_code=409, detail="This evaluation has no safe redaction path.")
    redacted = create_redacted_candidate(body.prompt)
    result, review, redirect = evaluate(
        db,
        user=user,
        prompt=redacted,
        purpose=body.purpose,
        destination_origin=body.destination_origin,
        session_id=body.session_id,
        settings=settings,
        parent_evaluation_id=original.id,
    )
    return response_for(result, review, redirect, redacted)


@router.post("/{evaluation_id}/challenge")
def challenge_evaluation(
    evaluation_id: str,
    body: ChallengeRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    evaluation = db.get(Evaluation, evaluation_id)
    if not evaluation or evaluation.user_id != user.id:
        raise HTTPException(status_code=404, detail="Evaluation was not found.")
    append_audit(
        db,
        event_type="CLASSIFICATION_CHALLENGED",
        actor_id=user.id,
        organisation_id=user.organisation_id,
        department=user.department,
        entity_type="EVALUATION",
        entity_id=evaluation.id,
        payload={"reason": body.reason[:500], "original_action": evaluation.action},
    )
    db.commit()
    return {"status": "RECORDED", "message": "The challenge was recorded without altering the original decision."}
