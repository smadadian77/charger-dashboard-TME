"""Read-only FOTA API client for verified GET endpoints."""

import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from backend.config import get_api_url, get_fota_webapp_origin, normalize_env

FOTA_READ_TIMEOUT_SECONDS = 20
MAX_PAGE_SIZE = 100
PACKAGE_FILTERS = {"vendor", "model", "version", "isPushable", "approvalStatus"}
WALLBOX_FILTERS = {"serialNumber", "model", "version", "status", "countryIds"}


class FotaReadError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


def _page_parameters(page, size, beta):
    try:
        page_number = int(page)
        page_size = int(size)
    except (TypeError, ValueError) as exc:
        raise FotaReadError(400, "Page and size must be integers.") from exc

    if page_number < 0 or page_size < 1 or page_size > MAX_PAGE_SIZE:
        raise FotaReadError(400, f"Page must be non-negative and size must be between 1 and {MAX_PAGE_SIZE}.")

    return {"page": page_number, "size": page_size, "beta": str(bool(beta)).lower()}


def _filter_parameters(filters, allowed):
    filters = filters if isinstance(filters, dict) else {}
    unsupported = set(filters) - allowed
    if unsupported:
        raise FotaReadError(400, "Unsupported FOTA filter.")

    parameters = {}
    for key, value in filters.items():
        if value is None or value == "" or value == []:
            continue
        parameters[key] = str(value).lower() if isinstance(value, bool) else value
    return parameters


def _get_json(path, env, token, params=None, client_id=None):
    normalized_env = normalize_env(env)
    origin = get_fota_webapp_origin(normalized_env)
    if not origin:
        raise FotaReadError(501, f"FOTA is not configured for {normalized_env.upper()}.")
    if not token:
        raise FotaReadError(401, "Authentication token is required.")

    target_url = get_api_url(path, normalized_env)
    if params:
        target_url = f"{target_url}?{urlencode(params, doseq=True)}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json, text/plain, */*",
        "Origin": origin,
        "Referer": f"{origin}/",
    }
    if client_id:
        headers["clientId"] = client_id

    request = Request(target_url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=FOTA_READ_TIMEOUT_SECONDS) as response:
            if response.status == 204:
                return {"data": {"content": [], "totalElements": 0}}
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 401:
            raise FotaReadError(exc.code, "The FOTA session is unauthorized or expired.") from None
        if exc.code == 403:
            raise FotaReadError(exc.code, "The signed-in user does not have the required FOTA access role.") from None
        if exc.code == 404:
            raise FotaReadError(404, "The requested FOTA resource was not found.") from None
        raise FotaReadError(502, f"FOTA read request failed with HTTP {exc.code}.") from None
    except (URLError, TimeoutError, OSError):
        raise FotaReadError(502, "The FOTA read request could not reach the API.") from None
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise FotaReadError(502, "The FOTA API returned an invalid JSON response.") from None


def list_packages(env, token, page=0, size=5, beta=False, filters=None):
    params = _page_parameters(page, size, beta)
    params.update(_filter_parameters(filters, PACKAGE_FILTERS))
    return _get_json("/v2/fota-management/v2/firmware", env, token, params)


def get_package(env, token, version, model, beta):
    version = str(version or "").strip()
    model = str(model or "").strip()
    if not version or not model:
        raise FotaReadError(400, "Firmware version and model are required.")
    if not isinstance(beta, bool):
        raise FotaReadError(400, "Firmware beta status must be a boolean.")
    return _get_json(
        f"/v1/firmware/{quote(version, safe='')}/{quote(model, safe='')}/{str(beta).lower()}",
        env,
        token,
    )


def list_campaigns(env, token, page=0, size=5, beta=False):
    params = _page_parameters(page, size, beta)
    return _get_json("/v1/campaign", env, token, params)


def list_launched_campaigns(env, token, country_id, charger_model):
    country_id = str(country_id or "").strip()
    charger_model = str(charger_model or "").strip()
    if not country_id or not charger_model:
        raise FotaReadError(400, "Country ID and charger model are required.")
    path = f"/v1/campaign/launched/{quote(country_id, safe='')}/{quote(charger_model, safe='')}"
    return _get_json(path, env, token)


def list_launched_campaigns_by_vendor(env, token, country_id, vendor):
    country_id = str(country_id or "").strip()
    vendor = str(vendor or "").strip()
    if not country_id or not vendor:
        raise FotaReadError(400, "Country ID and vendor are required.")
    path = f"/v2/fota-management/campaign/launched/{quote(country_id, safe='')}"
    return _get_json(path, env, token, {"vendor": vendor})


def list_wallboxes(env, token, page=0, size=5, beta=True, filters=None):
    params = _page_parameters(page, size, beta)
    params.update(_filter_parameters(filters, WALLBOX_FILTERS))
    return _get_json("/v1/wallboxes/firmware", env, token, params)


def get_wallbox_membership(env, token, serial_number):
    serial_number = str(serial_number or "").strip()
    if not serial_number:
        raise FotaReadError(400, "Serial number is required.")
    return _get_json(
        "/v1/wallboxes/firmware",
        env,
        token,
        {"serialNumber": serial_number},
    )


def get_filter_metadata(env, token):
    return {
        "models": _get_json("/v1/wallboxes/models", env, token, client_id="tme"),
        "versions": _get_json("/v1/firmwares/version", env, token, client_id="tme"),
        "statuses": _get_json("/v1/wallboxes/connectors/0/status", env, token, client_id="tme"),
        "countries": _get_json("/v1/fota/countries", env, token, client_id="tme"),
    }