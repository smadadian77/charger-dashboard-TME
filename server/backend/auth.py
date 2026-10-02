import base64
import json
import os
import subprocess
import sys
import threading
import time

from backend.config import BASE_DIR, get_token_file, normalize_env

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


def is_token_expired(token):
    payload = decode_jwt_payload(str(token or "").strip())
    if not payload:
        return True

    exp = payload.get("exp")
    if isinstance(exp, (int, float)):
        return int(exp) <= int(time.time()) + 30

    return False


ENV_CLIENT_IDS = {
    "prod": {"635b40b9-e2a6-4aa1-b091-4d293d7bf80d"},
    "acc": {"999bf820-34e8-4078-9908-a9b99ea0fbce", "769328e8-3732-45f2-9724-34dba356564e"},
    "prev": {"999bf820-34e8-4078-9908-a9b99ea0fbce", "769328e8-3732-45f2-9724-34dba356564e"},
}


def is_tme_token(token, env="prod"):
    payload = decode_jwt_payload(str(token or "").strip())
    if not payload:
        return False

    aud = payload.get("aud")
    audiences = set(aud) if isinstance(aud, list) else {aud}
    if audiences & {"00000003-0000-0000-c000-000000000000", "https://graph.microsoft.com"}:
        return False

    norm_env = normalize_env(env)
    allowed = ENV_CLIENT_IDS.get(norm_env, set())
    if not (audiences & allowed):
        return False

    return bool(payload.get("exp") or payload.get("iat"))


def capture_token_from_browser(env="prod"):
    norm_env = normalize_env(env)
    try:
        from tme_token_bridge import (
            decode_jwt_payload,
            extract_jwts,
            is_token_expired,
            read_shared,
            storage_dirs,
        )

        allowed = ENV_CLIENT_IDS.get(norm_env, set())
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
            if not token or token in seen:
                continue
            seen.add(token)
            if is_token_expired(token):
                continue
            payload = decode_jwt_payload(token) or {}
            aud = payload.get("aud")
            audiences = set(aud) if isinstance(aud, list) else {aud}
            if not (audiences & allowed):
                continue
            exp = payload.get("exp") or 0
            if exp >= best_exp:
                best = token
                best_exp = exp
        return best or ""
    except Exception:
        return ""


def read_saved_token(env="prod", allow_browser_scan=True):
    norm_env = normalize_env(env)
    token_file = get_token_file(norm_env)
    if os.path.exists(token_file):
        try:
            with open(token_file, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            token = str(data.get("token", "") or "").strip()
            if token and not is_token_expired(token) and is_tme_token(token, env=norm_env):
                return token
        except Exception:
            pass

    if allow_browser_scan:
        try:
            token = capture_token_from_browser(norm_env)
            if token and not is_token_expired(token) and is_tme_token(token, env=norm_env):
                write_saved_token(token, env=norm_env)
                return token
        except Exception:
            pass

    return ""


def write_saved_token(token, env="prod"):
    token_file = get_token_file(env)
    payload = {"token": str(token or "").strip(), "env": normalize_env(env)}
    with open(token_file, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)


def delete_saved_token(env="prod"):
    token_file = get_token_file(env)
    if os.path.exists(token_file):
        try:
            os.remove(token_file)
        except OSError:
            pass


def is_token_capture_running(env="prod"):
    norm_env = normalize_env(env)
    proc = TOKEN_CAPTURE_PROCESSES.get(norm_env)
    if proc is None:
        return False
    if proc.poll() is not None:
        TOKEN_CAPTURE_PROCESSES.pop(norm_env, None)
        return False
    return True


def start_token_capture(env="prod", force=False, no_browser=False):
    norm_env = normalize_env(env)
    if not force:
        if read_saved_token(norm_env):
            return True
        if is_token_capture_running(norm_env):
            return True
    else:
        delete_saved_token(norm_env)
        with TOKEN_CAPTURE_LOCK:
            proc = TOKEN_CAPTURE_PROCESSES.pop(norm_env, None)
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                except Exception:
                    pass

    script_path = os.path.join(BASE_DIR, "tme_token_bridge.py")
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"Missing bridge script: {script_path}")

    with TOKEN_CAPTURE_LOCK:
        if not force and read_saved_token(norm_env):
            return True
        if not force and is_token_capture_running(norm_env):
            return True
        log_path = os.path.join(BASE_DIR, f"tme_token_bridge_{norm_env}.log")
        log_handle = open(log_path, "a", encoding="utf-8")
        log_handle.write(f"\n--- Fresh token capture initiated for {norm_env.upper()} at {time.strftime('%Y-%m-%d %H:%M:%S')} (force={force}, no_browser={no_browser}) ---\n")
        log_handle.flush()
        cmd = [sys.executable, script_path, "--env", norm_env]
        if force:
            cmd.append("--force")
        if no_browser:
            cmd.append("--no-browser")
        TOKEN_CAPTURE_PROCESSES[norm_env] = subprocess.Popen(
            cmd,
            cwd=BASE_DIR,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        return True


def get_token_status(env="prod"):
    norm_env = normalize_env(env)
    token = read_saved_token(norm_env)
    capturing = is_token_capture_running(norm_env)

    if not token:
        status = "missing"
    elif is_token_expired(token):
        status = "expired"
    elif not is_tme_token(token, env=norm_env):
        status = "invalid"
    else:
        status = "valid"

    minutes_remaining = 0
    if status == "valid":
        payload = decode_jwt_payload(token) or {}
        exp = payload.get("exp")
        if exp:
            minutes_remaining = max(0, int((float(exp) - time.time()) / 60))

    return {
        "ok": True,
        "env": norm_env,
        "status": status,
        "hasToken": bool(token),
        "valid": status == "valid",
        "capturing": capturing,
        "minutesRemaining": minutes_remaining,
        "token": token if status == "valid" else "",
    }

