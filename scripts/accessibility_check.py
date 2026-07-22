"""Static accessibility release checks for generated HTML and design tokens.

This complements, but does not replace, managed-browser keyboard and screen-reader testing.
"""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class AuditParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.lang = ""
        self.has_title = False
        self.main_count = 0
        self.ids: list[str] = []
        self.interactive: list[dict] = []
        self.stack: list[dict] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "html":
            self.lang = attributes.get("lang", "")
        if tag == "title":
            self.has_title = True
        if tag == "main":
            self.main_count += 1
        if attributes.get("id"):
            self.ids.append(attributes["id"])
        node = {"tag": tag, "attrs": attributes, "text": ""}
        self.stack.append(node)
        if tag in {"button", "a"}:
            self.interactive.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                node = self.stack.pop(index)
                if self.stack:
                    self.stack[-1]["text"] += node["text"]
                break

    def handle_data(self, data):
        if self.stack:
            self.stack[-1]["text"] += data


def contrast(left: str, right: str) -> float:
    def luminance(value: str) -> float:
        channels = [int(value[index:index + 2], 16) / 255 for index in (1, 3, 5)]
        converted = [item / 12.92 if item <= 0.04045 else ((item + 0.055) / 1.055) ** 2.4 for item in channels]
        return 0.2126 * converted[0] + 0.7152 * converted[1] + 0.0722 * converted[2]
    high, low = sorted((luminance(left), luminance(right)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def main() -> None:
    failures: list[str] = []
    pages = [
        page for page in sorted((ROOT / "frontend" / "out").glob("*.html"))
        if page.name not in {"404.html", "_not-found.html"}
    ]
    for page in pages:
        parser = AuditParser()
        parser.feed(page.read_text(encoding="utf-8"))
        if parser.lang != "en":
            failures.append(f"{page.name}: html language is not en")
        if not parser.has_title:
            failures.append(f"{page.name}: missing title")
        if parser.main_count != 1:
            failures.append(f"{page.name}: expected one main landmark, found {parser.main_count}")
        if len(parser.ids) != len(set(parser.ids)):
            failures.append(f"{page.name}: duplicate element IDs")
        for node in parser.interactive:
            name = node["attrs"].get("aria-label", "") or node["text"].strip()
            if not name:
                failures.append(f"{page.name}: unnamed {node['tag']}")
    token_pairs = {
        "body text/background": ("#ffffff", "#020617", 4.5),
        "muted text/background": ("#a1a1aa", "#020617", 4.5),
        "blue status/background": ("#93c5fd", "#020617", 4.5),
        "primary button text/accent": ("#ffffff", "#1d4ed8", 4.5),
    }
    ratios = {}
    for name, (foreground, background, minimum) in token_pairs.items():
        ratio = contrast(foreground, background)
        ratios[name] = round(ratio, 2)
        if ratio < minimum:
            failures.append(f"{name}: contrast {ratio:.2f} is below {minimum}")
    if failures:
        raise SystemExit("\n".join(failures))
    print({"pages_checked": len(pages), "contrast_ratios": ratios, "status": "PASS"})


if __name__ == "__main__":
    main()
