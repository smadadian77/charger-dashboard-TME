import base64
from concurrent.futures import ThreadPoolExecutor
import json
import math
import mimetypes
import os
import re
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen
import smart_investigations

from backend.config import (
    BASE_DIR,
    DEFAULT_PORT,
    ENV_CONFIGS,
    SERIAL_HISTORY_FILE,
    TME_API_ORIGIN,
    get_api_url,
    get_env_config,
    get_token_file,
    normalize_env,
)
try:
    from backend.config import get_dashboard_url
except ImportError:
    def get_dashboard_url(env="prod"):
        return f"{get_env_config(env)['webapp_origin']}/wallbox/list"

from backend.auth import (
    TOKEN_CAPTURE_LOCK,
    TOKEN_CAPTURE_PROCESSES,
    decode_jwt_payload,
    delete_saved_token,
    is_tme_token,
    is_token_capture_running,
    is_token_expired,
    read_saved_token,
    start_token_capture,
    write_saved_token,
)
try:
    from backend.auth import get_token_status
except ImportError:
    def get_token_status(env="prod"):
        norm_env = normalize_env(env)
        token = read_saved_token(norm_env)
        capturing = is_token_capture_running(norm_env)
        if not token:
            status = "missing"
        elif is_token_expired(token):
            status = "expired"
        elif not is_tme_token(token):
            status = "invalid"
        else:
            status = "valid"
        return {
            "ok": True,
            "env": norm_env,
            "status": status,
            "hasToken": bool(token),
            "valid": status == "valid",
            "capturing": capturing,
            "token": token if status == "valid" else "",
        }

from backend.services.serial_service import (
    DEFAULT_SERIAL,
    find_best_match,
    levenshtein_distance,
    read_serial_history,
    write_serial_history,
)
try:
    from backend.services.serial_service import (
        clear_serial_history,
        delete_serial_from_history,
    )
except ImportError:
    def delete_serial_from_history(serial_number):
        clean_serial = str(serial_number or "").strip().upper()
        current = read_serial_history()
        history = [s for s in current.get("history", []) if s != clean_serial]
        if not history:
            history = [DEFAULT_SERIAL]
        last_selected = current.get("lastSelected", "")
        if last_selected == clean_serial:
            last_selected = history[0]
        payload = {"lastSelected": last_selected, "history": history}
        try:
            with open(SERIAL_HISTORY_FILE, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
        except Exception:
            pass
        return payload

    def clear_serial_history():
        payload = {"lastSelected": DEFAULT_SERIAL, "history": [DEFAULT_SERIAL]}
        try:
            with open(SERIAL_HISTORY_FILE, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
        except Exception:
            pass
        return payload

from backend.services.outages_service import (
    EUROPEAN_MARKETS,
    OPS_ANALYTICS_CACHE,
    TOP_FIRMWARES_SPECS,
    TOP_MODELS_SPECS,
    build_fallback_ops_analytics,
    compute_ops_analytics,
    get_webapp_origin,
)
from backend.services.support_ops_service import (
    SUPPORT_OPERATION_SPECS,
    _build_support_operation_request,
    _classify_support_response,
    _extract_channel_data,
    _extract_channel_status,
    _get_support_operation_context,
    _sanitize_support_response,
    _support_response_message,
    _support_response_payload,
)

# Aliases for backward compatibility with existing tests and scripts
_compute_ops_analytics = compute_ops_analytics
_build_fallback_ops_analytics = build_fallback_ops_analytics



class AppHandler(BaseHTTPRequestHandler):
    def _extract_env(self, body_payload=None):
        path = getattr(self, "path", "")
        parsed = urlparse(path)
        url_params = {k: v[0] for k, v in parse_qs(parsed.query).items() if v}
        headers = getattr(self, "headers", None)
        header_env = headers.get("X-Wallbox-Env") if headers else None
        env = (
            header_env
            or url_params.get("env")
            or (body_payload.get("env") if isinstance(body_payload, dict) else None)
            or "prod"
        )
        return normalize_env(env)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Wallbox-Env, X-Method-Override")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            self._send_json({"ok": True, "status": "ready"})
            return

        if parsed.path == "/api/session-token":
            env = self._extract_env()
            if self.headers.get("X-Method-Override") == "DELETE":
                delete_saved_token(env)
                self._send_json({"ok": True, "env": env, "message": f"Saved token cleared for {env.upper()}."})
                return
            token = read_saved_token(env)
            self._send_json({
                "ok": True,
                "env": env,
                "hasToken": bool(token),
                "token": token,
                "capturing": is_token_capture_running(env),
            })
            return

        if parsed.path == "/api/token-status":
            env = self._extract_env()
            status_data = get_token_status(env)
            status_data["url"] = get_dashboard_url(env)
            self._send_json(status_data)
            return

        if parsed.path == "/api/refresh-tme-token":
            env = self._extract_env()
            url_params = parse_qs(parsed.query)
            force = url_params.get("force", ["0"])[0].lower() in ("1", "true", "yes")
            no_browser = url_params.get("noBrowser", ["0"])[0].lower() in ("1", "true", "yes")
            target_url = get_dashboard_url(env)

            if not force:
                token = read_saved_token(env)
                if token and not is_token_expired(token):
                    self._send_json({
                        "ok": True,
                        "env": env,
                        "message": f"Token already available for {env.upper()}.",
                        "hasToken": True,
                        "url": target_url,
                    })
                    return
            else:
                delete_saved_token(env)

            # Only open OS browser if explicitly requested by user-initiated action
            open_browser = url_params.get("openBrowser", ["0"])[0].lower() in ("1", "true", "yes")
            if open_browser and not no_browser:
                try:
                    webbrowser.open(target_url)
                except Exception:
                    pass

            try:
                start_token_capture(env, force=force, no_browser=no_browser)
                self._send_json({
                    "ok": True,
                    "env": env,
                    "url": target_url,
                    "message": f"Opening TME login page for {env.upper()} ({target_url}). Token capture started...",
                    "capturing": True,
                })
            except Exception as exc:
                self._send_json({
                    "ok": False,
                    "env": env,
                    "url": target_url,
                    "message": f"Unable to start the token bridge for {env.upper()}: {exc}",
                }, status=500)
            return

        if parsed.path == "/api/wallbox-models":
            self._proxy_metadata("/v1/wallboxes/models", "models")
            return

        if parsed.path == "/api/wallbox-statuses":
            self._proxy_metadata("/v1/wallboxes/connectors/0/status", "connectorsStatus")
            return

        if parsed.path == "/api/firmware-versions":
            self._proxy_metadata("/v1/firmwares/version", "firmwaresVersion")
            return

        if parsed.path == "/api/wallbox-list":
            self._proxy_wallbox_list()
            return

        if parsed.path == "/api/outages":
            self._proxy_outages()
            return

        if parsed.path == "/api/sse-check":
            self._handle_sse_check()
            return

        if parsed.path == "/api/serial-history":
            history_data = read_serial_history()
            self._send_json({"ok": True, **history_data})
            return

        if parsed.path == "/api/ops-analytics":
            self._handle_ops_analytics()
            return

        if parsed.path in ("/", "/index.html"):
            self._serve_file("index.html")
            return

        static_file = parsed.path.lstrip("/") if parsed.path.startswith("/") else parsed.path
        ext = os.path.splitext(static_file)[1].lower()
        if ext in {".js", ".css", ".html", ".svg", ".png", ".ico", ".json", ".webp", ".woff", ".woff2", ".map", ".ttf"}:
            self._serve_file(static_file)
            return

        # Single-page application route fallback
        self._serve_file("index.html")
        return

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/session-token":
            env = self._extract_env()
            delete_saved_token(env)
            self._send_json({"ok": True, "env": env, "message": f"Saved token cleared for {env.upper()}."})
            return

        if parsed.path == "/api/serial-history":
            params = parse_qs(parsed.query)
            serial = params.get("serial", [None])[0] or params.get("serialNumber", [None])[0]
            if not serial:
                try:
                    payload = self._read_json_body()
                    serial = payload.get("serialNumber") or payload.get("serial")
                except Exception:
                    serial = None
            if serial:
                updated = delete_serial_from_history(serial)
            else:
                updated = clear_serial_history()
            self._send_json({"ok": True, **updated})
            return

        self.send_error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path in ("/api/smart-investigation", "/api/smart-investigation/chat"):
            self._smart_investigation_endpoint(parsed.path.endswith("/chat"))
            return

        if parsed.path == "/api/serial-history":
            try:
                payload = self._read_json_body()
            except Exception:
                payload = {}
            serial = payload.get("serialNumber") or payload.get("serial") or ""
            action = str(payload.get("action", "") or "").lower()
            if action == "delete":
                updated = delete_serial_from_history(serial)
            elif action == "clear":
                updated = clear_serial_history()
            else:
                updated = write_serial_history(serial)
            self._send_json({"ok": True, **updated})
            return

        if parsed.path == "/api/wallbox-list":
            self._proxy_wallbox_list()
            return

        if parsed.path == "/api/ops-analytics":
            self._handle_ops_analytics()
            return

        if parsed.path == "/api/wallbox-models":
            self._proxy_metadata("/v1/wallboxes/models", "models")
            return

        if parsed.path == "/api/wallbox-statuses":
            self._proxy_metadata("/v1/wallboxes/connectors/0/status", "connectorsStatus")
            return

        if parsed.path == "/api/firmware-versions":
            self._proxy_metadata("/v1/firmwares/version", "firmwaresVersion")
            return

        if parsed.path == "/api/outages":
            self._proxy_outages()
            return

        if parsed.path == "/api/remote-operation/unlock-connector":
            self._proxy_remote_operation("unlock-connector")
            return

        if parsed.path == "/api/remote-operation/reboot":
            self._proxy_remote_operation("reboot")
            return

        if parsed.path == "/api/tme-token":
            content_length = int(self.headers.get("Content-Length", "0"))
            request_body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
            try:
                payload = json.loads(request_body) if request_body.strip() else {}
            except json.JSONDecodeError:
                self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
                return

            env = self._extract_env(payload)
            token = str(payload.get("token", "") or "").strip()
            if not token:
                self._send_json({"ok": False, "message": "No token provided."}, status=400)
                return

            if is_token_expired(token) or not is_tme_token(token, env=env):
                delete_saved_token(env)
                self._send_json({"ok": False, "message": f"TME token rejected and cleared for {env.upper()}."}, status=400)
                return

            write_saved_token(token, env)
            self._send_json({"ok": True, "env": env, "message": f"TME session token saved for {env.upper()}."})
            return

        if parsed.path == "/api/wallbox":
            self._proxy_wallbox()
            return

        if parsed.path == "/api/channel-info":
            self._proxy_channel_info()
            return

        if parsed.path == "/api/charging-sessions":
            self._proxy_charging_sessions()
            return

        if parsed.path == "/api/access":
            self._proxy_access()
            return

        if parsed.path == "/api/smart-charging":
            self._proxy_smart_charging()
            return

        if parsed.path == "/api/support-operation":
            self._proxy_support_operation()
            return

        if parsed.path != "/api/events":
            self.send_error(404, "Not found")
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        request_body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"

        try:
            payload = json.loads(request_body) if request_body.strip() else {}
        except json.JSONDecodeError:
            self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
            return

        env = self._extract_env(payload)
        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip() or read_saved_token(env)
        start_time = str(payload.get("startTime", "")).strip()
        end_time = str(payload.get("endTime", "")).strip()
        try:
            page = max(0, int(payload.get("page", 0)))
        except (TypeError, ValueError):
            page = 0
        if token.lower().startswith("bearer "):
            token = token[7:].strip()

        if not serial_number:
            self._send_json({"ok": False, "message": "Please provide a serial number."}, status=400)
            return

        if not token:
            self._send_json({"ok": False, "message": "Please provide a bearer token."}, status=400)
            return

        query_params = [
            f"serialNumber={quote(serial_number)}",
            f"page={page}",
            "size=100",
        ]
        if start_time:
            query_params.append(f"startTime={quote(start_time)}")
        if end_time:
            query_params.append(f"endTime={quote(end_time)}")

        target_url = f"{get_api_url('/v2/log-management/events', env)}?{'&'.join(query_params)}"
        origin = get_webapp_origin(env)

        try:
            request = Request(
                target_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Origin": origin,
                    "Referer": f"{origin}/",
                },
                method="GET",
            )
            with urlopen(request, timeout=30) as response:
                response_body = response.read().decode("utf-8")
                remote_payload = json.loads(response_body)
        except Exception as exc:
            message = str(exc)
            status_code = getattr(exc, "code", 502)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            is_auth = status_code in (401, 403)
            is_not_found = status_code == 404
            err_msg = (
                "Upstream TME session unauthorized or expired." if is_auth
                else f"Charger not found for serial {serial_number}." if is_not_found
                else f"Events request failed for {serial_number}: {message}"
            )
            self._send_json({
                "ok": False,
                "env": env,
                "statusCode": status_code,
                "notFound": is_not_found,
                "authError": is_auth,
                "message": err_msg,
                "details": message,
            }, status=status_code if status_code in (400, 401, 403, 404) else 502)
            return

        data = remote_payload.get("data") or {}
        self._send_json({
            "ok": True,
            "env": env,
            "message": "Events loaded successfully.",
            "payload": remote_payload,
            "last": bool(data.get("last", True)),
            "totalElements": data.get("totalElements"),
        })

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        request_body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        return json.loads(request_body) if request_body.strip() else {}

    def _smart_investigation_endpoint(self, is_chat):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > smart_investigations.MAX_CONTEXT_BYTES + 12_000:
                raise ValueError("Request body is missing or too large.")
            request_body = self.rfile.read(content_length).decode("utf-8")
            payload = json.loads(request_body)
            if not isinstance(payload, dict):
                raise ValueError("Request body must be a JSON object.")
            context = payload.get("context")
            if is_chat:
                response = smart_investigations.answer_question(
                    context,
                    payload.get("findings"),
                    payload.get("question"),
                    self.client_address[0],
                    history=payload.get("history"),
                )
            else:
                response = smart_investigations.generate_findings(context, self.client_address[0])
            self._send_json(response)
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json({"error": "invalid_request", "message": "Request body is not valid JSON."}, status=400)
        except ValueError as exc:
            self._send_json({"error": "invalid_request", "message": str(exc)}, status=400)
        except smart_investigations.SmartInvestigationError as exc:
            error = {"error": exc.code, "message": str(exc)}
            if exc.retry_after_seconds is not None:
                error["retryAfterSeconds"] = exc.retry_after_seconds
            self._send_json(error, status=exc.status)

    def _proxy_support_operation(self):
        try:
            payload = self._read_json_body()
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json({"ok": False, "status": "REJECTED", "message": "Request body is not valid JSON."}, status=400)
            return

        env = self._extract_env(payload)
        operation = str(payload.get("operation", ""))
        serial_number = str(payload.get("serialNumber", "")).strip()
        parameters = payload.get("parameters") if isinstance(payload.get("parameters"), dict) else {}
        token = read_saved_token(env)
        if not token:
            self._send_json({
                "ok": False,
                "env": env,
                "status": "REJECTED",
                "httpStatus": 401,
                "message": f"No valid saved TME session is available for {env.upper()}. Refresh the session and try again.",
            }, status=401)
            return

        try:
            request = _build_support_operation_request(operation, serial_number, token, parameters, env)
        except ValueError as exc:
            self._send_json({"ok": False, "env": env, "status": "REJECTED", "message": str(exc)}, status=400)
            return

        secret_values = [token]
        secret_values.extend(
            value for value in (parameters.get("ownerPin"), parameters.get("location"))
            if isinstance(value, str)
        )
        try:
            with urlopen(request, timeout=30) as response:
                http_status = response.status
                response_body = response.read()
        except HTTPError as exc:
            http_status = exc.code
            response_body = exc.read()
        except (socket.timeout, TimeoutError):
            self._send_json({
                "ok": False,
                "env": env,
                "status": "TIMEOUT",
                "httpStatus": None,
                "message": "The support operation timed out; its final state is unknown. Refresh data before retrying.",
            }, status=504)
            return
        except URLError as exc:
            if isinstance(exc.reason, (socket.timeout, TimeoutError)):
                self._send_json({
                    "ok": False,
                    "env": env,
                    "status": "TIMEOUT",
                    "httpStatus": None,
                    "message": "The support operation timed out; its final state is unknown. Refresh data before retrying.",
                }, status=504)
                return
            self._send_json({
                "ok": False,
                "env": env,
                "status": "FAILED",
                "httpStatus": None,
                "message": "The support operation could not reach the TME API.",
            }, status=502)
            return
        except Exception:
            self._send_json({
                "ok": False,
                "env": env,
                "status": "FAILED",
                "httpStatus": None,
                "message": "The support operation failed before a response was received.",
            }, status=502)
            return

        response_payload, malformed_response = _support_response_payload(response_body)
        response_message = (
            "TME API returned an unreadable response; the final state is unknown."
            if malformed_response
            else _support_response_message(response_payload, http_status)
        )
        safe_payload = _sanitize_support_response(response_payload, secret_values)
        safe_message = _sanitize_support_response(response_message, secret_values)
        operation_status = (
            "UNKNOWN" if malformed_response and 200 <= http_status < 300
            else _classify_support_response(operation, http_status, response_message)
        )
        self._send_json({
            "ok": True,
            "env": env,
            "status": operation_status,
            "httpStatus": http_status,
            "message": safe_message,
            "response": safe_payload,
        })

    def _proxy_wallbox(self):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
            return

        env = self._extract_env(payload)
        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip() or read_saved_token(env)
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not serial_number or not token:
            self._send_json({"ok": False, "message": "Serial number and token are required."}, status=400)
            return

        origin = get_webapp_origin(env)
        target_url = f"{get_api_url('/v2/wallbox-management/dashboard/wallboxes', env)}?serialNumber={quote(serial_number)}"
        try:
            request = Request(
                target_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json, text/plain, */*",
                    "clientid": "ctp",
                    "Origin": origin,
                    "Referer": f"{origin}/",
                },
                method="GET",
            )
            with urlopen(request, timeout=30) as response:
                remote_payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            message = str(exc)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            self._send_json({"ok": False, "env": env, "message": "Wallbox lookup failed.", "details": message}, status=502)
            return

        content = ((remote_payload.get("data") or {}).get("content") or [])
        wallbox = content[0] if content else None
        if wallbox is not None:
            wallbox = dict(wallbox)

        self._send_json({
            "ok": True,
            "env": env,
            "wallbox": wallbox,
            "payload": remote_payload,
        })

    def _handle_sse_check(self):
        parsed = urlparse(self.path)
        params = {k: v[0] for k, v in parse_qs(parsed.query).items() if v}
        env = self._extract_env()
        serial = (params.get("serial") or params.get("serialNumber") or "").strip()
        if not serial:
            self._send_json({"ok": False, "available": False, "message": "Serial number is required."}, status=400)
            return

        token = read_saved_token(env)
        if not token:
            self._send_json({"ok": False, "available": False, "message": "Authentication token required."}, status=401)
            return

        target_url = get_api_url(f"/sse-management/{quote(serial, safe='')}", env)
        origin = get_webapp_origin(env)
        req = Request(
            target_url,
            headers={
                "Accept": "text/event-stream",
                "Authorization": f"Bearer {token}",
                "Origin": origin,
                "Referer": f"{origin}/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            method="GET",
        )
        try:
            with urlopen(req, timeout=8) as response:
                status = response.status
                if status == 200:
                    self._send_json({
                        "ok": True,
                        "env": env,
                        "available": True,
                        "serialNumber": serial,
                        "status": 200,
                        "message": "SSE management stream active",
                    })
                    return
                else:
                    self._send_json({
                        "ok": False,
                        "env": env,
                        "available": False,
                        "serialNumber": serial,
                        "status": status,
                        "message": f"SSE returned status {status}",
                    })
                    return
        except Exception as exc:
            self._send_json({
                "ok": False,
                "env": env,
                "available": False,
                "serialNumber": serial,
                "status": getattr(exc, "code", 504),
                "message": f"SSE stream offline or unreachable: {exc}",
            })

    def _proxy_remote_operation(self, op_type):
        try:
            payload = self._read_json_body()
        except Exception:
            payload = {}

        env = self._extract_env(payload)
        serial = str(payload.get("serialNumber") or payload.get("serial") or "").strip()
        if not serial:
            self._send_json({"ok": False, "message": "Serial number is required."}, status=400)
            return

        token = str(payload.get("token") or "").strip() or read_saved_token(env)
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not token:
            self._send_json({"ok": False, "message": "Authentication token is required."}, status=401)
            return

        if op_type == "unlock-connector":
            connector_id = int(payload.get("connectorId") or 1)
            req_body = json.dumps({"connectorId": connector_id}).encode("utf-8")
            target_url = get_api_url(f"/v2/remote-operations/dashboard/wallboxes/{quote(serial, safe='')}/ro/unlock-connector", env)
        elif op_type == "reboot":
            reboot_type = str(payload.get("type") or "Soft").strip()
            req_body = json.dumps({"type": reboot_type}).encode("utf-8")
            target_url = get_api_url(f"/v2/remote-operations/dashboard/wallboxes/{quote(serial, safe='')}/ro/reboot", env)
        else:
            self._send_json({"ok": False, "message": f"Unsupported remote operation: {op_type}"}, status=400)
            return

        origin = get_webapp_origin(env)
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Authorization": f"Bearer {token}",
            "clientid": "evbe-opsdashboard",
            "Content-Type": "application/json",
            "Origin": origin,
            "Referer": f"{origin}/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }

        try:
            req = Request(target_url, data=req_body, headers=headers, method="POST")
            with urlopen(req, timeout=15) as response:
                status_code = response.status
                raw = response.read().decode("utf-8", errors="replace")
                try:
                    data = json.loads(raw)
                except Exception:
                    data = {"raw": raw}
                self._send_json({
                    "ok": True,
                    "env": env,
                    "status": status_code,
                    "data": data.get("data") if isinstance(data, dict) else data,
                    "payload": data,
                }, status=status_code)
        except HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else str(exc)
            try:
                err_data = json.loads(raw)
            except Exception:
                err_data = {"message": raw}
            self._send_json({
                "ok": False,
                "env": env,
                "status": exc.code,
                "message": f"Remote operation {op_type} failed: {exc.code}",
                "details": err_data,
            }, status=exc.code)
        except Exception as exc:
            self._send_json({
                "ok": False,
                "env": env,
                "status": 500,
                "message": f"Remote operation {op_type} error: {exc}",
            }, status=500)

    def _proxy_wallbox_list(self):
        parsed_url = urlparse(self.path)
        url_params = {k: v[0] for k, v in parse_qs(parsed_url.query).items() if v}

        body_payload = {}
        if self.command == "POST":
            try:
                body_payload = self._read_json_body()
            except Exception:
                body_payload = {}

        combined = {**url_params, **body_payload}
        env = self._extract_env(combined)

        auth_header = self.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
        else:
            token = str(combined.get("token", "")).strip() or read_saved_token(env)
        if token.lower().startswith("bearer "):
            token = token[7:].strip()

        if not token:
            self._send_json({"ok": False, "message": "Authentication token is required."}, status=401)
            return

        try:
            page = int(combined.get("page", 0))
        except (ValueError, TypeError):
            page = 0
        try:
            size = int(combined.get("size", 10))
        except (ValueError, TypeError):
            size = 10

        serial_filter = str(combined.get("serialNumber", "")).strip()
        model_filter = str(combined.get("model", "")).strip()
        status_filter = str(combined.get("status", "")).strip()
        raw_version = str(combined.get("firmwareVersion", combined.get("version", ""))).strip()
        version_filter = raw_version.lstrip("vV") if raw_version else ""
        country_filter = str(combined.get("countryIds", combined.get("countryId", combined.get("country", "")))).strip().upper()

        query_dict = {}
        if model_filter:
            query_dict["model"] = model_filter
        if status_filter:
            query_dict["status"] = status_filter.capitalize()
        if version_filter:
            query_dict["firmwareVersion"] = version_filter
        if country_filter:
            query_dict["countryIds"] = country_filter
        if serial_filter:
            query_dict["serialNumber"] = serial_filter

        query_dict["page"] = page
        query_dict["size"] = size
        origin = get_webapp_origin(env)
        upstream_base = get_api_url("/v2/wallbox-management/dashboard/wallboxes", env)
        target_url = f"{upstream_base}?{urlencode(query_dict)}"

        try:
            request = Request(target_url, headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json, text/plain, */*",
                "clientid": "ctp",
                "Origin": origin,
                "Referer": f"{origin}/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
            }, method="GET")
            with urlopen(request, timeout=30) as response:
                if response.status == 204:
                    remote_payload = {"data": {"content": [], "totalElements": 0, "totalPages": 0, "number": page, "size": size}}
                else:
                    raw_text = response.read().decode("utf-8")
                    remote_payload = json.loads(raw_text) if raw_text.strip() else {"data": {}}
        except HTTPError as exc:
            if exc.code == 204:
                remote_payload = {"data": {"content": [], "totalElements": 0, "totalPages": 0, "number": page, "size": size}}
            elif exc.code == 401:
                delete_saved_token(env)
                self._send_json({"ok": False, "env": env, "message": f"Session expired for {env.upper()}. Please refresh the session token.", "hasToken": False}, status=401)
                return
            else:
                message = str(exc)
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
                self._send_json({"ok": False, "env": env, "message": "Wallbox list lookup failed.", "details": message}, status=exc.code if 400 <= exc.code < 600 else 502)
                return
        except Exception as exc:
            self._send_json({"ok": False, "env": env, "message": "Wallbox list lookup failed.", "details": str(exc)}, status=502)
            return

        self._send_json({
            "ok": True,
            "env": env,
            "data": remote_payload.get("data") or {},
            "payload": remote_payload,
        })

    def _proxy_outages(self):
        env = self._extract_env()
        auth_header = self.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
        else:
            token = read_saved_token(env)
        if token.lower().startswith("bearer "):
            token = token[7:].strip()

        if not token:
            self._send_json({"ok": False, "message": "Authentication token is required."}, status=401)
            return

        origin = get_webapp_origin(env)
        target_url = get_api_url("/v2/log-management/outages", env)
        try:
            request = Request(
                target_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json, text/plain, */*",
                    "clientid": "ctp",
                    "Origin": origin,
                    "Referer": f"{origin}/",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
                },
                method="GET",
            )
            with urlopen(request, timeout=20) as response:
                remote_payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            self._send_json({"ok": False, "env": env, "message": "Outages lookup failed.", "details": str(exc)}, status=502)
            return

        self._send_json({
            "ok": True,
            "env": env,
            "data": remote_payload.get("data") or [],
            "payload": remote_payload,
        })

    def _proxy_metadata(self, path, key_name):
        env = self._extract_env()
        auth_header = self.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
        else:
            token = read_saved_token(env)
        if token.lower().startswith("bearer "):
            token = token[7:].strip()

        if not token:
            self._send_json({"ok": False, "message": "Authentication token is required."}, status=401)
            return

        origin = get_webapp_origin(env)
        target_url = get_api_url(path, env)
        try:
            request = Request(
                target_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json, text/plain, */*",
                    "clientid": "ctp",
                    "Origin": origin,
                    "Referer": f"{origin}/",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
                },
                method="GET",
            )
            with urlopen(request, timeout=20) as response:
                remote_payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            message = str(exc)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            self._send_json({"ok": False, "env": env, "message": f"{key_name} lookup failed.", "details": message}, status=502)
            return

        items = []
        if isinstance(remote_payload, dict):
            data = remote_payload.get("data")
            if isinstance(data, dict):
                items = data.get(key_name) or []
            elif isinstance(data, list):
                items = data
            elif key_name in remote_payload:
                items = remote_payload.get(key_name) or []

        self._send_json({
            "ok": True,
            "env": env,
            "data": remote_payload.get("data") or remote_payload,
            "items": items,
            "payload": remote_payload,
        })

    def _handle_ops_analytics(self):
        parsed = urlparse(self.path)
        params = {k: v[0] for k, v in parse_qs(parsed.query).items() if v}
        env = self._extract_env(params)
        force_refresh = params.get("refresh", "").lower() in ("true", "1", "yes")

        now = time.time()
        cached = OPS_ANALYTICS_CACHE.get(env)
        if not force_refresh and cached and (now - cached.get("time", 0) < 120):
            self._send_json(cached["data"])
            return

        token = read_saved_token(env)
        try:
            analytics_data = _compute_ops_analytics(env, token)
            OPS_ANALYTICS_CACHE[env] = {"time": now, "data": analytics_data}
            self._send_json(analytics_data)
        except Exception as exc:
            fallback = _build_fallback_ops_analytics(env)
            self._send_json(fallback)

    def _fetch_channel_info(self, serial_number, token, env="prod"):
        origin = get_webapp_origin(env)
        target_url = get_api_url(f"/v2/wallbox-management/wallboxes/{quote(serial_number)}/channel-info", env)
        request = Request(
            target_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
                "Cache-Control": "no-cache",
                "clientid": "ctp",
                "Origin": origin,
                "Pragma": "no-cache",
                "Priority": "u=1, i",
                "Referer": f"{origin}/",
                "sec-ch-ua": '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
            },
            method="GET",
        )
        with urlopen(request, timeout=30) as response:
            remote_payload = json.loads(response.read().decode("utf-8"))

        return _extract_channel_data(remote_payload), remote_payload

    def _proxy_channel_info(self):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
            return

        env = self._extract_env(payload)
        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip() or read_saved_token(env)
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not serial_number or not token:
            self._send_json({"ok": False, "message": "Serial number and token are required."}, status=400)
            return

        try:
            channel_data, remote_payload = self._fetch_channel_info(serial_number, token, env)
        except Exception as exc:
            message = str(exc)
            status_code = getattr(exc, "code", 502)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            is_auth = status_code in (401, 403)
            is_not_found = status_code == 404
            self._send_json({
                "ok": False,
                "env": env,
                "statusCode": status_code,
                "notFound": is_not_found,
                "authError": is_auth,
                "message": "Channel info lookup failed.",
                "details": message
            }, status=status_code if status_code in (400, 401, 403, 404) else 502)
            return

        self._send_json({
            "ok": True,
            "env": env,
            "channelData": channel_data,
            "status": _extract_channel_status(remote_payload),
            "payload": remote_payload,
        })

    def _optional_tme_get(self, target_url, token, env="prod"):
        try:
            return self._tme_get(target_url, token, env), None
        except Exception as exc:
            message = str(exc)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            return None, message

    def _tme_get(self, target_url, token, env="prod"):
        origin = get_webapp_origin(env)
        request = Request(
            target_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json, text/plain, */*",
                "clientid": "ctp",
                "Origin": origin,
                "Referer": f"{origin}/",
            },
            method="GET",
        )
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))

    def _proxy_named_get(self, url, token, label, env="prod"):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
            return None
        env = self._extract_env(payload)
        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token") or token or "").strip() or read_saved_token(env)
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not serial_number or not token:
            self._send_json({"ok": False, "message": "Serial number and token are required."}, status=400)
            return None
        try:
            remote_payload = self._tme_get(url.format(serial=quote(serial_number)), token, env)
        except Exception as exc:
            message = str(exc)
            status_code = getattr(exc, "code", 502)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            is_auth = status_code in (401, 403)
            is_not_found = status_code == 404
            err_msg = (
                f"{label}: TME session unauthorized or expired." if is_auth
                else f"{label}: Charger not found for serial {serial_number}." if is_not_found
                else f"{label} lookup failed."
            )
            self._send_json({
                "ok": False,
                "env": env,
                "statusCode": status_code,
                "notFound": is_not_found,
                "authError": is_auth,
                "message": err_msg,
                "details": message
            }, status=status_code if status_code in (400, 401, 403, 404) else 502)
            return None
        return remote_payload

    def _proxy_smart_charging(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        request_body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            payload = json.loads(request_body) if request_body.strip() else {}
        except json.JSONDecodeError:
            self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
            return
        env = self._extract_env(payload)
        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip() or read_saved_token(env)
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not serial_number or not token:
            self._send_json({"ok": False, "message": "Serial number and token are required."}, status=400)
            return
        smart_url = get_api_url(f"/v1/smart-charging-management/wallboxes/{quote(serial_number)}", env)
        tariff_url = get_api_url(f"/v2/energy-tariff/detail/{quote(serial_number)}", env)
        smart_payload, smart_error = self._optional_tme_get(smart_url, token, env)
        tariff_payload, tariff_error = self._optional_tme_get(tariff_url, token, env)
        if smart_payload is None and tariff_payload is None:
            self._send_json({
                "ok": False,
                "env": env,
                "message": "Smart charging lookup failed.",
                "details": smart_error or tariff_error,
            }, status=502)
            return
        self._send_json({
            "ok": True,
            "env": env,
            "smartCharging": (smart_payload or {}).get("data") or None,
            "tariff": (tariff_payload or {}).get("data") or None,
            "smartChargingError": smart_error,
            "tariffError": tariff_error,
        })

    def _proxy_access(self):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
            return

        env = self._extract_env(payload)
        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip() or read_saved_token(env)
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not serial_number or not token:
            self._send_json({"ok": False, "message": "Serial number and token are required."}, status=400)
            return

        target_url = get_api_url(f"/v1/accesses/{quote(serial_number)}", env)
        try:
            remote_payload = self._tme_get(target_url, token, env)
        except Exception as exc:
            message = str(exc)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            self._send_json({"ok": False, "env": env, "message": "Access lookup failed.", "details": message}, status=502)
            return

        self._send_json({"ok": True, "env": env, "access": (remote_payload.get("data") or None), "payload": remote_payload})

    def _proxy_charging_sessions(self):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
            return

        env = self._extract_env(payload)
        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip() or read_saved_token(env)
        start_time = str(payload.get("startTime", "")).strip()
        end_time = str(payload.get("endTime", "")).strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not serial_number or not token:
            self._send_json({"ok": False, "message": "Serial number and token are required."}, status=400)
            return

        sessions = []
        last = False
        page = 0
        window_start = start_time
        sessions_base_url = get_api_url("/v2/charging-session-management/wallboxes/charging-session", env)
        try:
            while not last and page < 40:
                query = [
                    "page=%s" % page,
                    "size=50",
                    "startTimeSort=DESC",
                    "serialNumber=%s" % quote(serial_number),
                ]
                if start_time:
                    query.append("startTime=%s" % quote(start_time))
                if end_time:
                    query.append("endTime=%s" % quote(end_time))
                remote_payload = self._tme_get("%s?%s" % (sessions_base_url, "&".join(query)), token, env)
                page_data = ((remote_payload.get("data") or {}).get("chargingSessions") or {})
                content = page_data.get("content") or []
                sessions.extend(content)
                last = bool(page_data.get("last", True)) or not content
                if window_start and content:
                    oldest = min((item.get("startTime") or "") for item in content)
                    if oldest and oldest <= window_start:
                        break
                page += 1
        except Exception as exc:
            message = str(exc)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            self._send_json({"ok": False, "env": env, "message": "Charging session lookup failed.", "details": message}, status=502)
            return

        self._send_json({"ok": True, "env": env, "sessions": sessions})

    def _serve_file(self, relative_path):
        """Serve bundled/source frontend files from a PyInstaller-safe root.

        In a one-file PyInstaller build, resources are extracted under
        sys._MEIPASS.  backend.config.BASE_DIR can legitimately point at a
        different location, so static files must not depend on BASE_DIR alone.
        """
        safe_name = relative_path.lstrip("/").replace("/", os.sep)

        roots = []
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            roots.append(os.path.realpath(meipass))

        server_dir = os.path.realpath(os.path.dirname(__file__))
        project_root = os.path.realpath(os.path.dirname(server_dir))
        angular_dist_browser = os.path.join(project_root, "dist", "Charger-Dashboard-Angular", "browser")
        angular_dist = os.path.join(project_root, "dist", "Charger-Dashboard-Angular")

        if os.path.isdir(angular_dist_browser):
            roots.append(angular_dist_browser)
        if os.path.isdir(angular_dist):
            roots.append(angular_dist)
        roots.append(project_root)
        roots.append(server_dir)

        try:
            roots.append(os.path.realpath(BASE_DIR))
        except Exception:
            pass

        # De-duplicate roots while preserving the lookup order above.
        unique_roots = []
        seen = set()
        for root in roots:
            if root and root not in seen:
                seen.add(root)
                unique_roots.append(root)

        candidate_paths = [
            os.path.join(angular_dist_browser, safe_name),
            os.path.join(angular_dist, safe_name),
        ]
        for root in unique_roots:
            candidate_paths.append(os.path.join(root, safe_name))
            candidate_paths.append(os.path.join(root, "browser", safe_name))
            candidate_paths.append(os.path.join(root, "frontend", safe_name))

        file_path = None
        for cand in candidate_paths:
            try:
                real_cand = os.path.realpath(cand)
                # Keep the path inside the corresponding trusted root.
                trusted = any(
                    os.path.commonpath([root, real_cand]) == root
                    for root in unique_roots
                )
                if trusted and os.path.isfile(real_cand):
                    file_path = real_cand
                    break
            except (OSError, ValueError):
                continue

        if not file_path:
            self.send_error(404, "File not found")
            return

        content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        with open(file_path, "rb") as file_handle:
            content = file_handle.read()

        try:
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except (ConnectionError, BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            pass

    def _send_json(self, payload, status=200):
        try:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionError, BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            pass

    def log_message(self, format, *args):
        return


def main():
    port = 8000
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Wallbox event timeline server listening on http://localhost:{port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
