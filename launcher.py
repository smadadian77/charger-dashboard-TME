"""Wallbox Event Timeline Dashboard - pywebview desktop launcher.

Build:
    pyinstaller --clean --noconfirm --onefile --name WallboxDashboard
        --windowed --noconsole --runtime-hook runtime_hook.py
        --hiddenimport webview --hiddenimport clr_loader --hiddenimport pythonnet
        --hiddenimport bottle --hiddenimport proxy_tools
        --add-data "server.py;." --add-data "index.html;." --add-data "app.js;."
        --add-data "style.css;." --add-data "tme_token_bridge.py;."
        --add-data "toyota-logo.ico;." --add-data "toyota-logo.svg;."
        --add-data "toyota-logo-256.png;." --add-data "toyota-logo-128.png;."
        --add-data "toyota-logo-64.png;." --add-data "toyota-logo-48.png;."
        --add-data "toyota-logo-32.png;." --icon "toyota-logo.ico" launcher.py

Architecture (one Windows process):
    main thread   -> pywebview GUI event loop (native window)
    daemon thread -> existing HTTP server (server.py) on 127.0.0.1:8000

The token-capture flow is preserved unchanged: when a token is required the
existing bridge logic opens the TME page in the external Chrome browser and
POSTs the captured JWT back to http://localhost:8000/api/tme-token, which is
why the server must keep using the fixed port 8000.
"""
import ctypes
import os
import subprocess
import sys
import threading
import time
import traceback
from urllib.request import urlopen

APP_NAME = "Wallbox Event Timeline"
APP_DIR = os.path.dirname(os.path.abspath(__file__))
try:
    APP_DIR = os.path.realpath(APP_DIR)
except OSError:
    pass
SERVER_SCRIPT = os.path.join(APP_DIR, "server.py")
BASE_URL = "http://127.0.0.1:8000"
DEFAULT_PORT = 8000
WINDOW_WIDTH = 1400
WINDOW_HEIGHT = 900

LOG_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
    APP_NAME,
    "logs",
)
try:
    os.makedirs(LOG_DIR, exist_ok=True)
except OSError:
    LOG_DIR = APP_DIR
LOG_FILE = os.path.join(LOG_DIR, "dashboard.log")


def log(message):
    line = "%s %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), message)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def _native_error(title, message):
    try:
        ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
    except Exception:
        log("native_error_failed: %s" % traceback.format_exc())


def _server_ready():
    try:
        with urlopen(BASE_URL + "/api/health", timeout=3) as resp:
            return resp.status == 200
    except Exception:
        return False


def _wait_for_server(timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _server_ready():
            return True
        time.sleep(0.25)
    return False


def _import_server_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location("wallbox_server", SERVER_SCRIPT)
    if spec is None or spec.loader is None:
        raise ImportError("Could not load server.py from %s" % SERVER_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def _start_bridge_in_process():
        try:
            import tme_token_bridge as _bridge
        except Exception as exc:
            log("bridge import failed: %s" % exc)
            return False

        def _run():
            try:
                _bridge.log("TME token bridge started in-process.")
                _bridge.main()
            except Exception as exc:
                _bridge.log("TME token bridge crashed: %s" % exc)

        thread = threading.Thread(target=_run, daemon=True, name="tme-token-bridge")
        thread.start()
        module.TOKEN_CAPTURE_PROCESS = thread
        module.TOKEN_CAPTURE_LOCK = threading.Lock()
        log("bridge thread started")
        return thread

    module.start_token_capture = _start_bridge_in_process
    module.TOKEN_CAPTURE_PROCESS = None
    module.TOKEN_CAPTURE_LOCK = threading.Lock()

    def _is_token_capture_running():
        proc = getattr(module, "TOKEN_CAPTURE_PROCESS", None)
        if proc is None:
            return False
        if isinstance(proc, threading.Thread):
            return proc.is_alive()
        poll = getattr(proc, "poll", None)
        if callable(poll):
            return poll() is None
        return getattr(proc, "is_alive", lambda: False)()

    module.is_token_capture_running = _is_token_capture_running
    log("server.is_token_capture_running patched for in-process bridge")
    return module


def _start_server_thread():
    try:
        module = _import_server_module()
    except Exception:
        log("server_import_failed:\n%s" % traceback.format_exc())
        return None
    import http.server as _hs
    server = _hs.ThreadingHTTPServer(("127.0.0.1", DEFAULT_PORT), module.AppHandler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    log("server_thread_started port=%s" % DEFAULT_PORT)
    return server


_PROC_NAME = "WallboxDashboard"
_PROC_NAMES = {_PROC_NAME.lower(), _PROC_NAME.lower() + ".exe"}


def _is_our_proc(name):
    return (name or "").lower() in _PROC_NAMES


def _any_dashboard_alive():
    """True if a WallboxDashboard process is actually running.

    The mutex alone is not enough: if a previous instance crashed or was
    force-killed without cleanup, the named mutex can linger and make a fresh
    launch look like a duplicate. So we always double-check the process list.
    """
    # psutil is the most reliable path.
    try:
        import psutil
        for proc in psutil.process_iter(["pid", "name"]):
            try:
                if _is_our_proc(proc.info.get("name")):
                    return True
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return False
    except ImportError:
        pass

    # Fallback: Toolhelp32 snapshot (no PowerShell subprocess).
    try:
        import ctypes

        TH32CS_SNAPPROCESS = 0x00000002

        class PROCESSENTRY32(ctypes.Structure):
            _fields_ = [
                ("dwSize", ctypes.c_uint32),
                ("cntUsage", ctypes.c_uint32),
                ("th32ProcessID", ctypes.c_uint32),
                ("th32DefaultHeapID", ctypes.c_void_p),
                ("th32ModuleID", ctypes.c_uint32),
                ("cntThreads", ctypes.c_uint32),
                ("th32ParentProcessID", ctypes.c_uint32),
                ("pcPriClassBase", ctypes.c_int32),
                ("dwFlags", ctypes.c_uint32),
                ("szExeFile", ctypes.c_char * 260),
            ]

        kernel32 = ctypes.windll.kernel32
        snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        if snapshot == -1 or snapshot == 0xFFFFFFFF:
            return False
        try:
            entry = PROCESSENTRY32()
            entry.dwSize = ctypes.sizeof(entry)
            if not kernel32.Process32First(snapshot, ctypes.byref(entry)):
                return False
            while True:
                name = entry.szExeFile.decode("utf-8", "replace").lower()
                if name in _PROC_NAMES:
                    return True
                if not kernel32.Process32Next(snapshot, ctypes.byref(entry)):
                    break
            return False
        finally:
            kernel32.CloseHandle(snapshot)
    except Exception:
        pass

    # Last resort: PowerShell.
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-Process -ErrorAction SilentlyContinue | "
             "Where-Object { $_.ProcessName -eq '%s' }).Count" % _PROC_NAME],
            capture_output=True, text=True, timeout=5, check=False,
        )
        return int(result.stdout.strip() or "0") > 0
    except Exception:
        return True


_MUTEX_NAME = "WallboxDashboardSingleton"
_mutex_handle = [None]


def _acquire_single_instance():
    """Return True if this process may run, False if another is already active.

    The mutex is released (and the handle closed) both on normal exit and via
    atexit, so a clean shutdown never leaks the lock. If the mutex already
    exists but no live dashboard process can be found, the stale lock is
    *owned* (WaitForSingleObject) rather than merely opened, so a concurrent
    launch cannot also slip through.
    """
    kernel32 = ctypes.windll.kernel32
    mutex = kernel32.CreateMutexW(None, False, _MUTEX_NAME)
    last = kernel32.GetLastError()
    if last == 183:  # ERROR_ALREADY_EXISTS
        if _any_dashboard_alive():
            log("another_instance_running exit")
            kernel32.CloseHandle(mutex)
            return False
        # Stale mutex from a dead process: take ownership so no other launch
        # can grab it at the same time.
        WAIT_OBJECT_0 = 0
        WAIT_TIMEOUT = 0x102
        result = kernel32.WaitForSingleObject(mutex, 3000)
        if result == WAIT_OBJECT_0:
            _mutex_handle[0] = mutex
            log("stale_mutex reclaimed (owned)")
            return True
        # Ownership timed out -> someone truly holds it now.
        kernel32.CloseHandle(mutex)
        log("another_instance_running exit (mutex owned)")
        return False
    _mutex_handle[0] = mutex
    return True


def _release_mutex():
    handle = _mutex_handle[0]
    if handle:
        try:
            ctypes.windll.kernel32.ReleaseMutex(handle)
        except OSError:
            pass
        try:
            ctypes.windll.kernel32.CloseHandle(handle)
        except OSError:
            pass
        _mutex_handle[0] = None


def main():
    import atexit
    atexit.register(_release_mutex)

    log("=== dashboard start ===")
    log("python=%s" % sys.executable)
    log("app_dir=%s" % APP_DIR)

    if not _acquire_single_instance():
        _native_error("Wallbox Dashboard", "The dashboard is already running.")
        return 0

    server = _start_server_thread()
    if server is None:
        log("server_start_failed")
        _native_error("Wallbox Dashboard", "The dashboard server could not be started.")
        return 1

    if not _wait_for_server(timeout=30):
        log("server_not_ready")
        try:
            server.shutdown()
        except Exception:
            pass
        _native_error("Wallbox Dashboard", "The dashboard server did not become ready in time.")
        return 1

    log("server_ready url=%s" % BASE_URL)

    import webview
    icon = os.path.join(APP_DIR, "toyota-logo.ico")
    if not os.path.exists(icon):
        log("icon_missing path=%s" % icon)
    window = webview.create_window(
        APP_NAME, BASE_URL + "/",
        width=WINDOW_WIDTH, height=WINDOW_HEIGHT,
        min_size=(900, 600), confirm_close=True,
    )

    def on_closed():
        log("window_closed shutting_down_server")
        try:
            server.shutdown()
        except Exception:
            log("server_shutdown_error:\n%s" % traceback.format_exc())

    window.events.closed += on_closed

    try:
        webview.start()
    except Exception:
        log("webview_start_failed:\n%s" % traceback.format_exc())
        try:
            server.shutdown()
        except Exception:
            pass
        _native_error("Wallbox Dashboard", "The dashboard window could not be opened.")
        return 1

    log("=== dashboard exit ===")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        log("unhandled:\n%s" % traceback.format_exc())
        _native_error("Wallbox Dashboard", "The dashboard failed to start. Check the log file.")
        sys.exit(1)