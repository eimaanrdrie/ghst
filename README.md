# GHST

GHST is a human-governed control layer for enterprise AI use. It intercepts prompts before release, checks them against organisational policy, detects sensitive or high-risk content, routes ambiguous cases to authorised reviewers, and records every governed decision with audit evidence.

The core idea is simple: GHST can learn operationally, but it cannot grant itself authority.

## Why It Matters

GHST demonstrates:

- governed prompt release with `ALLOW`, `REDACT`, `REDIRECT`, `REVIEW`, and `BLOCK`
- policy-grounded decisions instead of freeform AI judgment alone
- human review for high-impact or ambiguous requests
- bounded ACE precedent reuse after approval
- governed learning queues, shadowing, promotion, and rollback
- signed one-time downstream clearance
- tamper-evident audit history

## What’s In The Repo

```text
backend/      FastAPI governance engine, models, migrations, tests
frontend/     Next.js dashboard
extension/    Chrome extension
docs/         architecture and demo references
scripts/      validation and helper scripts
```

## Stack

- Frontend: Next.js 16, React 19, TypeScript, `lucide-react`
- Extension: Chrome Manifest V3, JavaScript, HTML, CSS
- Backend: Python 3.12, FastAPI, SQLAlchemy, Alembic, `psycopg`
- Configuration and APIs: `pydantic-settings`, `httpx`, `python-multipart`, `PyYAML`, `structlog`
- Database: PostgreSQL, Supabase PostgreSQL support, SQLite fallback
- Local model path: Ollama with configured Qwen3.5 model targets
- Document handling: `pypdf`, Tesseract OCR, `pdftoppm`
- Security: PyJWT, `argon2-cffi`, `cryptography`
- Testing: `pytest`, `pytest-cov`, Node test runner

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

If you want local model inference as well:

```bash
docker compose --profile local-llm up --build
```

### Option 2: Local Setup

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

### Supabase Setup

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

### Ollama Setup

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

GHST still keeps deterministic controls and policy evidence as the authority boundary.

### Extension Setup

1. Start the backend and frontend
2. Open `chrome://extensions`
3. Enable Developer mode
4. Choose Load unpacked
5. Select `extension/`
6. Open the GHST extension popup
7. Sign in with a seeded identity

The extension supports the protected composer flow on the configured sandbox and supported ChatGPT origins.

## Demo Flow

Recommended demo:

1. Sign in with a managed identity
2. Submit a safe prompt and show `ALLOW`
3. Submit sensitive content and show `REDACT` or `BLOCK`
4. Submit an ambiguous prompt and show `REVIEW`
5. Approve it in Human Review
6. Show ACE precedent reuse
7. Show governed learning proposing a new queue item
8. Show audit evidence

Detailed guide: [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md)

## Governed Learning

GHST does not retrain itself from live prompts in production.

Instead, it supports two controlled learning paths:

- Operational learning: approved review outcomes become bounded ACE precedents that can be reused only within explicit scope and policy constraints
- Governed learning proposals: repeated similar approved cases can auto-propose a new precedent into the approval queue

Every proposed precedent remains inactive until it is approved by authorised reviewers.

## Verification

Useful commands:

```bash
cd backend
..\.venv\Scripts\python -m pytest

cd frontend
npm run build

node --test extension/adapters.test.js
```

## Current Boundary

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

## More Detail

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/API.md](docs/API.md)
- [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md)
- [SECURITY.md](SECURITY.md)
