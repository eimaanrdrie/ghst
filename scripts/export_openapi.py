"""Export the exact FastAPI OpenAPI contract included in the deliverable."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.main import app  # noqa: E402

output = ROOT / "docs" / "openapi.json"
output.write_text(json.dumps(app.openapi(), indent=2), encoding="utf-8")
print(output)

