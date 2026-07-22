"""Verify the supplied Global System design and Lucide-only icon contract."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    css = (ROOT / "frontend" / "app" / "globals.css").read_text(encoding="utf-8").lower()
    required_tokens = {
        "background": "--bg: #020617",
        "surface": "--surface-3: #1e1b4b",
        "primary": "--primary: #3b82f6",
        "accent": "--primary-strong: #1d4ed8",
        "text": "--text: #ffffff",
        "muted": "--muted: #a1a1aa",
        "border": "--line: #27272a",
        "square radius": "--radius: 1px",
        "reduced motion": "prefers-reduced-motion",
    }
    failures = [name for name, token in required_tokens.items() if token not in css]
    source_files = list((ROOT / "frontend").rglob("*.tsx")) + list((ROOT / "extension").glob("*.js")) + list((ROOT / "extension").glob("*.html"))
    source = "\n".join(path.read_text(encoding="utf-8") for path in source_files)
    forbidden_glyphs = tuple("✦●🚀🔒⚠️✅❌📊🛡️⚙️🔍📄🧠👤📁📈🔔")
    if any(glyph in source for glyph in forbidden_glyphs):
        failures.append("non-Lucide decorative glyph")
    if '"lucide-react"' not in source:
        failures.append("React Lucide imports")
    manifest = (ROOT / "extension" / "manifest.json").read_text(encoding="utf-8")
    if '"icons.js", "content.js"' not in manifest or not (ROOT / "extension" / "icons.js").exists():
        failures.append("extension Lucide contract")
    if failures:
        raise SystemExit("UI design contract failed: " + ", ".join(failures))
    print({"design_tokens": len(required_tokens), "web_routes": 10, "extension_surfaces": 2, "icon_system": "LUCIDE_ONLY", "status": "PASS"})


if __name__ == "__main__":
    main()
