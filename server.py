import base64
import json
import mimetypes
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REMOTE_BASE_URL = "https://tme-ev-chargingplatform.toyota-europe.com/v2/log-management/events"
WALLBOX_URL = "https://tme-ev-chargingplatform.toyota-europe.com/v2/wallbox-management/dashboard/wallboxes"
SESSIONS_URL = "https://tme-ev-chargingplatform.toyota-europe.com/v2/charging-session-management/wallboxes/charging-session"
ACCESS_URL = "https://tme-ev-chargingplatform.toyota-europe.com/v1/accesses"
SMART_CHARGING_URL = "https://tme-ev-chargingplatform.toyota-europe.com/v1/smart-charging-management/wallboxes"
TARIFF_URL = "https://tme-ev-chargingplatform.toyota-europe.com/v2/energy-tariff/detail"
TOKEN_FILE = os.path.join(BASE_DIR, "tme_session_token.json")
TOKEN_CAPTURE_PROCESS = None
TOKEN_CAPTURE_LOCK = threading.Lock()


def decode_jwt_payload(token):
    if not token or "." not in token:
        return None

    segments = token.split(".")
    if len(segments) != 3:
        return None

    payload_segment = segments[1]
    padded_segment = payload_segment + "=" * (-len(payload_segment) % 4)

    try:
        decoded = base64.urlsafe_b64decode(padded_segment.encode("utf-8"))
        return json.loads(decoded.decode("utf-8"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def is_token_expired(token):
    payload = decode_jwt_payload(str(token or "").strip())
    if not payload:
        return False

    exp = payload.get("exp")
    if isinstance(exp, (int, float)):
        return int(exp) <= int(time.time()) + 30

    return False


def is_tme_token(token):
    payload = decode_jwt_payload(str(token or "").strip())
    if not payload:
        return False

    aud = payload.get("aud")
    if aud in {"00000003-0000-0000-c000-000000000000", "https://graph.microsoft.com"}:
        return False

    return bool(payload.get("exp") or payload.get("iat"))


def read_saved_token():
    if not os.path.exists(TOKEN_FILE):
        return ""

    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        token = str(data.get("token", "") or "").strip()
        if not token:
            return ""
        if is_token_expired(token) or not is_tme_token(token):
            delete_saved_token()
            return ""
        return token
    except Exception:
        return ""


def write_saved_token(token):
    payload = {"token": str(token or "").strip()}
    with open(TOKEN_FILE, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)


def delete_saved_token():
    if os.path.exists(TOKEN_FILE):
        try:
            os.remove(TOKEN_FILE)
        except OSError:
            pass


def is_token_capture_running():
    global TOKEN_CAPTURE_PROCESS
    if TOKEN_CAPTURE_PROCESS is None:
        return False
    if TOKEN_CAPTURE_PROCESS.poll() is not None:
        TOKEN_CAPTURE_PROCESS = None
        return False
    return True


def start_token_capture():
    global TOKEN_CAPTURE_PROCESS
    if read_saved_token():
        return True
    if is_token_capture_running():
        return True

    script_path = os.path.join(BASE_DIR, "tme_token_bridge.py")
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"Missing bridge script: {script_path}")

    with TOKEN_CAPTURE_LOCK:
        if read_saved_token():
            return True
        if is_token_capture_running():
            return True
        log_path = os.path.join(BASE_DIR, "tme_token_bridge.log")
        log_handle = open(log_path, "a", encoding="utf-8")
        TOKEN_CAPTURE_PROCESS = subprocess.Popen(
            [sys.executable, script_path],
            cwd=BASE_DIR,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        return True


class AppHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            self._send_json({"ok": True, "status": "ready"})
            return

        if parsed.path == "/api/session-token":
            token = read_saved_token()
            self._send_json({
                "ok": True,
                "hasToken": bool(token),
                "token": token,
                "capturing": is_token_capture_running(),
            })
            return

        if parsed.path == "/api/session-token" and self.headers.get("X-Method-Override") == "DELETE":
            delete_saved_token()
            self._send_json({"ok": True, "message": "Saved token cleared."})
            return

        if parsed.path == "/api/refresh-tme-token":
            token = read_saved_token()
            if token:
                self._send_json({"ok": True, "message": "Token already available.", "hasToken": True})
                return

            try:
                start_token_capture()
                self._send_json({
                    "ok": True,
                    "message": "Token capture started automatically.",
                    "capturing": True,
                })
            except Exception as exc:
                self._send_json({
                    "ok": False,
                    "message": f"Unable to start the token bridge: {exc}",
                }, status=500)
            return

        if parsed.path in ("/", "/index.html"):
            self._serve_file("index.html")
            return

        static_file = parsed.path.lstrip("/") if parsed.path.startswith("/") else parsed.path
        if static_file in {"app.js", "style.css"}:
            self._serve_file(static_file)
            return

        self.send_error(404, "Not found")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/session-token":
            delete_saved_token()
            self._send_json({"ok": True, "message": "Saved token cleared."})
            return
        self.send_error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/tme-token":
            content_length = int(self.headers.get("Content-Length", "0"))
            request_body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
            try:
                payload = json.loads(request_body) if request_body.strip() else {}
            except json.JSONDecodeError:
                self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
                return

            token = str(payload.get("token", "") or "").strip()
            if not token:
                self._send_json({"ok": False, "message": "No token provided."}, status=400)
                return

            if is_token_expired(token) or not is_tme_token(token):
                delete_saved_token()
                self._send_json({"ok": False, "message": "TME token rejected and cleared. Use a token from the TME dashboard session."}, status=400)
                return

            write_saved_token(token)
            self._send_json({"ok": True, "message": "TME session token saved."})
            return

        if parsed.path == "/api/wallbox":
            self._proxy_wallbox()
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

        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip()
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

        target_url = f"{REMOTE_BASE_URL}?{'&'.join(query_params)}"

        try:
            request = Request(
                target_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                method="GET",
            )
            with urlopen(request, timeout=30) as response:
                response_body = response.read().decode("utf-8")
                remote_payload = json.loads(response_body)
        except Exception as exc:
            message = str(exc)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            self._send_json({
                "ok": False,
                "message": "The API request failed. Check the serial number, size, and token.",
                "details": message,
            }, status=502)
            return

        data = remote_payload.get("data") or {}
        self._send_json({
            "ok": True,
            "message": "Events loaded successfully.",
            "payload": remote_payload,
            "last": bool(data.get("last", True)),
            "totalElements": data.get("totalElements"),
        })

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        request_body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        return json.loads(request_body) if request_body.strip() else {}

    def _proxy_wallbox(self):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
            return

        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not serial_number or not token:
            self._send_json({"ok": False, "message": "Serial number and token are required."}, status=400)
            return

        target_url = f"{WALLBOX_URL}?serialNumber={quote(serial_number)}"
        try:
            request = Request(
                target_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json, text/plain, */*",
                    "clientid": "ctp",
                    "Origin": "https://tme-ev-chargingplatform-charger-dashboard-webapp.toyota-europe.com",
                    "Referer": "https://tme-ev-chargingplatform-charger-dashboard-webapp.toyota-europe.com/",
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
            self._send_json({"ok": False, "message": "Wallbox lookup failed.", "details": message}, status=502)
            return

        content = ((remote_payload.get("data") or {}).get("content") or [])
        self._send_json({
            "ok": True,
            "wallbox": content[0] if content else None,
            "payload": remote_payload,
        })

    def _optional_tme_get(self, target_url, token):
        try:
            return self._tme_get(target_url, token), None
        except Exception as exc:
            message = str(exc)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            return None, message

    def _tme_get(self, target_url, token):
        request = Request(
            target_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json, text/plain, */*",
                "clientid": "ctp",
                "Origin": "https://tme-ev-chargingplatform-charger-dashboard-webapp.toyota-europe.com",
                "Referer": "https://tme-ev-chargingplatform-charger-dashboard-webapp.toyota-europe.com/",
            },
            method="GET",
        )
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))

    def _proxy_named_get(self, url, token, label):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
            return None
        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token") or token or "").strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not serial_number or not token:
            self._send_json({"ok": False, "message": "Serial number and token are required."}, status=400)
            return None
        try:
            remote_payload = self._tme_get(url.format(serial=quote(serial_number)), token)
        except Exception as exc:
            message = str(exc)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            self._send_json({"ok": False, "message": f"{label} lookup failed.", "details": message}, status=502)
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
        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not serial_number or not token:
            self._send_json({"ok": False, "message": "Serial number and token are required."}, status=400)
            return
        smart_payload, smart_error = self._optional_tme_get(f"{SMART_CHARGING_URL}/{quote(serial_number)}", token)
        tariff_payload, tariff_error = self._optional_tme_get(f"{TARIFF_URL}/{quote(serial_number)}", token)
        if smart_payload is None and tariff_payload is None:
            self._send_json({
                "ok": False,
                "message": "Smart charging lookup failed.",
                "details": smart_error or tariff_error,
            }, status=502)
            return
        self._send_json({
            "ok": True,
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

        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not serial_number or not token:
            self._send_json({"ok": False, "message": "Serial number and token are required."}, status=400)
            return

        try:
            remote_payload = self._tme_get(f"{ACCESS_URL}/{quote(serial_number)}", token)
        except Exception as exc:
            message = str(exc)
            if hasattr(exc, "read"):
                try:
                    message = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            self._send_json({"ok": False, "message": "Access lookup failed.", "details": message}, status=502)
            return

        self._send_json({"ok": True, "access": (remote_payload.get("data") or None), "payload": remote_payload})

    def _proxy_charging_sessions(self):
        try:
            payload = self._read_json_body()
        except json.JSONDecodeError:
            self._send_json({"ok": False, "message": "Request body is not valid JSON."}, status=400)
            return

        serial_number = str(payload.get("serialNumber", "")).strip()
        token = str(payload.get("token", "")).strip()
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
                remote_payload = self._tme_get("%s?%s" % (SESSIONS_URL, "&".join(query)), token)
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
            self._send_json({"ok": False, "message": "Charging session lookup failed.", "details": message}, status=502)
            return

        self._send_json({"ok": True, "sessions": sessions})

    def _serve_file(self, relative_path):
        safe_name = relative_path.lstrip("/")
        file_path = os.path.normpath(os.path.join(BASE_DIR, safe_name))
        if os.path.commonpath([BASE_DIR, os.path.realpath(file_path)]) != BASE_DIR:
            self.send_error(403, "Forbidden")
            return

        if not os.path.isfile(file_path):
            self.send_error(404, "File not found")
            return

        content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        with open(file_path, "rb") as file_handle:
            content = file_handle.read()

        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
