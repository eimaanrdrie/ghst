# GHST Security Model

## Security boundary

The browser extension, FastAPI Policy Decision Point, policy store, ACE memory, audit store and optional Ollama service are treated as organisation-controlled components. An employee-facing AI destination is outside that trusted boundary.

## Enforced controls

- Deny-by-default JWT authentication and role checks on every non-health endpoint.
- Organisation and department context derived from server-side signed identity, never request input.
- Argon2id password hashing for disposable demo identities.
- Deterministic hard prohibitions take precedence over model or reviewer recommendations.
- AES-GCM temporary review evidence with a 15-minute default TTL and audited access.
- HMAC-SHA-256 prompt fingerprints instead of raw prompt persistence.
- Ed25519-signed, exact-context, 60-second clearance grants with one-time nonce consumption.
- Complete digest recomputation at the gateway; modified, expired, replayed or mismatched requests are blocked.
- Hash-linked append-only audit events with integrity verification and first-break reporting.
- Raw prompts and files excluded from structured logs, audit events and standard evaluation records.
- File type, size, encryption, extraction and page-count checks with fail-closed outcomes.
- Image-only PDF OCR runs through bounded Poppler/Tesseract subprocesses in a temporary directory with page and execution limits.
- Rolling-session evasion analysis stores only categorical counters with TTL; it never persists prompt fragments.
- Policy text and uploaded content treated as untrusted data; neither can execute instructions.
- Optional Ollama service has no public port and resides on an internal Docker network.
- Cross-department reviewer authority is explicit, time-bounded, revocable and audited.
- High-impact learning requires an independent second reviewer; global ACE scope requires a Policy Administrator.
- Calibration can only make thresholds more conservative than the static baseline and cannot alter hard rules.
- Private model promotion requires de-identification, balance, held-out/adversarial/regression gates, explicit human promotion and rollback provenance.
- The real provider adapter requires HTTPS, disables ambient proxy inheritance, validates response structure and consumes one-time grants before network delivery.
- Production persistence uses Supabase PostgreSQL only through the FastAPI server. No Supabase URL, anon key or service-role key is exposed to the frontend or extension.
- TLS is mandatory for the Supabase connection (`sslmode=require`). The persistent API profile prefers the Supavisor Session pooler; transaction mode automatically disables prepared statements.
- Migration `0003` enables row-level security on GHST tables and revokes table access from Supabase `anon` and `authenticated` roles. Application RBAC remains enforced in FastAPI.

## Production network profile

`docker-compose.production.yml` provides TLS termination, a private governance network and a separate controlled-egress network. The local model, frontend and edge have no Internet route. Only the PDP/API can join controlled egress, which must be restricted by the deployment firewall to the organisation-owned Supabase pooler and approved AI destinations.

## Production hardening required

Before non-demo use, replace every development key; provide organisation certificates; integrate an enterprise OIDC provider; store keys in a managed secret system/HSM; use immutable audit export; run SAST, dependency and container scanning; move PDF/OCR parsing into a dedicated sandbox where available; enforce the controlled-egress allowlist; configure retention with Privacy/Legal; and complete penetration, accessibility and threat-model reviews.

Generate development material with:

```bash
openssl rand -base64 48
openssl rand -base64 32
```

Never commit the resulting `.env` file.

## Responsible disclosure

Do not test GHST with real personal data, live credentials or confidential company records in the hackathon environment. Use only the versioned synthetic corpus.
