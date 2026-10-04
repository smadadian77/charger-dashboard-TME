import argparse
import base64
import ctypes
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
from urllib.request import Request, urlopen

from backend.auth import (
    ENV_CLIENT_IDS,
    decode_jwt_payload,
    is_token_expired,
    is_tme_token as is_backend_tme_token,
)
from backend.config import get_dashboard_url, get_fota_webapp_url, get_api_url, normalize_token_app
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description="TME Token Bridge")
parser.add_argument("--env", default="prod", choices=["prod", "acc", "prev"], help="Target environment")
parser.add_argument("--app", default="charger", choices=["charger", "fota"], help="TME application to authenticate")
parser.add_argument("--force", action="store_true", help="Force fresh login flow")
parser.add_argument("--no-browser", action="store_true", help="Do not open browser tab (already opened by client)")
parser.add_argument("--min-issued-at", type=int, default=0, help="Ignore tokens issued before this Unix timestamp")
args, _ = parser.parse_known_args()
ENV = args.env.lower()
APP = normalize_token_app(args.app)
FORCE = bool(args.force)
NO_BROWSER = bool(args.no_browser)
MIN_ISSUED_AT = max(0, args.min_issued_at)

TME_URL = get_fota_webapp_url(ENV) if APP == "fota" else get_dashboard_url(ENV)
TME_API_HOST = get_api_url("", ENV).removeprefix("https://")
LOCAL_TOKEN_URL = f"http://127.0.0.1:8000/api/tme-token?env={ENV}"
PROFILE_ROOT = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local")),
    f"TMEWallboxBridge_{ENV}_{APP}",
)
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"tme_token_bridge_{ENV}.log")

TME_CLIENT_IDS = ENV_CLIENT_IDS.get(ENV, {"635b40b9-e2a6-4aa1-b091-4d293d7bf80d"})
JWT_RE = re.compile(rb"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")
LOCK_NAMES = {"SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"}
CACHE_NAMES = {
    "GPUPersistentCache",
    "ShaderCache",
    "GrShaderCache",
    "GPUCache",
    "Cache",
    "Code Cache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GraphiteDawnCache",
    "Crashpad",
    "BrowserMetrics",
    "Snapshots",
}
LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-software-rasterizer",
    "--disable-gpu-shader-disk-cache",
    "--disable-features=Vulkan,UseSkiaRenderer",
    "--disk-cache-size=1",
    "--media-cache-size=1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
]
RECOVERABLE_EVAL_ERRORS = (
    "Execution context was destroyed",
    "Target page, context or browser has been closed",
    "Target closed",
    "Frame was detached",
    "Most likely the page has been closed",
    "Navigation",
    "Execution context is not available",
)


def log(message):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def is_tme_token(token):
    return is_backend_tme_token(token, env=ENV)


def pick_valid_tme_token(candidates, min_iat=MIN_ISSUED_AT):
    seen = []
    for candidate in candidates or []:
        if not candidate or not isinstance(candidate, str):
            continue

        value = candidate.strip()
        if not value:
            continue

        if value.lower().startswith("bearer "):
            value = value[7:].strip()

        if value and value.count(".") == 2 and value not in seen:
            seen.append(value)

    for token in seen:
        if is_token_expired(token):
            continue
        if is_tme_token(token):
            payload = decode_jwt_payload(token) or {}
            issued_at = payload.get("iat")
            if min_iat and (not isinstance(issued_at, (int, float)) or issued_at < min_iat):
                continue
            return token

    return None


def _on_rm_error(func, path, exc_info):
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass


def remove_path(path):
    if not os.path.lexists(path):
        return True
    try:
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path, onerror=_on_rm_error)
        else:
            os.chmod(path, stat.S_IWRITE)
            os.remove(path)
    except Exception:
        return os.path.lexists(path) is False
    return not os.path.lexists(path)


def quarantine_dir(path):
    if not os.path.exists(path):
        return True
    destination = f"{path}.corrupt-{time.strftime('%Y%m%d%H%M%S')}"
    try:
        os.rename(path, destination)
        return True
    except OSError:
        return False


def scrub_profile(profile_dir):
    if not os.path.isdir(profile_dir):
        return False

    ok = True
    for dirpath, dirnames, filenames in os.walk(profile_dir):
        for name in list(dirnames):
            if name in CACHE_NAMES or name.endswith(".CHROME_DELETE"):
                if not remove_path(os.path.join(dirpath, name)):
                    ok = False
                dirnames.remove(name)
        for name in filenames:
            if name in LOCK_NAMES or name.endswith(".CHROME_DELETE"):
                if not remove_path(os.path.join(dirpath, name)):
                    ok = False
    return ok


def _stale_profile_process_query(profile_root):
    escaped_root = os.path.abspath(profile_root).replace("'", "''")
    return (
        f"$profileRoot = '{escaped_root}'; "
        "Get-CimInstance Win32_Process | "
        "Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileRoot) } | "
        "ForEach-Object { $_.ProcessId }"
    )


def kill_stale_profile_processes(profile_root):
    if os.name != "nt":
        return

    command = _stale_profile_process_query(profile_root)
    result = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return

    pids = []
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if stripped.isdigit():
            pids.append(int(stripped))

    for pid in sorted(set(pids)):
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            pass

    if pids:
        time.sleep(0.4)


def read_active_profile(profile_root):
    marker = os.path.join(profile_root, "active-profile.txt")
    try:
        with open(marker, "r", encoding="utf-8") as handle:
            path = handle.read().strip()
    except OSError:
        return ""
    if path and os.path.isdir(path) and os.path.abspath(path).startswith(os.path.abspath(profile_root)):
        return path
    return ""


def write_active_profile(profile_root, profile_dir):
    marker = os.path.join(profile_root, "active-profile.txt")
    try:
        with open(marker, "w", encoding="utf-8") as handle:
            handle.write(profile_dir)
    except OSError:
        pass


def new_profile_dir(profile_root):
    profile_dir = os.path.join(profile_root, f"session-{time.strftime('%Y%m%d%H%M%S')}-{os.getpid()}")
    os.makedirs(profile_dir, exist_ok=True)
    write_active_profile(profile_root, profile_dir)
    return profile_dir


def acquire_profile_dir(profile_root, force_fresh=False):
    os.makedirs(profile_root, exist_ok=True)
    kill_stale_profile_processes(profile_root)
    if not force_fresh:
        preferred = read_active_profile(profile_root)
        if preferred and scrub_profile(preferred):
            return preferred
        if preferred:
            quarantine_dir(preferred)
    return new_profile_dir(profile_root)


def extract_access_token(page):
    return page.evaluate(
        r"""
        (() => {
          const seen = [];
          const azureAudiences = new Set([
            '00000003-0000-0000-c000-000000000000',
            'https://graph.microsoft.com'
          ]);

          function decodeJwt(token) {
            if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
              return null;
            }
            try {
              const payloadSegment = token.split('.')[1];
              const paddedSegment = payloadSegment + '='.repeat((4 - (payloadSegment.length % 4)) % 4);
              const decoded = atob(paddedSegment.replace(/-/g, '+').replace(/_/g, '/'));
              return JSON.parse(decoded);
            } catch (error) {
              return null;
            }
          }

          function addCandidate(candidate, credentialType) {
            if (!candidate || typeof candidate !== 'string') {
              return;
            }
            const trimmed = candidate.trim();
            if (!trimmed) {
              return;
            }
            const compact = trimmed.replace(/^Bearer\s+/i, '');
            const payload = decodeJwt(compact);
            if (!payload || !(payload.exp || payload.iat) || azureAudiences.has(payload.aud)) {
              if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                  const parsed = JSON.parse(trimmed);
                  walk(parsed);
                } catch (error) {
                  // Ignore non-JSON values.
                }
              }
              return;
            }
            if (seen.indexOf(compact) === -1) {
              if (credentialType === 'IdToken' || payload.preferred_username || payload.nonce) {
                seen.unshift(compact);
              } else {
                seen.push(compact);
              }
            }
          }

          function walk(value) {
            if (!value) {
              return;
            }
            if (typeof value === 'string') {
              addCandidate(value);
              return;
            }
            if (Array.isArray(value)) {
              value.forEach(walk);
              return;
            }
            if (typeof value === 'object') {
              if (typeof value.secret === 'string') {
                addCandidate(value.secret, value.credentialType);
              }
              Object.keys(value).forEach((key) => walk(value[key]));
            }
          }

          function scanStorage(storage) {
            if (!storage) {
              return;
            }
            for (const key of Object.keys(storage)) {
              walk(storage.getItem(key));
            }
          }

          scanStorage(window.localStorage);
          scanStorage(window.sessionStorage);
          return seen;
        })();
        """
    )


def save_token_to_local_server(token):
    valid_token = pick_valid_tme_token([token])
    if not valid_token:
        raise ValueError("No valid TME JWT was found in the browser session.")

    request_body = json.dumps({"token": valid_token, "env": ENV, "app": APP}).encode("utf-8")
    request = Request(
        LOCAL_TOKEN_URL,
        data=request_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        response_body = response.read().decode("utf-8", errors="replace")
        return response.status, response_body


def attach_token_capture(context, captured):
    def on_request(request):
        try:
            url = request.url or ""
            if TME_API_HOST not in url:
                return
            headers = request.headers or {}
            auth = headers.get("authorization") or headers.get("Authorization")
            if auth:
                captured.append(auth)
        except Exception:
            return

    context.on("request", on_request)


def open_pages(context):
    try:
        return [page for page in context.pages if not page.is_closed()]
    except Exception:
        return []


def context_alive(context):
    try:
        browser = context.browser
        if browser is not None and not browser.is_connected():
            return False
        return True
    except Exception:
        return False


def close_quietly(context, browser):
    if context is not None:
        try:
            context.close()
        except Exception:
            pass
    if browser is not None:
        try:
            browser.close()
        except Exception:
            pass


def launch_persistent(playwright, profile_dir):
    errors = []
    channels = [None, "msedge", "chrome"]
    for channel in channels:
        context = None
        kwargs = {
            "headless": False,
            "args": LAUNCH_ARGS,
            "ignore_default_args": ["--enable-automation"],
            "viewport": {"width": 1280, "height": 900},
        }
        if channel:
            kwargs["channel"] = channel
        label = channel or "playwright-chromium"
        try:
            context = playwright.chromium.launch_persistent_context(profile_dir, **kwargs)
            page = context.pages[0] if context.pages else context.new_page()
            page.goto("about:blank", timeout=15000, wait_until="domcontentloaded")
            if not context_alive(context):
                raise RuntimeError("Browser closed immediately after launch")
            log(f"Launched persistent browser ({label}) at {profile_dir}")
            return context, None
        except Exception as exc:
            errors.append(f"{label}: {exc}")
            log(f"Persistent launch failed ({label}): {exc}")
            close_quietly(context, None)
    return None, errors


def launch_ephemeral(playwright):
    browser = playwright.chromium.launch(
        headless=False,
        args=LAUNCH_ARGS,
        ignore_default_args=["--enable-automation"],
    )
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    log("Launched ephemeral browser after persistent profiles failed.")
    return context, browser


def goto_dashboard(page):
    try:
        page.goto(TME_URL, timeout=60000, wait_until="domcontentloaded")
        return True
    except Exception as exc:
        message = str(exc)
        if any(marker in message for marker in RECOVERABLE_EVAL_ERRORS):
            log(f"Dashboard navigation interrupted: {exc}")
            return False
        log(f"Initial navigation failed: {exc}")
        return False


def read_page_tokens(page):
    if page.is_closed():
        return []
    try:
        found = extract_access_token(page)
    except Exception as exc:
        message = str(exc)
        if any(marker in message for marker in RECOVERABLE_EVAL_ERRORS):
            return []
        log(f"Token evaluation failed: {exc}")
        return []
    if not found:
        return []
    if isinstance(found, str):
        return [found]
    return list(found)


def poll_for_token(context, browser):
    captured = []
    attach_token_capture(context, captured)
    pages = open_pages(context)
    page = pages[0] if pages else context.new_page()
    navigated = goto_dashboard(page)
    started = time.time()
    closed_streak = 0

    for attempt in range(1, 181):
        if not context_alive(context):
            if not navigated and time.time() - started < 20:
                return "relaunch"
            log("Browser closed before a TME token was captured.")
            return 1

        api_token = pick_valid_tme_token(captured, min_iat=MIN_ISSUED_AT)
        storage_token = None
        live_pages = open_pages(context)
        if not live_pages:
            closed_streak += 1
            if closed_streak >= 3:
                try:
                    page = context.new_page()
                    navigated = goto_dashboard(page) or navigated
                    closed_streak = 0
                except Exception as exc:
                    log(f"Could not reopen the dashboard page: {exc}")
                    if not context_alive(context):
                        return "relaunch" if time.time() - started < 20 else 1
        else:
            closed_streak = 0
            for live_page in live_pages:
                storage_token = pick_valid_tme_token(read_page_tokens(live_page), min_iat=MIN_ISSUED_AT)
                if storage_token:
                    break
                if TME_API_HOST in (live_page.url or "") or "charger-dashboard" in (live_page.url or ""):
                    navigated = True

        valid_token = api_token or storage_token
        if valid_token:
            try:
                status, response_body = save_token_to_local_server(valid_token)
                log(f"Token captured and saved. HTTP {status}; {response_body}")
                return 0
            except Exception as exc:
                log(f"Failed to save token to local server: {exc}")

        log(f"Waiting for TME sign-in... attempt {attempt}/180")
        time.sleep(2)

    log("TME sign-in did not complete in time. Sign in once in the browser window and rerun the bridge.")
    return 1


def is_dashboard_id_token(token, min_iat=0):
    if is_token_expired(token) or not is_tme_token(token):
        return False
    payload = decode_jwt_payload(token) or {}
    aud = payload.get("aud")
    if isinstance(aud, str):
        audiences = {aud}
    elif isinstance(aud, list) and all(isinstance(value, str) for value in aud):
        audiences = set(aud)
    else:
        return False
    if not (audiences & TME_CLIENT_IDS):
        return False
    issued_at = payload.get("iat")
    if min_iat and (not isinstance(issued_at, (int, float)) or issued_at < min_iat):
        return False
    return True


def pick_dashboard_token(candidates, min_iat=0):
    best = None
    best_exp = -1
    seen = set()
    for token in candidates or []:
        if not token or token in seen or not is_dashboard_id_token(token, min_iat=min_iat):
            continue
        seen.add(token)
        exp = (decode_jwt_payload(token) or {}).get("exp") or 0
        if exp >= best_exp:
            best = token
            best_exp = exp
    return best


def collapse_utf16_ascii(data):
    if not data or len(data) < 8:
        return b""
    odd = data[1::2]
    if odd and odd.count(0) / len(odd) > 0.8:
        return data[0::2]
    return b""


def extract_utf16_jwts(data):
    found = []
    needle = "eyJ".encode("utf-16le")
    start = 0
    while True:
        index = data.find(needle, start)
        if index < 0:
            break
        chars = []
        cursor = index
        skipped = 0
        while cursor + 1 < len(data) and len(chars) < 12000:
            low, high = data[cursor], data[cursor + 1]
            if high == 0 and (low in (45, 46, 95) or 48 <= low <= 57 or 65 <= low <= 90 or 97 <= low <= 122):
                chars.append(chr(low))
                cursor += 2
                skipped = 0
                continue
            skipped += 1
            if skipped > 8:
                break
            cursor += 1
        token = "".join(chars)
        if token.count(".") >= 2 and len(token) > 40:
            found.append(".".join(token.split(".")[:3]))
        start = index + 2
    return found


def extract_jwts(data):
    found = []
    blobs = [data or b""]
    collapsed = collapse_utf16_ascii(data)
    if collapsed:
        blobs.append(collapsed)
    for blob in blobs:
        for match in JWT_RE.findall(blob):
            try:
                found.append(match.decode("ascii"))
            except UnicodeDecodeError:
                continue
    found.extend(extract_utf16_jwts(data or b""))
    return found


def read_shared(path):
    if os.name != "nt":
        try:
            with open(path, "rb") as handle:
                return handle.read()
        except OSError:
            return b""

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateFileW.restype = ctypes.c_void_p
    kernel32.CreateFileW.argtypes = [
        ctypes.c_wchar_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
    ]
    kernel32.ReadFile.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.c_void_p,
    ]
    kernel32.ReadFile.restype = ctypes.c_int
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel32.CreateFileW(path, 0x80000000, 0x7, None, 3, 0x80, None)
    if not handle or handle == ctypes.c_void_p(-1).value:
        return b""
    try:
        size = os.path.getsize(path)
        if size <= 0 or size > 80000000:
            return b""
        buffer = ctypes.create_string_buffer(size)
        read = ctypes.c_ulong(0)
        if not kernel32.ReadFile(handle, buffer, size, ctypes.byref(read), None):
            return b""
        return buffer.raw[: read.value]
    except OSError:
        return b""
    finally:
        kernel32.CloseHandle(handle)


def storage_dirs():
    local = os.environ.get("LOCALAPPDATA", "")
    roots = [
        os.path.join(local, "Google", "Chrome", "User Data"),
        os.path.join(local, "Microsoft", "Edge", "User Data"),
    ]
    for root in roots:
        if not os.path.isdir(root):
            continue
        try:
            names = os.listdir(root)
        except OSError:
            continue
        for name in names:
            if name in {"System Profile", "Guest Profile", "Crashpad", "GrShaderCache", "ShaderCache"}:
                continue
            profile = os.path.join(root, name)
            if not os.path.isdir(profile):
                continue
            for storage_name in ("Local Storage", "Session Storage"):
                storage = os.path.join(profile, storage_name)
                leveldb = os.path.join(storage, "leveldb")
                if os.path.isdir(leveldb):
                    yield leveldb
                if os.path.isdir(storage):
                    yield storage


def find_dashboard_token(include_ldb=False, min_iat=0):
    suffixes = (".log", ".ldb") if include_ldb else (".log",)
    candidates = []
    for directory in storage_dirs():
        try:
            names = os.listdir(directory)
        except OSError:
            continue
        for name in names:
            if not name.endswith(suffixes):
                continue
            candidates.extend(extract_jwts(read_shared(os.path.join(directory, name))))
    return pick_dashboard_token(candidates, min_iat=min_iat)


def chrome_executable():
    candidates = [
        os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"), "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return ""


def open_tme_tab(new=2):
    try:
        import webbrowser
        opened = webbrowser.open(TME_URL, new=new)
        if opened:
            log(f"Opened TME {APP.upper()} tab for {ENV.upper()} in the default browser window.")
            return True
        log("The default browser did not confirm opening a new tab.")
        return False
    except Exception as exc:
        log(f"Could not open browser: {exc}")
        return False


def run_external_browser_capture():
    log(f"Looking for a TME session token for {ENV.upper()} in browser storage.")
    opened_tab = False
    open_attempted = False
    page_retry_attempted = False

    for attempt in range(1, 181):
        token = find_dashboard_token(include_ldb=True, min_iat=MIN_ISSUED_AT)
        if token:
            try:
                status, response_body = save_token_to_local_server(token)
                log(f"Token captured from browser and saved. HTTP {status}; {response_body}")
                return 0
            except Exception as exc:
                log(f"Failed to save token to local server: {exc}")
        if not open_attempted and not NO_BROWSER:
            open_attempted = True
            opened_tab = open_tme_tab()
        elif APP == "fota" and opened_tab and not page_retry_attempted and attempt >= 10:
            page_retry_attempted = True
            log("No FOTA token appeared after the initial page load; retrying the URL in the existing browser window.")
            open_tme_tab(new=0)
        log(f"Waiting for TME sign-in in browser... attempt {attempt}/180")
        time.sleep(2)
    log("TME sign-in did not complete in time. Sign in on the TME tab and reload the local page.")
    return 1


def run_playwright_capture():
    with sync_playwright() as playwright:
        for launch_attempt in range(2):
            profile_dir = acquire_profile_dir(PROFILE_ROOT)
            context, browser = launch_persistent(playwright, profile_dir)
            if context is None:
                try:
                    context, browser = launch_ephemeral(playwright)
                except Exception as exc:
                    log(f"Could not launch a browser for TME authentication: {exc}")
                    return 1

            try:
                result = poll_for_token(context, browser)
            finally:
                close_quietly(context, browser)

            if result != "relaunch":
                return result
            if launch_attempt == 0:
                log("Restarting the TME browser after an early launch failure.")

    return 1


def main():
    log(f"Starting TME token capture for {ENV.upper()} {APP.upper()} (force={FORCE}, no_browser={NO_BROWSER}).")
    return run_external_browser_capture()


if __name__ == "__main__":
    raise SystemExit(main())
