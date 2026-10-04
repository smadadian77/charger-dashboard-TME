"""Read-only ChargeDot manufacturer data client for ABB chargers."""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

CHARGEDOT_BASE_URL = "https://abb-api.chargedot.com/evci"
CHARGEDOT_PUBLIC_KEY = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs0SmpwdrWwii7vK9AtB2aoFfLUi40g8cYoBRml611c6s/9l6a5Xmg1g/zzPvKhFz0gYjvOArw3mkHwrU53f92kL88mrLPA2AVvRTHmQ6oTW/jkxhNrJb6UFqZLmVSJUC4CE2hspMnNK66ju38xwNDsJi9PNwvmIocxWvoAwqEc91VV134lTAjsuDXPLE8caDk3/LtLkfcZN7Xb7Q1+1EnXNYhcmFZgFhOjgmGRSVq82eKRp5wFMKfh1ir12vphWtHj1DalRWTRpljPO1mtmLyyx/5sakx8vSF6pVUbw32XB+sCWevbaQ1C+WZtzCVdMIoFtI3Bvb+5iVxgZd4n9/uQIDAQAB"
)
REQUEST_TIMEOUT_SECONDS = 20
TOKEN_CACHE_SECONDS = 300
DATA_CACHE_SECONDS = 30
ALLOWED_FIELDS = (
    "serialNumber",
    "siteId",
    "model",
    "firmwareVersion",
    "hardwareVersion",
    "hardwareModel",
    "ratedPower",
    "ratedCurrent",
    "netModule",
    "protocolType",
    "protocolVersion",
    "partNumber",
)
SENSITIVE_FIELDS = (
    "pinCode",
    "imei",
    "iccid",
    "preProgrammedRfidCards",
)
SERIAL_PATTERN = re.compile(r"^TACW[A-Z0-9]{10,12}$", re.IGNORECASE)


class ChargeDotError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


_TOKEN_LOCK = threading.Lock()
_TOKEN_VALUE = ""
_TOKEN_EXPIRES_AT = 0.0
_DATA_LOCK = threading.Lock()
_DATA_CACHE = {}


def _configuration():
    client_id = os.environ.get("CHARGEDOT_CLIENT_ID", "").strip()
    client_secret = os.environ.get("CHARGEDOT_CLIENT_SECRET", "").strip()
    organization_id = os.environ.get("CHARGEDOT_ORG_ID", "").strip()
    if not client_id or not client_secret or not organization_id:
        raise ChargeDotError(
            503,
            "ChargeDot credentials are not configured on the dashboard server.",
        )
    return client_id, client_secret, organization_id


def _multipart_body(fields, boundary):
    parts = []
    for name, value in fields.items():
        parts.extend((
            f"--{boundary}\r\n".encode("ascii"),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("ascii"),
            str(value).encode("utf-8"),
            b"\r\n",
        ))
    parts.append(f"--{boundary}--\r\n".encode("ascii"))
    return b"".join(parts)


def _request_json(request):
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise ChargeDotError(502, f"ChargeDot rejected the request (HTTP {exc.code}).") from None
        if exc.code == 404:
            raise ChargeDotError(404, "No ChargeDot record was found for this charger.") from None
        raise ChargeDotError(502, f"ChargeDot request failed (HTTP {exc.code}).") from None
    except (URLError, TimeoutError, OSError):
        raise ChargeDotError(502, "ChargeDot could not be reached.") from None
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ChargeDotError(502, "ChargeDot returned an invalid response.") from None
    if not isinstance(payload, dict):
        raise ChargeDotError(502, "ChargeDot returned an invalid response.")
    return payload


def _get_access_token(client_id, client_secret):
    global _TOKEN_VALUE, _TOKEN_EXPIRES_AT

    with _TOKEN_LOCK:
        now = time.monotonic()
        if _TOKEN_VALUE and now < _TOKEN_EXPIRES_AT:
            return _TOKEN_VALUE

        boundary = f"--------------------------{secrets.token_hex(12)}"
        body = _multipart_body({
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }, boundary)
        request = Request(
            f"{CHARGEDOT_BASE_URL}/auth/oauth/token",
            data=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(len(body)),
                "Accept": "application/json",
            },
            method="POST",
        )
        payload = _request_json(request)
        access_token = str(payload.get("access_token", "") or "").strip()
        if not access_token:
            raise ChargeDotError(502, "ChargeDot authentication returned no access token.")

        try:
            lifetime = float(payload.get("expires_in", TOKEN_CACHE_SECONDS))
        except (TypeError, ValueError):
            lifetime = TOKEN_CACHE_SECONDS
        _TOKEN_VALUE = access_token
        _TOKEN_EXPIRES_AT = now + max(30, min(lifetime - 30, 3600))
        return _TOKEN_VALUE


def _load_public_key():
    pem = (
        "-----BEGIN PUBLIC KEY-----\n"
        + CHARGEDOT_PUBLIC_KEY
        + "\n-----END PUBLIC KEY-----"
    ).encode("ascii")
    try:
        key = serialization.load_pem_public_key(pem)
    except (TypeError, ValueError):
        raise ChargeDotError(500, "ChargeDot public-key configuration is invalid.") from None
    if not isinstance(key, rsa.RSAPublicKey):
        raise ChargeDotError(500, "ChargeDot public-key configuration is invalid.")
    return key


def _build_signed_query(public_key, serial_number):
    random_value = secrets.token_hex(16)
    timestamp = int(time.time())
    source_data = json.dumps({}, separators=(",", ":"))
    request_data = json.dumps({
        "timestamp": timestamp,
        "random": random_value,
        "data": source_data,
    }, separators=(",", ":"))
    encrypted = public_key.encrypt(request_data.encode("utf-8"), padding.PKCS1v15())
    encrypted_text = base64.b64encode(encrypted).decode("ascii")
    signature = hmac.new(
        CHARGEDOT_PUBLIC_KEY.encode("ascii"),
        request_data.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return random_value, timestamp, quote(encrypted_text, safe=""), signature


def _recover_pkcs1_v1_5(public_key, encrypted_response):
    numbers = public_key.public_numbers()
    chunk_size = (public_key.key_size + 7) // 8
    if not encrypted_response or len(encrypted_response) % chunk_size:
        raise ChargeDotError(502, "ChargeDot returned an invalid encrypted response.")

    plaintext = bytearray()
    for offset in range(0, len(encrypted_response), chunk_size):
        chunk = encrypted_response[offset:offset + chunk_size]
        ciphertext = int.from_bytes(chunk, "big")
        if ciphertext >= numbers.n:
            raise ChargeDotError(502, "ChargeDot returned an invalid encrypted response.")
        encoded = pow(ciphertext, numbers.e, numbers.n).to_bytes(chunk_size, "big")
        if encoded[:2] != b"\x00\x01":
            raise ChargeDotError(502, "ChargeDot response decryption failed.")
        separator = encoded.find(b"\x00", 2)
        if separator < 10 or any(value != 0xFF for value in encoded[2:separator]):
            raise ChargeDotError(502, "ChargeDot response decryption failed.")
        plaintext.extend(encoded[separator + 1:])
    return bytes(plaintext)


def _decode_response(encrypted_body, public_key):
    try:
        encrypted_response = base64.b64decode(encrypted_body.strip(), validate=True)
        plaintext = _recover_pkcs1_v1_5(public_key, encrypted_response)
        payload = json.loads(plaintext.decode("utf-8"))
        if isinstance(payload, dict) and "result" in payload:
            result = payload["result"]
            payload = json.loads(result) if isinstance(result, str) else result
    except ChargeDotError:
        raise
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        raise ChargeDotError(502, "ChargeDot response could not be decoded.") from None
    if not isinstance(payload, dict):
        raise ChargeDotError(502, "ChargeDot returned an invalid charger record.")
    return payload


def _public_record(payload, serial_number):
    record = {key: payload[key] for key in ALLOWED_FIELDS if key in payload}
    record["serialNumber"] = str(record.get("serialNumber") or serial_number)
    sensitive_data = {key: payload[key] for key in SENSITIVE_FIELDS if key in payload}
    record["sensitiveData"] = sensitive_data
    cards = sensitive_data.get("preProgrammedRfidCards")
    if isinstance(cards, list):
        record["preProgrammedRfidCardCount"] = len(cards)
    record["manufacturer"] = "ChargeDot"
    return record


def get_charger_data(serial_number):
    serial = str(serial_number or "").strip().upper()
    if not SERIAL_PATTERN.fullmatch(serial):
        raise ChargeDotError(400, "Enter a valid charger serial number.")

    cache_key = serial
    now = time.monotonic()
    with _DATA_LOCK:
        cached = _DATA_CACHE.get(cache_key)
        if cached and now < cached[0]:
            return dict(cached[1])

    client_id, client_secret, organization_id = _configuration()
    token = _get_access_token(client_id, client_secret)
    public_key = _load_public_key()
    random_value, timestamp, encrypted_params, signature = _build_signed_query(public_key, serial)
    path = (
        f"/ev-charging/v1/orgs/{quote(organization_id, safe='')}"
        f"/chargers/{quote(serial, safe='')}?params={encrypted_params}"
    )
    request = Request(
        f"{CHARGEDOT_BASE_URL}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "*/*",
            "a": "2001",
            "r": random_value,
            "d": str(timestamp * 1000),
            "c": signature,
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            encrypted_body = response.read().decode("utf-8")
    except HTTPError as exc:
        if exc.code == 404:
            raise ChargeDotError(404, "No ChargeDot record was found for this charger.") from None
        if exc.code in (401, 403):
            raise ChargeDotError(502, f"ChargeDot rejected the request (HTTP {exc.code}).") from None
        raise ChargeDotError(502, f"ChargeDot request failed (HTTP {exc.code}).") from None
    except (URLError, TimeoutError, OSError):
        raise ChargeDotError(502, "ChargeDot could not be reached.") from None

    record = _public_record(_decode_response(encrypted_body, public_key), serial)
    with _DATA_LOCK:
        _DATA_CACHE[cache_key] = (time.monotonic() + DATA_CACHE_SECONDS, record)
    return dict(record)