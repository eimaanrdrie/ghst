.PHONY: setup seed test build live corpus models private-data accessibility extension-test backup-demo docker-up docker-production docker-down

setup:
	python3 -m venv --copies .venv
	.venv/bin/python -m pip install -r backend/requirements.txt
	cd frontend && npm ci

seed:
	cd backend && ../.venv/bin/alembic upgrade head && ../.venv/bin/python -m app.db.seed

test:
	cd backend && ../.venv/bin/python -m pytest
	node --test extension/adapters.test.js

build:
	cd frontend && npm run lint && npm run build

live:
	./scripts/verify_live.sh

corpus:
	.venv/bin/python scripts/generate_corpus.py
	.venv/bin/python scripts/evaluate_corpus.py

models:
	.venv/bin/python scripts/benchmark_models.py

private-data:
	.venv/bin/python scripts/train_private_adapter.py --backend validate

accessibility: build
	.venv/bin/python scripts/accessibility_check.py

extension-test:
	node --test extension/adapters.test.js

backup-demo:
	./scripts/build_backup_demo.sh

docker-up:
	docker compose up --build

docker-production:
	docker compose -f docker-compose.production.yml up --build

docker-down:
	docker compose down
