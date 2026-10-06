import base64
import json
import math
import os
import subprocess
import sys
import tempfile
import threading
import time

from backend.config import BASE_DIR, get_token_file, normalize_env, normalize_token_app

if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

TOKEN_CAPTURE_PROCESSES = {}
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


def _expiration_seconds(payload):
    exp = payload.get("exp") if isinstance(payload, dict) else None
    if not isinstance(exp, (int, float)) or isinstance(exp, bool):
        return None
    try:
        value = float(exp)
    except (OverflowError, ValueError):
        return None
    return value if math.isfinite(value) else None


def is_token_expired(token):
    payload = decode_jwt_payload(str(token or "").strip())
    exp = _expiration_seconds(payload)
    if exp is None:
        return True
    return exp <= time.time() + 30


ENV_CLIENT_IDS = {
    "prod": {"635b40b9-e2a6-4aa1-b091-4d293d7bf80d"},
    "acc": {"999bf820-34e8-4078-9908-a9b99ea0fbce", "769328e8-3732-45f2-9724-34dba356564e"},
    "prev": {"999bf820-34e8-4078-9908-a9b99ea0fbce", "769328e8-3732-45f2-9724-34dba356564e"},
}

FOTA_CLIENT_IDS = {
    "prod": {"5d737712-d090-4011-95d0-76c42c7cf269"},
    "acc": {"00861c8a-6547-4855-8a6b-2fe32267dbf2"},
    "prev": {"00861c8a-6547-4855-8a6b-2fe32267dbf2"},
}


def is_tme_token(token, env="prod", app="charger"):
    payload = decode_jwt_payload(str(token or "").strip())
    if not isinstance(payload, dict):
        return False

    aud = payload.get("aud")
    if isinstance(aud, str):
        audiences = {aud}
    elif isinstance(aud, list) and all(isinstance(value, str) for value in aud):
        audiences = set(aud)
    else:
        return False
    if audiences & {"00000003-0000-0000-c000-000000000000", "https://graph.microsoft.com"}:
        return False
    if _expiration_seconds(payload) is None:
        return False

    norm_env = normalize_env(env)
    client_ids = FOTA_CLIENT_IDS if normalize_token_app(app) == "fota" else ENV_CLIENT_IDS
    allowed = client_ids.get(norm_env, set())
    if not (audiences & allowed):
        return False

    return True


def _read_saved_token_file(env, app="charger"):
    norm_app = normalize_token_app(app)
    try:
        with open(get_token_file(env, norm_app), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return ""
        if norm_app == "fota" and data.get("source") != "fota-webapp":
            return ""
        return str(data.get("token", "") or "").strip()
    except (OSError, ValueError, TypeError):
        return ""


def capture_token_from_browser(env="prod", app="charger"):
    norm_env = normalize_env(env)
    norm_app = normalize_token_app(app)
    try:
        from tme_token_bridge import (
            extract_jwts,
            read_shared,
            storage_dirs,
        )

        candidates = []
        for directory in storage_dirs():
            try:
                names = os.listdir(directory)
            except OSError:
                continue
            for name in names:
                if name.endswith((".log", ".ldb")):
                    candidates.extend(extract_jwts(read_shared(os.path.join(directory, name))))

        best = None
        best_exp = -1
        seen = set()
        for token in candidates:
            if not token or token in seen or is_token_expired(token) or not is_tme_token(token, env=norm_env, app=norm_app):
                continue
            seen.add(token)
            payload = decode_jwt_payload(token) or {}
            exp = payload.get("exp") or 0
            if exp >= best_exp:
                best = token
                best_exp = exp
        return best or ""
    except Exception:
        return ""


def read_saved_token(env="prod", allow_browser_scan=False, app="charger"):
    norm_env = normalize_env(env)
    norm_app = normalize_token_app(app)
    token = _read_saved_token_file(norm_env, norm_app)
    if token and not is_token_expired(token) and is_tme_token(token, env=norm_env, app=norm_app):
        return token

    if allow_browser_scan:
        try:
            token = capture_token_from_browser(norm_env, app=norm_app)
            if token and not is_token_expired(token) and is_tme_token(token, env=norm_env, app=norm_app):
                write_saved_token(token, env=norm_env, app=norm_app)
                return token
        except Exception:
            pass

    return ""


def write_saved_token(token, env="prod", app="charger"):
    norm_app = normalize_token_app(app)
    token_file = get_token_file(env, norm_app)
    token_dir = os.path.dirname(token_file)
    os.makedirs(token_dir, exist_ok=True)
    payload = {"token": str(token or "").strip(), "env": normalize_env(env), "app": norm_app}
    if norm_app == "fota":
        payload["source"] = "fota-webapp"
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=token_dir, delete=False) as handle:
            json.dump(payload, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
            temporary_path = handle.name
        try:
            os.chmod(temporary_path, 0o600)
        except OSError:
            pass
        os.replace(temporary_path, token_file)
        temporary_path = None
    finally:
        if temporary_path and os.path.exists(temporary_path):
            try:
                os.remove(temporary_path)
            except OSError:
                pass


def store_captured_token(token, env="prod", min_issued_at=0, app="charger"):
    value = str(token or "").strip()
    norm_env = normalize_env(env)
    norm_app = normalize_token_app(app)
    if is_token_expired(value) or not is_tme_token(value, env=norm_env, app=norm_app):
        return False
    if min_issued_at:
        payload = decode_jwt_payload(value) or {}
        issued_at = payload.get("iat")
        if not isinstance(issued_at, (int, float)) or isinstance(issued_at, bool) or not math.isfinite(issued_at) or issued_at < min_issued_at:
            return False
    write_saved_token(value, env=norm_env, app=norm_app)
    return True


def delete_saved_token(env="prod", app="charger"):
    token_file = get_token_file(env, normalize_token_app(app))
    if os.path.exists(token_file):
        try:
            os.remove(token_file)
        except OSError:
            pass


def is_token_capture_running(env="prod", app="charger"):
    norm_env = normalize_env(env)
    norm_app = normalize_token_app(app)
    process_key = norm_env if norm_app == "charger" else (norm_env, norm_app)
    with TOKEN_CAPTURE_LOCK:
        proc = TOKEN_CAPTURE_PROCESSES.get(process_key)
        if proc is None:
            return False
        if proc.poll() is not None:
            TOKEN_CAPTURE_PROCESSES.pop(process_key, None)
            return False
        return True


def start_token_capture(env="prod", force=False, no_browser=False, min_issued_at=0, app="charger"):
    norm_env = normalize_env(env)
    norm_app = normalize_token_app(app)
    process_key = norm_env if norm_app == "charger" else (norm_env, norm_app)
    script_path = os.path.join(BASE_DIR, "tme_token_bridge.py")
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"Missing bridge script: {script_path}")

    with TOKEN_CAPTURE_LOCK:
        proc = TOKEN_CAPTURE_PROCESSES.get(process_key)
        if proc is not None and proc.poll() is None:
            if not force:
                return True
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    proc.kill()
                    proc.wait(timeout=5)
                except Exception:
                    if proc.poll() is None:
                        return True
            except Exception:
                if proc.poll() is None:
                    return True
        TOKEN_CAPTURE_PROCESSES.pop(process_key, None)

        if not force and read_saved_token(norm_env, app=norm_app):
            return True

        log_path = os.path.join(BASE_DIR, f"tme_token_bridge_{norm_env}.log")
        cmd = [sys.executable, script_path, "--env", norm_env, "--app", norm_app]
        if force:
            cmd.append("--force")
        if no_browser:
            cmd.append("--no-browser")
        if min_issued_at:
            cmd.extend(["--min-issued-at", str(int(min_issued_at))])
        with open(log_path, "a", encoding="utf-8") as log_handle:
            log_handle.write(f"\n--- Fresh token capture initiated for {norm_env.upper()} at {time.strftime('%Y-%m-%d %H:%M:%S')} (force={force}, no_browser={no_browser}) ---\n")
            log_handle.flush()
            TOKEN_CAPTURE_PROCESSES[process_key] = subprocess.Popen(
                cmd,
                cwd=BASE_DIR,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        return True


def get_token_status(env="prod", app="charger"):
    norm_env = normalize_env(env)
    norm_app = normalize_token_app(app)
    stored_token = _read_saved_token_file(norm_env, norm_app)
    token = stored_token if stored_token and not is_token_expired(stored_token) and is_tme_token(stored_token, env=norm_env, app=norm_app) else ""
    stored_payload = decode_jwt_payload(stored_token) if stored_token else None
    stored_expiration = _expiration_seconds(stored_payload)
    capturing = is_token_capture_running(norm_env, norm_app)

    if token:
        status = "valid"
    elif stored_expiration is not None and stored_expiration <= time.time() + 30:
        status = "expired"
    elif stored_token:
        status = "invalid"
    else:
        status = "missing"

    minutes_remaining = 0
    if status == "valid":
        payload = decode_jwt_payload(token) or {}
        exp = payload.get("exp")
        if exp:
            minutes_remaining = max(0, int((float(exp) - time.time()) / 60))

    return {
        "ok": True,
        "env": norm_env,
        "app": norm_app,
        "status": status,
        "hasToken": bool(stored_token),
        "valid": status == "valid",
        "expired": status == "expired",
        "capturing": capturing,
        "minutesRemaining": minutes_remaining,
    }

