<p align="center">
  <img src="frontend/public/ghst-logo2.png" alt="GHST logo" width="180" />
</p>

<h1 align="center">GHST</h1>

GHST is a **self-learning enterprise AI governance system** that operates with **bounded autonomy under human governance.** GHST intercepts prompts before they reach external AI, checks them against organisational policy, detects sensitive or high-risk context, routes ambiguous requests to authorised reviewers, and records every governed decision with tamper-evident audit evidence.


> GHST can learn what has already been approved. It cannot approve itself.

---


## What GHST does

GHST demonstrates:

- governed prompt release with `ALLOW`, `REDACT`, `REDIRECT`, `REVIEW`, and `BLOCK`
- policy-grounded decisions instead of freeform model judgment alone
- human review for high-impact, low-confidence, or ambiguous requests
- bounded ACE precedent reuse after approval
- governed learning queues, shadowing, promotion, and rollback controls
- signed downstream clearance
- tamper-evident audit history

---

## Architecture

GHST has three product surfaces and one governance backend:

| Surface | Role |
|-------|------|
| **Chrome extension** | intercepts prompts, shows enforcement outcomes, and protects supported AI destinations |
| **Dashboard** | exposes control plane, policy memory, human review, governed learning, precedents, and audit |
| **Backend API** | evaluates prompts, stores decisions, enforces policy, and manages review and learning workflows |
| **Database** | stores identities, policies, evaluations, reviews, precedents, learning records, and audit history |

### Decision flow

| Step | What happens | Outcome |
|------|--------------|---------|
| **1 · Intercept** | GHST captures the prompt before release | raw request stays inside the governed path |
| **2 · Evaluate** | backend checks policy, findings, destination, and risk signals | governed action is determined |
| **3 · Enforce** | safe requests proceed, risky requests are redacted, redirected, reviewed, or blocked | no uncontrolled release |
| **4 · Review** | authorised reviewers inspect protected evidence and decide | human authority remains final |
| **5 · Learn** | approved outcomes can become ACE precedents or governed proposals | similar future prompts can reuse memory |
| **6 · Audit** | every governed decision is written into the chain-linked audit record | evidence remains verifiable |

---

## Key features

- **Pre-submission governance** through the Chrome extension before prompts reach external AI
- **Policy memory** with clause extraction, versioning, activation, simulation, and verification workflow
- **Human review** with protected payloads, reviewer decisions, and second-review controls for high-impact precedents
- **ACE precedent reuse** so approved patterns can be applied again within explicit scope and expiry
- **Governed learning** with proposal queue, candidate comparison, shadowing, promotion, and rollback controls
- **Audit chain** with hash-linked event receipts and verification
- **Role-based seeded identities** for demo-ready access across employee, reviewer, policy, audit, and system roles
- **PDF support** through `pypdf`, with optional OCR tooling for document workflows
- **Static web frontend** suitable for Vercel hosting, with backend hosted separately

---

## Tech stack

Only technologies actually used in this repo or runtime path are listed here.

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, `lucide-react` |
| Extension | Chrome Manifest V3, JavaScript, HTML, CSS |
| Backend | Python 3.12, FastAPI, SQLAlchemy, Alembic, `psycopg` |
| Config and API support | `pydantic-settings`, `httpx`, `python-multipart`, `PyYAML`, `structlog` |
| Database | PostgreSQL, Supabase PostgreSQL support, SQLite fallback |
| Local LLM | Ollama with configured Qwen3.5 model targets |
| Document handling | `pypdf`, Tesseract OCR, `pdftoppm` |
| Security libraries | PyJWT, `argon2-cffi`, `cryptography` |
| Testing | `pytest`, `pytest-cov`, Node test runner |

---

## Repository structure

```text
backend/      FastAPI governance engine, models, migrations, tests
frontend/     Next.js dashboard
extension/    Chrome extension
docs/         architecture and demo references
scripts/      validation and helper scripts
```

---

## Setup

### Prerequisites

- Python `3.12+`
- Node.js `24+`
- npm `11+`
- Chrome
- Docker Desktop for the fastest demo path
- Ollama only if you want live local inference

### Option 1: Docker

This is the fastest path for judges and demos.

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Dashboard: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/api/v1/health/ready`

If you also want local model inference:

```bash
docker compose --profile local-llm up --build
```

### Option 2: Local setup

Create the environment file:

```bash
cp .env.example .env
```

For the simplest local fallback, keep:

```env
DATABASE_URL=sqlite:///./ghst_demo.db
DEMO_MODE=true
```

Install dependencies:

```bash
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt

cd frontend
npm ci
cd ..
```

Prepare and run the backend:

```bash
cd backend
..\.venv\Scripts\alembic upgrade head
..\.venv\Scripts\python -m app.db.seed
..\.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

In a second terminal, run the frontend:

```bash
cd frontend
npm run dev
```

### Supabase setup

GHST can use Supabase as the main PostgreSQL database.

Set `DATABASE_URL` to your Supabase Session pooler URI and convert it to SQLAlchemy format:

- change `postgres://` to `postgresql+psycopg://`
- keep `sslmode=require`
- URL-encode special password characters

Example:

```env
DATABASE_URL=postgresql+psycopg://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require
```

If you also want policy memory storage in Supabase, set:

```env
POLICY_STORAGE_ADAPTER=SUPABASE
SUPABASE_PROJECT_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=ghst-policy-memory
```

### Ollama setup

Ollama is optional. GHST works in transparent demo mode without it.

For a simple demo, keep:

```env
DEMO_MODE=true
```

For live local inference:

1. Install Ollama from `https://ollama.com`
2. Start the Ollama service
3. Pull the configured models

```bash
ollama pull qwen3.5:9b
ollama pull qwen3.5:4b
```

4. Update `.env`

```env
DEMO_MODE=false
OLLAMA_URL=http://localhost:11434
LOCAL_MODEL=qwen3.5:9b
LOCAL_MODEL_FALLBACK=qwen3.5:4b
```

### Extension setup

1. Start the backend and frontend
2. Open `chrome://extensions`
3. Enable Developer mode
4. Choose Load unpacked
5. Select `extension/`
6. Open the GHST extension popup
7. Sign in with a seeded identity

The extension supports the protected composer flow on the configured sandbox and supported ChatGPT origins.


---

## Governed learning

GHST does not retrain itself from live prompts in production.

Instead, it supports two controlled learning paths:

- **Operational learning**: approved review outcomes become bounded ACE precedents that can be reused only within explicit scope and policy constraints
- **Governed learning proposals**: repeated similar approved cases can auto-propose a new precedent into the approval queue

Every proposed precedent remains inactive until it is approved by authorised reviewers.

---

## Verification

Useful commands:

```bash
cd backend
..\.venv\Scripts\python -m pytest

cd frontend
npm run build

node --test extension/adapters.test.js
```

---

## Current boundary

Implemented:

- governed prompt interception
- policy retrieval and bounded ACE reuse
- human review and second approval controls
- governed learning UI and model lifecycle
- signed downstream clearance
- tamper-evident audit history

Environment-dependent:

- live Ollama and Qwen inference
- production Supabase credentials and hardening
- real external downstream integration

---

## More detail

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/API.md](docs/API.md)
- [SECURITY.md](SECURITY.md)
