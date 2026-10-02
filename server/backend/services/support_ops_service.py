import json
import re
from datetime import datetime, timezone
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request

from backend.config import get_env_config, normalize_env
from backend.services.outages_service import get_webapp_origin

def _extract_channel_data(payload):
    if not isinstance(payload, dict):
        return None

    data = payload.get("data")
    if not isinstance(data, dict):
        return None

    channel_data = data.get("channelData")
    if channel_data is None:
        return None
    if isinstance(channel_data, str):
        return channel_data.strip() or None
    return channel_data


def _extract_channel_status(payload):
    if not isinstance(payload, dict):
        return None

    data = payload.get("data")
    status = data.get("status") if isinstance(data, dict) else None
    if status is None:
        status = payload.get("status")
    return str(status).strip().upper() if status is not None else None


SUPPORT_OPERATION_SPECS = {
    "alignPin": {
        "method": "PATCH",
        "path": "/v2/wallbox-management/wallboxes/{serial}/pin",
        "client_id": "support",
        "body_fields": ("ownerPin",),
    },
    "removePendingRemoteOperation": {
        "method": "DELETE",
        "path": "/v2/remote-operations/wallboxes/{serial}/pending-operation",
        "client_id": "ctp",
        "body_fields": (),
    },
    "removePendingChargingSession": {
        "method": "DELETE",
        "path": "/v2/charging-session-management/wallboxes/{serial}/pending-charging-session",
        "client_id": "ctp",
        "body_fields": (),
    },
    "removePendingRFID": {
        "method": "DELETE",
        "path": "/v1/accesses/{serial}/rfid",
        "client_id": "ctp",
        "query_serial": True,
        "body_fields": (),
    },
    "pushFirmware": {
        "method": "POST",
        "path": "/v1/wallboxes/{serial}/update-firmware",
        "client_id": None,
        "body_fields": ("location", "retrieveDate"),
    },
}


def _get_support_operation_context(operation, serial_number, token, parameters=None, env="prod"):
    spec = SUPPORT_OPERATION_SPECS.get(operation)
    if not spec:
        raise ValueError("Unsupported support operation.")

    serial_number = str(serial_number or "").strip()
    if not re.fullmatch(r"TACW[A-Za-z0-9]{10,12}", serial_number):
        raise ValueError("A valid selected charger serial number is required.")
    token = str(token or "").strip()
    if not token:
        raise ValueError("An authenticated TME session is required.")

    parameters = parameters if isinstance(parameters, dict) else {}
    body = {}
    for field in spec["body_fields"]:
        value = parameters.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field} is required.")
        body[field] = value.strip()

    if operation == "pushFirmware":
        location = urlparse(body["location"])
        if location.scheme != "https" or not location.netloc:
            raise ValueError("Firmware location must be an HTTPS URL.")
        try:
            retrieve_date = datetime.fromisoformat(body["retrieveDate"].replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("Firmware retrieve date must be an ISO-8601 UTC datetime.") from exc
        if not body["retrieveDate"].endswith("Z") or retrieve_date.utcoffset() != timezone.utc.utcoffset(None):
            raise ValueError("Firmware retrieve date must be an ISO-8601 UTC datetime ending in Z.")

    path = spec["path"].format(serial=quote(serial_number, safe=""))
    return {
        "operation": operation,
        "serialNumber": serial_number,
        "token": token,
        "baseUrl": get_env_config(env)["api_host"],
        "clientId": spec["client_id"],
        "method": spec["method"],
        "path": path,
        "querySerial": spec.get("query_serial", False),
        "parameters": body,
        "env": normalize_env(env),
    }


def _build_support_operation_request(operation, serial_number, token, parameters=None, env="prod"):
    context = _get_support_operation_context(operation, serial_number, token, parameters, env)
    target_url = context["baseUrl"] + context["path"]
    if context["querySerial"]:
        target_url += "?" + urlencode({"serialNumber": context["serialNumber"]})
    origin = get_webapp_origin(context["env"])
    headers = {
        "Authorization": f"Bearer {context['token']}",
        "Origin": origin,
        "Referer": f"{origin}/",
    }
    if context["clientId"]:
        headers["clientId"] = context["clientId"]
    request_body = json.dumps(context["parameters"]).encode("utf-8") if context["parameters"] else None
    if context["parameters"]:
        headers["Content-Type"] = "application/json"
    return Request(target_url, data=request_body, headers=headers, method=context["method"])


def _support_response_payload(response_body):
    if not response_body:
        return None, False
    text = response_body.decode("utf-8", errors="replace")
    try:
        return json.loads(text), False
    except json.JSONDecodeError:
        return {"message": text}, True


def _sanitize_support_response(value, secrets):
    sensitive_key = re.compile(r"authorization|bearer|token|secret|owner.?pin|password|credential|firmware.?location", re.I)
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if sensitive_key.search(str(key))
            else _sanitize_support_response(item, secrets)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_support_response(item, secrets) for item in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[REDACTED]")
    return value


def _support_response_message(payload, http_status):
    if isinstance(payload, dict):
        for key in ("message", "detail", "error", "title"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return f"TME API returned HTTP {http_status}."


def _classify_support_response(operation, http_status, message):
    pending_operations = {"removePendingRemoteOperation", "removePendingChargingSession", "removePendingRFID"}
    no_pending_pattern = re.compile(
        r"(?:no|none|not\s+found|does\s+not\s+exist|not\s+present).{0,60}pending|pending.{0,60}(?:not\s+found|does\s+not\s+exist|not\s+present)",
        re.I,
    )
    if operation in pending_operations and no_pending_pattern.search(message):
        return "NO_ACTION_REQUIRED"
    if 200 <= http_status < 300:
        return "ACCEPTED"
    if 400 <= http_status < 500:
        return "REJECTED"
    return "FAILED"
