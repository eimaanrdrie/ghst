import secrets
import time

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import auth, evaluations, gateway, learning, operations, policies, reviews
from app.core.config import get_settings
from app.core.logging import configure_logging

settings = get_settings()
configure_logging(settings.log_level)
log = structlog.get_logger()

app = FastAPI(
    title="GHST Enterprise AI Governance API",
    description="Policy Decision Point, human review, bounded ACE learning and controlled AI gateway.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"chrome-extension://.*" if settings.environment != "production" else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", f"req_{secrets.token_hex(8)}")
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("request_failed", request_id=request_id, method=request.method, path=request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": "GHST failed safely. No content was released.", "request_id": request_id},
        )
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    log.info(
        "request_completed",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=round((time.perf_counter() - started) * 1000, 2),
    )
    return response


for router in [auth.router, evaluations.router, reviews.router, gateway.router, policies.router, learning.router, operations.router]:
    app.include_router(router, prefix="/api/v1")


@app.get("/")
def root():
    return {
        "product": "GHST",
        "definition": "Human-governed bounded-autonomous enterprise AI governance",
        "api": "/docs",
        "health": "/api/v1/health/ready",
    }
