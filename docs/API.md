# GHST API Guide

The authoritative machine-readable contract is `docs/openapi.json`. When the API is running, Swagger UI is available at `http://localhost:8000/docs`.

All application endpoints use `/api/v1`. Only liveness and readiness are unauthenticated.

| Endpoint | Purpose |
|---|---|
| `POST /auth/login` | Obtain a signed demo identity token |
| `GET /auth/me` | Inspect trusted organisation, department and role claims |
| `POST /evaluations` | Evaluate prompt, bounded PDF/OCR and rolling-session context before release |
| `GET /evaluations/{id}` | Retrieve authorised decision evidence/status |
| `POST /evaluations/{id}/redact` | Apply typed placeholders and perform a complete rescan |
| `POST /evaluations/{id}/challenge` | Append a classification challenge without rewriting history |
| `POST /evaluations/{id}/clearance-grant` | Issue exact-context one-time clearance after final Allow |
| `GET /reviews` | Department-scoped reviewer queue |
| `GET /reviews/{id}` | Decrypt temporary evidence with audited access |
| `POST /reviews/{id}/decision` | Record justified human decision and optional bounded precedent |
| `GET/POST /review-delegations` | Inspect or grant audited, expiring cross-department authority |
| `POST /review-delegations/{id}/revoke` | Revoke cross-department authority immediately |
| `GET /precedents` | Inspect ACE lifecycle and provenance |
| `POST /precedents/{id}/revoke` | Revoke precedent immediately |
| `POST /precedents/{id}/second-approval` | Independently approve/reject a high-impact precedent |
| `POST /precedents/{id}/scope` | Policy-admin-only department/global scope assignment |
| `GET/POST /policies` | Inspect policies or create non-enforceable draft |
| `POST /policies/{id}/versions` | Add a draft version |
| `POST /policies/{id}/versions/{version}/activate` | Activate version and invalidate affected precedents |
| `POST /policies/{id}/versions/{version}/simulate` | Preview action changes and affected precedents |
| `GET/POST /learning/calibrations...` | Generate, inspect and authorise conservative calibration versions |
| `GET/POST /learning/model-jobs...` | Register governed private LoRA/QLoRA evidence and create candidates |
| `GET/POST /learning/models...` | Evaluate, shadow, promote and roll back organisation model versions |
| `POST /gateway/v1/chat/completions` | OpenAI-compatible governed gateway fast path |
| `GET /audit/events` | Search role-scoped audit metadata |
| `POST /audit/verify` | Verify hash-link integrity |
| `GET /dashboard/summary` | Privacy-safe aggregate metrics |
| `GET /models/benchmark` | Candidate evaluation metadata |
| `GET /identities/reviewers` | System-admin reviewer inventory for explicit delegation |
| `POST /usability/responses` | Record privacy-safe task and SUS evidence |
| `GET /usability/summary` | Aggregate task completion and SUS targets |
| `GET /health/live`, `GET /health/ready` | Liveness and fail-safe dependency readiness |

Errors never release content. A non-2xx response includes an actionable `detail` and the response header contains an `X-Request-ID`.
