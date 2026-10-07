"""Server-only Groq support for compact charger investigations."""

import hashlib
import json
import math
import os
import re
import socket
import threading
import time
from datetime import timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-oss-20b"
MAX_INPUT_TOKENS = min(8_000, max(1_000, int(os.environ.get("SMART_AI_MAX_INPUT_TOKENS", "8000"))))
MAX_CONTEXT_BYTES = MAX_INPUT_TOKENS * 3
MAX_FINDINGS = 3
MAX_EVIDENCE = 8
MAX_MODEL_EVIDENCE = 3
MAX_QUESTION_LENGTH = 1_000
REQUEST_TIMEOUT_SECONDS = 25
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_REQUESTS = 12

SYSTEM_INSTRUCTION = """Interpret only this compact, precomputed EV charger investigation packet. The dashboard has already calculated statistics and patterns; do not recalculate them. Distinguish facts from possibilities, never invent causes or details, and cite only supplied evidence IDs. Surface a finding only when the packet contains a meaningful abnormal signal; return an empty findings list when the supplied data does not support one. Do not manufacture anomalies to make the response active. Do not create a finding that merely restates an aggregate diagnostic status or lists diagnostic categories; name a specific observed condition and its concrete evidence, or omit it. Return at most 3 concise findings, each with a one-sentence summary and a short next step or null."""

CHAT_INSTRUCTION = """Answer only from the compact, question-focused charger packet and supplied findings. When sessions.focus.source is requested, the user named sessions.focus.requestedSessionId; use only sessions.focus.session if it is present, and if it is absent say that exact session ID is not in the loaded data. Never substitute the latest session for a specifically requested ID. For other focus sources, state whether the session was selected by the user or assumed to be the latest when that distinction helps answer the question. Compare sessions.focus.previous only when it is present. If the requested session or comparison data is absent, say so instead of guessing. Do not invent facts or claim unsupported causation. Prefer 1-3 concise sentences and never exceed 5 sentences. Return plain text only; do not reveal chain-of-thought."""

FINDINGS_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "maxItems": MAX_FINDINGS,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "importance": {"type": "string", "enum": ["high", "medium", "low"]},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "evidence": {
                        "type": "array",
                        "maxItems": MAX_MODEL_EVIDENCE,
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string", "enum": ["event", "session", "connector", "incident", "diagnostic"]},
                                "id": {"type": "string"},
                            },
                            "required": ["type", "id"],
                            "additionalProperties": False,
                        },
                    },
                    "nextStep": {"type": ["string", "null"]},
                },
                "required": ["id", "title", "summary", "importance", "confidence", "evidence", "nextStep"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["findings"],
    "additionalProperties": False,
}

_SECRET_KEY = re.compile(r"token|api.?key|secret|pin|password|credential|cookie|authorization|auth.?header", re.I)
_EVIDENCE_TYPES = {"event", "session", "connector", "incident", "diagnostic"}
_SESSION_SUMMARY_FIELDS = {
    "id", "status", "connectorId", "start", "end", "energyKwh", "diagnosis", "smartCharging",
    "stopReason", "authMode", "durationSeconds", "startDiagnosis", "endDiagnosis", "verdict",
    "eventCount", "importantEventCount",
}
_AGGREGATE_DIAGNOSTIC_SUMMARY = re.compile(
    r"^\s*diagnostics?\s+report(?:s)?\s+an?\s+(?:attention|pass|fail)\s+status\s+for\b",
    re.I,
)
_rate_windows = {}
_rate_lock = threading.Lock()


class SmartInvestigationError(Exception):
    def __init__(self, code, message, status=503, retry_after_seconds=None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.retry_after_seconds = retry_after_seconds


def _retry_after_seconds(exc):
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) or getattr(exc, "headers", None)
    raw_value = headers.get("Retry-After") if headers else None
    if raw_value:
        try:
            seconds = float(raw_value)
        except (TypeError, ValueError):
            try:
                retry_at = parsedate_to_datetime(str(raw_value))
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                seconds = retry_at.timestamp() - time.time()
            except (TypeError, ValueError, OverflowError):
                seconds = None
        if seconds is not None:
            return max(1, min(3600, math.ceil(seconds)))

    details = getattr(exc, "details", None)
    pending = [details]
    while pending:
        value = pending.pop()
        if isinstance(value, dict):
            retry_delay = value.get("retryDelay") or value.get("retry_delay")
            if isinstance(retry_delay, str):
                match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)s", retry_delay)
                if match:
                    return max(1, min(3600, math.ceil(float(match.group(1)))))
            pending.extend(value.values())
        elif isinstance(value, list):
            pending.extend(value)
    return None


_REASONING_MODELS = re.compile(r"(^|/)(openai/gpt-oss-|qwen)", re.I)


def _model_supports_reasoning(model):
    return bool(_REASONING_MODELS.search(model))


def _groq_error_body(exc):
    try:
        raw = exc.read()
        if not raw:
            return None
        decoded = json.loads(raw.decode("utf-8"))
        message = decoded.get("error", {}).get("message") if isinstance(decoded, dict) else None
        return message or json.dumps(decoded, ensure_ascii=False)
    except Exception:
        return None


def _provider_failure(exc):
    reason = getattr(exc, "reason", None)
    if isinstance(exc, (TimeoutError, socket.timeout)) or isinstance(reason, (TimeoutError, socket.timeout)) or exc.__class__.__name__ in {
        "TimeoutException", "ConnectTimeout", "ReadTimeout",
    }:
        return SmartInvestigationError("provider_timeout", "Smart investigation request timed out.", 504)
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    try:
        status = int(status)
    except (TypeError, ValueError):
        pass
    if status in (401, 403):
        return SmartInvestigationError("provider_auth", "Groq authentication failed. Check GROQ_API_KEY.", 503)
    if status == 400:
        detail = _groq_error_body(exc)
        message = "Groq rejected the request." + (f" {detail}" if detail else " The model or parameters may be unsupported.")
        return SmartInvestigationError("provider_invalid_request", message, 400)
    if status == 429:
        return SmartInvestigationError(
            "provider_rate_limited", "Groq API rate limit reached.", 429,
            _retry_after_seconds(exc),
        )
    if status == 503:
        return SmartInvestigationError(
            "provider_unavailable", "Groq is temporarily unavailable.", 503,
            _retry_after_seconds(exc),
        )
    return SmartInvestigationError("provider_unavailable", "Groq request failed.", 502)


def _json_size(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def estimate_tokens(value):
    encoded = value if isinstance(value, bytes) else json.dumps(
        value, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    return math.ceil(len(encoded) / 2)


def _reject_secret_fields(value, depth=0):
    if depth > 10:
        raise ValueError("Investigation context is too deeply nested.")
    if isinstance(value, dict):
        for key, child in value.items():
            if _SECRET_KEY.search(str(key)):
                raise ValueError("Investigation context contains a prohibited field.")
            _reject_secret_fields(child, depth + 1)
    elif isinstance(value, list):
        if len(value) > 300:
            raise ValueError("Investigation context contains too many items.")
        for child in value:
            _reject_secret_fields(child, depth + 1)
    elif isinstance(value, str) and len(value) > 4_000:
        raise ValueError("Investigation context contains an oversized value.")


def _require_fields(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError("Investigation packet contains unsupported fields.")


def _validate_session_summary(value):
    _require_fields(value, _SESSION_SUMMARY_FIELDS)
    if not isinstance(value.get("id"), str) or not value["id"] or len(value["id"]) > 200:
        raise ValueError("Investigation session summary is invalid.")
    for key, maximum in (
        ("status", 60), ("start", 40), ("end", 40), ("diagnosis", 120),
        ("stopReason", 100), ("authMode", 80), ("startDiagnosis", 80),
        ("endDiagnosis", 80), ("verdict", 300),
    ):
        item = value.get(key)
        if item is not None and (not isinstance(item, str) or len(item) > maximum):
            raise ValueError("Investigation session summary is invalid.")
    connector_id = value.get("connectorId")
    if connector_id is not None and (isinstance(connector_id, bool) or not isinstance(connector_id, (str, int))):
        raise ValueError("Investigation session summary is invalid.")
    for key in ("energyKwh", "durationSeconds"):
        item = value.get(key)
        if item is not None and (
            isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item)
        ):
            raise ValueError("Investigation session summary is invalid.")
    if "smartCharging" in value and not isinstance(value["smartCharging"], bool):
        raise ValueError("Investigation session summary is invalid.")
    for key in ("eventCount", "importantEventCount"):
        item = value.get(key)
        if item is not None and (isinstance(item, bool) or not isinstance(item, int) or not 0 <= item <= 300):
            raise ValueError("Investigation session summary is invalid.")


def validate_context(context):
    if not isinstance(context, dict):
        raise ValueError("Investigation packet is required.")
    allowed = {"version", "serialNumber", "range", "status", "events", "sessions", "connectors", "incidents", "patterns", "diagnostics", "power", "quality", "evidence"}
    if set(context) - allowed:
        raise ValueError("Investigation packet contains unsupported fields.")
    serial = context.get("serialNumber")
    if not isinstance(serial, str) or not re.fullmatch(r"TACW[A-Za-z0-9]{10,12}", serial):
        raise ValueError("A valid charger serial number is required.")
    if context.get("version") != 1:
        raise ValueError("Investigation packet version is invalid.")
    if not isinstance(context.get("range"), dict):
        raise ValueError("Investigation time range is invalid.")
    for key in ("start", "end"):
        value = context["range"].get(key)
        if not isinstance(value, str) or len(value) > 40:
            raise ValueError("Investigation time range is invalid.")
    limits = {
        "connectors": 8,
        "incidents": 6,
        "patterns": 8,
        "evidence": 24,
        "diagnostics": 8,
    }
    for key, maximum in limits.items():
        value = context.get(key, [])
        if not isinstance(value, list) or len(value) > maximum:
            raise ValueError("Investigation context structure is invalid.")
    for key in ("status", "power", "events", "sessions", "quality"):
        if not isinstance(context.get(key), dict):
            raise ValueError("Investigation packet structure is invalid.")
    _require_fields(context["status"], {"connectivity", "chargerHealth", "connectivityCheck", "disconnects", "reconnects", "activeErrors", "smartCharging"})
    _require_fields(context["events"], {"count", "source", "topNames"})
    _require_fields(context["sessions"], {"count", "source", "statusCounts", "selected", "focus"})
    _require_fields(context["power"], {"configuredMaximumPower", "activeChargingLimit", "measuredChargingPower", "source"})
    _require_fields(context["quality"], {"diagnosticStatus", "completeness", "eventsInRange", "invalidTimestamps", "missingSources"})
    if set(context["range"]) - {"start", "end"}:
        raise ValueError("Investigation time range is invalid.")
    if not isinstance(context["events"].get("topNames", []), list) or len(context["events"].get("topNames", [])) > 8:
        raise ValueError("Investigation event summary is invalid.")
    if not isinstance(context["sessions"].get("selected", []), list) or len(context["sessions"].get("selected", [])) > 6:
        raise ValueError("Investigation session summary is invalid.")
    entries = [
        ("connectors", {"id", "state", "faultCount", "availability", "coverage", "downtimeMs"}),
        ("incidents", {"id", "start", "groups", "eventCount", "connectors"}),
        ("patterns", {"category", "count"}),
        ("diagnostics", {"id", "status", "summary"}),
        ("evidence", {"type", "id", "timestamp", "summary"}),
    ]
    for key, allowed_fields in entries:
        for entry in context.get(key, []):
            _require_fields(entry, allowed_fields)
    for entry in context["events"].get("topNames", []):
        _require_fields(entry, {"name", "count"})
    for entry in context["sessions"].get("selected", []):
        _validate_session_summary(entry)
    if "focus" in context["sessions"]:
        focus = context["sessions"]["focus"]
        _require_fields(focus, {"source", "session", "previous", "requestedSessionId"})
        if focus.get("source") not in {"requested", "selected", "latest", "none"}:
            raise ValueError("Investigation session focus is invalid.")
        focused_session = focus.get("session")
        previous_session = focus.get("previous")
        requested_id = focus.get("requestedSessionId")
        if focus["source"] == "requested":
            if not isinstance(requested_id, str) or not requested_id or len(requested_id) > 200:
                raise ValueError("Investigation session focus is invalid.")
            if focused_session is not None and focused_session.get("id") != requested_id:
                raise ValueError("Investigation session focus is invalid.")
        elif requested_id is not None:
            raise ValueError("Investigation session focus is invalid.")
        if focused_session is not None:
            _validate_session_summary(focused_session)
        if previous_session is not None:
            _validate_session_summary(previous_session)
        if focus["source"] != "requested" and (focus["source"] == "none") != (focused_session is None):
            raise ValueError("Investigation session focus is invalid.")
    _reject_secret_fields(context)
    prompt = {"packet": context}
    prompt_bytes = _json_size(prompt) + len(SYSTEM_INSTRUCTION.encode("utf-8"))
    if prompt_bytes > MAX_CONTEXT_BYTES or estimate_tokens(prompt) + estimate_tokens(SYSTEM_INSTRUCTION) > MAX_INPUT_TOKENS:
        raise ValueError("Investigation packet exceeds the 8,000-token maximum.")
    evidence = context.get("evidence", [])
    if not isinstance(evidence, list) or len(evidence) > 24:
        raise ValueError("Investigation evidence is invalid.")
    for item in evidence:
        if not isinstance(item, dict) or item.get("type") not in _EVIDENCE_TYPES:
            raise ValueError("Investigation evidence is invalid.")
        if not isinstance(item.get("id"), str) or not item["id"] or len(item["id"]) > 200:
            raise ValueError("Investigation evidence is invalid.")
        if not isinstance(item.get("summary"), str) or len(item["summary"]) > 240:
            raise ValueError("Investigation evidence is invalid.")
        timestamp = item.get("timestamp")
        if timestamp is not None and (not isinstance(timestamp, str) or len(timestamp) > 40):
            raise ValueError("Investigation evidence is invalid.")
    return context


def context_hash(context):
    canonical = json.dumps(context, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_findings(findings, context):
    if not isinstance(findings, list) or len(findings) > MAX_FINDINGS:
        raise ValueError("Investigation findings are invalid.")
    available = {
        (item["type"], item["id"]): item
        for item in context.get("evidence", [])
    }

    def add_summary_source(kind, item, timestamp, summary):
        identifier = item.get("id")
        if identifier is None:
            return
        identifier = str(identifier)
        available[(kind, identifier)] = {
            "type": kind,
            "id": identifier,
            "timestamp": timestamp if isinstance(timestamp, str) and len(timestamp) <= 40 else None,
            "summary": str(summary)[:240],
        }

    for item in context.get("sessions", {}).get("selected", []):
        add_summary_source(
            "session", item, item.get("end") or item.get("start"),
            f"{item.get('status', 'Unknown')} session; connector {item.get('connectorId', 'unknown')}",
        )
    focus = context.get("sessions", {}).get("focus", {})
    for key in ("session", "previous"):
        item = focus.get(key) if isinstance(focus, dict) else None
        if item:
            add_summary_source(
                "session", item, item.get("end") or item.get("start"),
                f"{item.get('status', 'Unknown')} session; connector {item.get('connectorId', 'unknown')}"
                + (f"; stop reason {item['stopReason']}" if item.get("stopReason") else ""),
            )
    for item in context.get("connectors", []):
        add_summary_source(
            "connector", item, None,
            f"Connector {item.get('id')} {item.get('state', 'Unknown')}; {item.get('faultCount', 0)} faults",
        )
    for item in context.get("incidents", []):
        add_summary_source(
            "incident", item, item.get("start"),
            f"{', '.join(item.get('groups', []))} incident; {item.get('eventCount', 0)} events",
        )
    for item in context.get("diagnostics", []):
        add_summary_source(
            "diagnostic", item, None,
            f"{item.get('status', 'Unknown')}: {item.get('summary', '')}",
        )
    normalized = []
    for finding in findings:
        if not isinstance(finding, dict):
            raise ValueError("Investigation findings are invalid.")
        title = finding.get("title")
        summary = finding.get("summary")
        importance = finding.get("importance")
        confidence = finding.get("confidence")
        if not isinstance(title, str) or not title.strip() or not isinstance(summary, str) or not summary.strip():
            raise ValueError("Investigation findings are invalid.")
        if importance not in {"high", "medium", "low"} or confidence not in {"high", "medium", "low"}:
            raise ValueError("Investigation findings are invalid.")
        evidence = finding.get("evidence")
        if not isinstance(evidence, list):
            raise ValueError("Investigation findings are invalid.")
        verified = []
        for reference in evidence:
            if not isinstance(reference, dict):
                continue
            source = available.get((reference.get("type"), str(reference.get("id", ""))))
            if source and source not in verified:
                verified.append(source)
            if len(verified) == MAX_EVIDENCE:
                break
        if not verified:
            continue
        if (
            all(item["type"] == "diagnostic" for item in verified)
            and _AGGREGATE_DIAGNOSTIC_SUMMARY.search(summary)
        ):
            continue
        next_step = finding.get("nextStep")
        normalized.append({
            "id": str(finding.get("id") or f"finding-{len(normalized) + 1}")[:100],
            "title": title.strip()[:120],
            "summary": summary.strip()[:500],
            "importance": importance,
            "confidence": confidence,
            "evidenceCount": len(verified),
            "evidence": verified,
            "nextStep": next_step.strip()[:240] if isinstance(next_step, str) and next_step.strip() else None,
        })
        if len(normalized) == MAX_FINDINGS:
            break
    return normalized


def limit_sentences(answer, maximum=5):
    if not isinstance(answer, str):
        return ""
    text = re.sub(r"\s+", " ", answer).strip()
    if not text:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    return " ".join(sentences[:maximum])[:2_000].strip()


def _take_rate_limit(identity):
    now = time.monotonic()
    with _rate_lock:
        recent = [stamp for stamp in _rate_windows.get(identity, []) if now - stamp < RATE_LIMIT_WINDOW_SECONDS]
        if len(recent) >= RATE_LIMIT_REQUESTS:
            _rate_windows[identity] = recent
            return max(1, math.ceil(RATE_LIMIT_WINDOW_SECONDS - (now - recent[0])))
        recent.append(now)
        _rate_windows[identity] = recent
        return None


def _generate(contents, system_instruction, response_schema=None):
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        raise SmartInvestigationError("not_configured", "Set GROQ_API_KEY to enable Smart Investigations.", 503)
    model = os.environ.get("GROQ_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": json.dumps(contents, ensure_ascii=False, separators=(",", ":"))},
    ]
    request_body = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_completion_tokens": 1_200,
        "stream": False,
    }
    if _model_supports_reasoning(model):
        request_body["reasoning_effort"] = "low"
    if response_schema:
        request_body["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "charger_findings", "schema": response_schema},
        }
    request = Request(
        GROQ_ENDPOINT,
        data=json.dumps(request_body, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "ChargerDashboard/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            decoded = json.loads(response.read(64_000).decode("utf-8"))
    except HTTPError as exc:
        raise _provider_failure(exc) from exc
    except (URLError, TimeoutError, socket.timeout) as exc:
        raise _provider_failure(exc) from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SmartInvestigationError("invalid_response", "Groq returned an invalid response.", 502) from exc
    try:
        return decoded["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise SmartInvestigationError("invalid_response", "Groq returned an invalid response.", 502) from exc


def generate_findings(context, identity="local"):
    validate_context(context)
    retry_after = _take_rate_limit(identity)
    if retry_after is not None:
        raise SmartInvestigationError(
            "local_rate_limited", "Dashboard AI request limit reached.", 429, retry_after
        )
    digest = context_hash(context)
    for attempt in range(2):
        raw = _generate({"packet": context}, SYSTEM_INSTRUCTION, FINDINGS_SCHEMA)
        try:
            decoded = json.loads(raw)
            if not isinstance(decoded, dict) or not isinstance(decoded.get("findings"), list):
                raise ValueError("Structured findings response is invalid.")
            findings = validate_findings(decoded["findings"][:MAX_FINDINGS], context)
            return {"findings": findings, "contextHash": digest}
        except (TypeError, json.JSONDecodeError, ValueError) as exc:
            if attempt == 1:
                raise SmartInvestigationError("invalid_response", "Smart investigation unavailable.", 502) from exc


def answer_question(context, findings, question, identity="local"):
    validate_context(context)
    if not isinstance(question, str) or not question.strip() or len(question) > MAX_QUESTION_LENGTH:
        raise ValueError(f"Question is required and must be {MAX_QUESTION_LENGTH} characters or fewer.")
    safe_findings = validate_findings(findings, context)
    prompt = {
        "packet": context,
        "findings": [
            {
                "id": finding["id"],
                "title": finding["title"],
                "summary": finding["summary"],
                "importance": finding["importance"],
                "confidence": finding["confidence"],
                "evidence": [{"type": item["type"], "id": item["id"]} for item in finding["evidence"]],
                "nextStep": finding["nextStep"],
            }
            for finding in safe_findings
        ],
        "question": question.strip(),
    }
    if estimate_tokens(prompt) + estimate_tokens(CHAT_INSTRUCTION) > MAX_INPUT_TOKENS:
        raise ValueError("Chat request exceeds the 8,000-token maximum.")
    retry_after = _take_rate_limit(identity)
    if retry_after is not None:
        raise SmartInvestigationError(
            "local_rate_limited", "Dashboard AI request limit reached.", 429, retry_after
        )
    raw = _generate(prompt, CHAT_INSTRUCTION)
    answer = limit_sentences(raw)
    if not answer:
        raise SmartInvestigationError("invalid_response", "Unable to answer this question.", 502)
    return {"answer": answer}