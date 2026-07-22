import io
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


class PdfClassificationError(ValueError):
    pass


@dataclass
class PdfPageText:
    page_number: int
    text: str


def extract_pdf(
    data: bytes,
    max_bytes: int,
    max_pages: int,
    *,
    ocr_enabled: bool = False,
    ocr_language: str = "eng",
    ocr_command: str = "tesseract",
    renderer_command: str = "pdftoppm",
    ocr_timeout_seconds: float = 15.0,
) -> str:
    pages = extract_pdf_pages(
        data,
        max_bytes,
        max_pages,
        ocr_enabled=ocr_enabled,
        ocr_language=ocr_language,
        ocr_command=ocr_command,
        renderer_command=renderer_command,
        ocr_timeout_seconds=ocr_timeout_seconds,
    )
    return "\n".join(page.text for page in pages if page.text).strip()


def extract_pdf_pages(
    data: bytes,
    max_bytes: int,
    max_pages: int,
    *,
    ocr_enabled: bool = False,
    ocr_language: str = "eng",
    ocr_command: str = "tesseract",
    renderer_command: str = "pdftoppm",
    ocr_timeout_seconds: float = 15.0,
) -> list[PdfPageText]:
    if len(data) > max_bytes:
        raise PdfClassificationError("PDF exceeds the configured 5 MB prototype limit.")
    if not data.startswith(b"%PDF"):
        raise PdfClassificationError("The uploaded file is not a valid PDF.")
    try:
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise PdfClassificationError("Encrypted PDFs cannot be classified safely.")
        if len(reader.pages) > max_pages:
            raise PdfClassificationError("PDF exceeds the configured page limit.")
        pages = [PdfPageText(page_number=index + 1, text=(page.extract_text() or "").strip()) for index, page in enumerate(reader.pages)]
        text = "\n".join(page.text for page in pages).strip()
        if not text:
            if not ocr_enabled:
                raise PdfClassificationError("No machine-readable text was found and OCR is disabled.")
            ocr_text = _extract_with_ocr(
                data,
                page_count=len(reader.pages),
                language=ocr_language,
                ocr_command=ocr_command,
                renderer_command=renderer_command,
                timeout_seconds=ocr_timeout_seconds,
            )
            if not ocr_text:
                raise PdfClassificationError("OCR completed but no classifiable text was found.")
            pages = [PdfPageText(page_number=index + 1, text=page_text.strip()) for index, page_text in enumerate(ocr_text.split("\f")) if page_text.strip()]
            if not pages:
                pages = [PdfPageText(page_number=1, text=ocr_text.strip())]
        return pages
    except PdfClassificationError:
        raise
    except Exception as exc:
        raise PdfClassificationError("The PDF is corrupt or cannot be parsed safely.") from exc


def _extract_with_ocr(
    data: bytes,
    *,
    page_count: int,
    language: str,
    ocr_command: str,
    renderer_command: str,
    timeout_seconds: float,
) -> str:
    renderer = shutil.which(renderer_command)
    ocr = shutil.which(ocr_command)
    if not renderer or not ocr:
        raise PdfClassificationError("OCR is enabled but the isolated renderer or OCR executable is unavailable.")
    try:
        with tempfile.TemporaryDirectory(prefix="ghst-ocr-") as directory:
            root = Path(directory)
            process_env = {
                "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
                "LANG": "C.UTF-8",
                "HOME": directory,
            }
            source = root / "input.pdf"
            source.write_bytes(data)
            output_prefix = root / "page"
            subprocess.run(
                [renderer, "-f", "1", "-l", str(page_count), "-r", "150", "-png", str(source), str(output_prefix)],
                check=True,
                capture_output=True,
                timeout=timeout_seconds,
                env=process_env,
            )
            pages = sorted(root.glob("page-*.png"))
            if len(pages) != page_count:
                raise PdfClassificationError("The isolated PDF renderer did not produce every expected page.")
            extracted: list[str] = []
            per_page_timeout = max(1.0, timeout_seconds / max(1, page_count))
            for page in pages:
                result = subprocess.run(
                    [ocr, str(page), "stdout", "-l", language],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=per_page_timeout,
                    env=process_env,
                )
                extracted.append(result.stdout.strip())
            return "\f".join(part for part in extracted if part).strip()
    except subprocess.TimeoutExpired as exc:
        raise PdfClassificationError("OCR exceeded the configured execution-time limit.") from exc
    except subprocess.CalledProcessError as exc:
        raise PdfClassificationError("OCR could not classify the image-only PDF safely.") from exc
