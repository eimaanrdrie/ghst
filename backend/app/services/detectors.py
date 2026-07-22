import math
import re
from collections import Counter
from dataclasses import asdict, dataclass


@dataclass
class Finding:
    category: str
    severity: str
    confidence: float
    detector: str
    source: str
    start: int
    end: int
    masked_preview: str
    redactable: bool
    confirmed: bool

    def to_dict(self) -> dict:
        return asdict(self)


EMAIL = re.compile(r"(?<![\w.-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![\w.-])", re.I)
PHONE = re.compile(r"(?<!\d)(?:\+?60|0)1[0-9][ -]?[0-9]{3,4}[ -]?[0-9]{4}(?!\d)")
NRIC = re.compile(r"(?<!\d)\d{6}-?\d{2}-?\d{4}(?!\d)")
CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
SECRET_PATTERNS = [
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"), "OPENAI_STYLE_KEY"),
    (re.compile(r"\bAKIA[A-Z0-9]{16}\b"), "AWS_ACCESS_KEY"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"), "GITHUB_TOKEN"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"), "GOOGLE_API_KEY"),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]{18,}={0,2}"), "BEARER_TOKEN"),
    (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"), "PRIVATE_KEY"),
]
ASSIGNED_SECRET = re.compile(
    r"(?i)\b(?:password|passwd|api[_ -]?key|secret|token)\b\s*[:=]\s*['\"]?([^\s'\"]{8,})"
)
PROJECT_NAME = re.compile(r"(?i)\bproject\s+(?:aurora|nightfall|falcon|orchid|meridian)\b")
PROMPT_ATTACK = re.compile(
    r"(?i)\b(?:prompt\s+injection|jailbreak|ignore\s+(?:all\s+)?(?:previous\s+)?(?:safety\s+)?rules|"
    r"bypass\s+(?:guardrails|safety|policy)|hidden\s+system\s+instructions?|reveal\s+(?:the\s+)?system\s+prompt)\b"
)
HIGH_IMPACT_DECISION = re.compile(
    r"(?i)\b(?:terminate\s+(?:the\s+)?employee|termination\s+recommendation|fire\s+(?:the\s+)?employee|"
    r"hiring\s+decision|credit\s+decision|medical\s+advice|legal\s+(?:determination|liability|advice)|"
    r"safely\s+sign\s+(?:it|this|the\s+contract))\b"
)
UNAPPROVED_AI_DESTINATION = re.compile(
    r"(?i)\b(?:unapproved\s+(?:ai|model|destination)|public\s+ai\s+tool|external\s+ai\s+service|"
    r"(?:send|submit|route)\b.{0,80}\b(?:to|through)\s+(?:claude|gemini|copilot|perplexity|public\s+chatbot))\b"
)


def detect(text: str, source: str = "PROMPT") -> list[dict]:
    findings: list[Finding] = []
    findings += _matches(text, EMAIL, "PERSONAL_DATA", "HIGH", 0.99, "email-v1", source, True)
    findings += _matches(text, PHONE, "PERSONAL_DATA", "HIGH", 0.96, "my-phone-v1", source, True)
    findings += _matches(text, NRIC, "PERSONAL_DATA", "HIGH", 0.92, "my-id-v1", source, True)

    for match in CARD.finditer(text):
        digits = re.sub(r"\D", "", match.group())
        if 13 <= len(digits) <= 19 and _luhn(digits):
            findings.append(_finding(match, "FINANCIAL_DATA", "CRITICAL", 0.99, "luhn-card-v1", source, True))

    financial_context = re.compile(
        r"(?i)\b(?:bank\s*account|payroll|invoice|unreleased\s+(?:revenue|financial)|quarterly\s+forecast|card\s+number)\b"
    )
    for match in financial_context.finditer(text):
        end = min(len(text), match.end() + 50)
        findings.append(
            Finding("FINANCIAL_DATA", "HIGH", 0.91, "financial-context-v1", source,
                    match.start(), end, _mask(text[match.start():end]), source == "PROMPT", True)
        )

    for pattern, detector in SECRET_PATTERNS:
        findings += _matches(
            text, pattern, "AUTHENTICATION_SECRETS", "CRITICAL", 0.999, detector, source, False
        )
    for match in ASSIGNED_SECRET.finditer(text):
        findings.append(_finding(match, "AUTHENTICATION_SECRETS", "CRITICAL", 0.98, "secret-assignment-v1", source, False))

    for match in re.finditer(r"[A-Za-z0-9+/=_-]{24,}", text):
        token = match.group()
        context = text[max(0, match.start() - 20):match.start()].lower()
        if _entropy(token) >= 4.2 and any(k in context for k in ("key", "token", "secret", "credential")):
            findings.append(_finding(match, "AUTHENTICATION_SECRETS", "CRITICAL", 0.93, "entropy-secret-v1", source, False))

    for match in re.finditer(r"(?i)\b(?:strictly confidential|confidential|internal only|customer list|merger strategy|proprietary source code)\b", text):
        findings.append(_finding(match, "CONFIDENTIAL_BUSINESS_IP", "HIGH", 0.94, "classification-label-v1", source, False))
    for match in PROJECT_NAME.finditer(text):
        findings.append(_finding(match, "CONFIDENTIAL_BUSINESS_IP", "MEDIUM", 0.62, "org-term-v1", source, False, confirmed=False))

    for match in re.finditer(r"(?i)\b(?:patient diagnosis|medical record|disciplinary record|legally privileged|student record)\b", text):
        findings.append(_finding(match, "REGULATED_RECORDS", "HIGH", 0.93, "regulated-context-v1", source, False))

    findings += _matches(text, PROMPT_ATTACK, "PROMPT_INJECTION", "CRITICAL", 0.97, "prompt-attack-v1", source, False)
    findings += [
        _finding(match, "HIGH_IMPACT_DECISION", "HIGH", 0.9, "consequential-decision-v1", source, False, confirmed=False)
        for match in HIGH_IMPACT_DECISION.finditer(text)
    ]
    findings += _matches(
        text,
        UNAPPROVED_AI_DESTINATION,
        "UNAPPROVED_AI_DESTINATION",
        "HIGH",
        0.93,
        "destination-switch-v1",
        source,
        False,
    )

    return [item.to_dict() for item in _deduplicate(findings)]


def redact_text(text: str, findings: list[dict]) -> str:
    spans = [f for f in findings if f["redactable"] and f["source"] == "PROMPT"]
    for item in sorted(spans, key=lambda x: x["start"], reverse=True):
        placeholder = f"[{item['category']}_REDACTED]"
        text = text[: item["start"]] + placeholder + text[item["end"] :]
    return text


def _matches(text, pattern, category, severity, confidence, detector, source, redactable):
    return [_finding(m, category, severity, confidence, detector, source, redactable) for m in pattern.finditer(text)]


def _finding(match, category, severity, confidence, detector, source, redactable, confirmed=True):
    return Finding(category, severity, confidence, detector, source, match.start(), match.end(),
                   _mask(match.group()), redactable, confirmed)


def _mask(value: str) -> str:
    if len(value) <= 4:
        return "*" * len(value)
    return value[:2] + "*" * min(8, len(value) - 4) + value[-2:]


def _deduplicate(findings: list[Finding]) -> list[Finding]:
    order = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
    found: dict[tuple, Finding] = {}
    for item in findings:
        key = (item.category, item.source, item.start, item.end)
        if key not in found or order[item.severity] > order[found[key].severity]:
            found[key] = item
    return sorted(found.values(), key=lambda x: (x.source, x.start, -order[x.severity]))


def _luhn(number: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(number)):
        value = int(char)
        if index % 2:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def _entropy(value: str) -> float:
    counts = Counter(value)
    return -sum((count / len(value)) * math.log2(count / len(value)) for count in counts.values())
