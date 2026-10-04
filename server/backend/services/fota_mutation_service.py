"""FOTA mutation adapter restricted to explicitly configured loopback targets."""

import json
import ipaddress
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


MUTATION_TIMEOUT_SECONDS = 20
ALLOWED_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
DEFAULT_LOCAL_APP_ORIGINS = {
    "http://localhost:4200",
    "http://127.0.0.1:4200",
    "http://[::1]:4200",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://[::1]:8000",
}
SERIAL_PATTERN = re.compile(r"TACW[A-Za-z0-9]{10,12}")


class FotaMutationError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


def mutation_capabilities():
    enabled = os.environ.get("FOTA_MUTATIONS_ENABLED", "").strip().lower() == "true"
    base_url = os.environ.get("FOTA_MUTATION_BASE_URL", "").strip().rstrip("/")
    target_configured = _is_loopback_target(base_url)
    return {
        "enabled": enabled and target_configured,
        "targetConfigured": target_configured,
        "reason": None if enabled and target_configured else "Mutations require FOTA_MUTATIONS_ENABLED=true and a loopback FOTA_MUTATION_BASE_URL.",
    }


def _is_loopback_target(base_url):
    if not base_url:
        return False
    parsed = urlparse(base_url)
    return parsed.scheme in {"http", "https"} and parsed.hostname in ALLOWED_LOCAL_HOSTS


def is_loopback_local_request(remote_address, origin):
    try:
        if not ipaddress.ip_address(remote_address).is_loopback:
            return False
    except ValueError:
        return False

    if not origin:
        return True
    parsed_origin = urlparse(origin)
    if (
        parsed_origin.scheme != "http"
        or parsed_origin.hostname not in ALLOWED_LOCAL_HOSTS
        or parsed_origin.username
        or parsed_origin.password
        or parsed_origin.path not in {"", "/"}
        or parsed_origin.query
        or parsed_origin.fragment
    ):
        return False

    configured_origins = os.environ.get("LOCAL_APP_ORIGINS", "")
    allowed_origins = {
        value.strip().rstrip("/")
        for value in configured_origins.split(",")
        if value.strip()
    } or DEFAULT_LOCAL_APP_ORIGINS
    return origin.rstrip("/") in allowed_origins


def _required_text(payload, key):
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise FotaMutationError(400, f"{key} is required.")
    return value.strip()


def _build_mutation_spec(operation, payload):
    if operation == "firmware-readiness":
        version = quote(_required_text(payload, "version"), safe="")
        model = quote(_required_text(payload, "model"), safe="")
        beta = payload.get("beta")
        if not isinstance(beta, bool):
            raise FotaMutationError(400, "beta must be a boolean.")
        enabled = payload.get("enabled")
        if not isinstance(enabled, bool):
            raise FotaMutationError(400, "enabled must be a boolean.")
        action = "enable" if enabled else "disable"
        path = f"/v1/wallboxes/firmware/{version}/{model}/{str(beta).lower()}/{action}"
        return "POST", path, {}, "ctp"

    if operation in {"archive-beta-firmware", "restore-beta-firmware"}:
        version = quote(_required_text(payload, "version"), safe="")
        model = quote(_required_text(payload, "model"), safe="")
        beta = payload.get("beta")
        if not isinstance(beta, bool):
            raise FotaMutationError(400, "beta must be a boolean.")
        action = "archive" if operation == "archive-beta-firmware" else "restore"
        path = f"/v1/firmware/{version}/model/{model}/beta/{str(beta).lower()}/{action}"
        if action == "restore":
            return "POST", path, {}, None
        reason = _required_text(payload, "archivingReason")
        return "POST", path, {"archivingReason": reason}, None

    if operation == "approve-beta-firmware":
        version = quote(_required_text(payload, "version"), safe="")
        model = quote(_required_text(payload, "model"), safe="")
        beta = payload.get("beta")
        if not isinstance(beta, bool):
            raise FotaMutationError(400, "beta must be a boolean.")
        report_uri = payload.get("testReportUri")
        if report_uri is not None and not isinstance(report_uri, str):
            raise FotaMutationError(400, "testReportUri must be a string or null.")
        return "PATCH", f"/v2/fota-management/firmware/{version}/{model}/{str(beta).lower()}/approval-status-update", {
            "approvalStatus": "TESTED",
            "testReportUri": report_uri or None,
        }, "ctp"

    if operation in {"create-campaign", "create-beta-campaign"}:
        version = quote(_required_text(payload, "firmwareVersion"), safe="")
        campaign = payload.get("campaign")
        if not isinstance(campaign, dict):
            raise FotaMutationError(400, "campaign must be an object.")
        beta_campaign = operation == "create-beta-campaign"
        vendor_campaign = not beta_campaign and campaign.get("vendor") == "COMPLEO"
        allowed_fields = (
            {"model", "betaWallboxesList", "directPush", "childrenVersions"}
            if beta_campaign else {"model", "vendor", "countryId", "childrenVersions"}
        )
        if set(campaign) - allowed_fields:
            raise FotaMutationError(400, "Campaign contains unsupported fields.")
        model = campaign.get("model")
        if vendor_campaign:
            if model is not None and (not isinstance(model, str) or not model.strip()):
                raise FotaMutationError(400, "Compleo campaign model must be omitted or non-empty.")
        elif not isinstance(model, str) or not model.strip():
            raise FotaMutationError(400, "Campaign model is required.")
        if not beta_campaign and campaign.get("vendor") not in (None, "COMPLEO"):
            raise FotaMutationError(400, "Unsupported campaign vendor.")
        if beta_campaign and not isinstance(campaign.get("betaWallboxesList", []), list):
            raise FotaMutationError(400, "betaWallboxesList must be an array.")
        if not beta_campaign and not isinstance(campaign.get("countryId"), (str, type(None))):
            raise FotaMutationError(400, "countryId must be a string or null.")
        endpoint = (
            f"/v2/fota-management/firmware/{version}/beta-campaign" if beta_campaign
            else f"/v2/fota-management/firmware/{version}/campaign" if vendor_campaign
            else f"/v1/firmware/{version}/campaign"
        )
        return "POST", endpoint, campaign, "ctp"

    if operation == "create-software-catalog":
        vendor = _required_text(payload, "vendor")
        version = _required_text(payload, "version")
        model = _required_text(payload, "model")
        s3_uri = _required_text(payload, "s3Uri")
        release_notes_url = payload.get("releaseNotesUrl", "")
        beta = payload.get("beta", False)
        if not isinstance(release_notes_url, str) or not isinstance(beta, bool):
            raise FotaMutationError(400, "releaseNotesUrl or beta has an invalid type.")
        return "POST", "/v1/firmware", {
            "vendor": vendor,
            "version": version,
            "model": model,
            "s3Uri": s3_uri,
            "firmwareUri": "",
            "releaseNotesUrl": release_notes_url,
            "beta": beta,
        }, "ctp"

    if operation in {"beta-wallbox-add", "beta-wallbox-remove"}:
        serial = _required_text(payload, "serialNumber").upper()
        if not SERIAL_PATTERN.fullmatch(serial):
            raise FotaMutationError(400, "A valid charger serial number is required.")
        action = "add" if operation == "beta-wallbox-add" else "remove"
        return "PATCH", f"/v2/fota-management/wallboxes/{quote(serial, safe='')}/{action}-beta-wallbox", "", None

    raise FotaMutationError(400, "Unsupported FOTA mutation.")


def _validate_mutation_target(base_url):
    parsed = urlparse(base_url)
    if not _is_loopback_target(base_url):
        raise FotaMutationError(403, "FOTA mutations are restricted to an explicitly configured loopback mock target.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise FotaMutationError(400, "FOTA mutation target must not contain credentials, query, or fragment data.")


def execute_local_mutation(operation, payload):
    capabilities = mutation_capabilities()
    if not capabilities["enabled"]:
        raise FotaMutationError(403, capabilities["reason"])

    base_url = os.environ["FOTA_MUTATION_BASE_URL"].strip().rstrip("/")
    _validate_mutation_target(base_url)
    method, path, body, client_id = _build_mutation_spec(operation, payload)
    request_body = None if body is None else body.encode("utf-8") if isinstance(body, str) else json.dumps(body, separators=(",", ":")).encode("utf-8")
    headers = {"Accept": "application/json, text/plain, */*"}
    if request_body is not None:
        headers["Content-Type"] = "text/plain; charset=utf-8" if isinstance(body, str) else "application/json"
    if client_id:
        headers["clientId"] = client_id
    request = Request(f"{base_url}{path}", data=request_body, headers=headers, method=method)

    try:
        with urlopen(request, timeout=MUTATION_TIMEOUT_SECONDS) as response:
            content = response.read()
            decoded = json.loads(content.decode("utf-8")) if content else None
            return {"status": response.status, "response": decoded}
    except HTTPError as exc:
        raise FotaMutationError(exc.code, "Local FOTA mock target rejected the mutation.") from None
    except (URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise FotaMutationError(502, "Local FOTA mock target could not complete the mutation.") from None