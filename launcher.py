"""
Charger Dashboard (Angular Edition) - pywebview Desktop Launcher.

Architecture:
  Main thread   -> pywebview GUI event loop (native desktop window)
  Daemon thread -> unified HTTP server (server.py) on 127.0.0.1:8000
"""

import ctypes
import os
import sys
import threading
import time
import traceback
from urllib.request import urlopen

APP_NAME = "EVBE Customer Support | Charger Dashboard"

if getattr(sys, "frozen", False) and getattr(sys, "_MEIPASS", None):
    APP_DIR = os.path.realpath(sys._MEIPASS)
else:
    APP_DIR = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))

SERVER_DIR = os.path.join(APP_DIR, "server")
if not os.path.exists(SERVER_DIR):
    SERVER_DIR = APP_DIR

if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

BASE_URL = "http://127.0.0.1:8000"
DEFAULT_PORT = 8000
WINDOW_WIDTH = 1440
WINDOW_HEIGHT = 900

LOG_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
    "ChargerDashboardAngular",
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


def _start_server_thread():
    try:
        import server
    except Exception:
        log("server_import_failed:\n%s" % traceback.format_exc())
        return None
    import http.server as _hs
    httpd = _hs.ThreadingHTTPServer(("127.0.0.1", DEFAULT_PORT), server.AppHandler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    log("server_thread_started port=%s" % DEFAULT_PORT)
    return httpd


_MUTEX_NAME = "ChargerDashboardAngularSingleton"
_mutex_handle = [None]


def _acquire_single_instance():
    kernel32 = ctypes.windll.kernel32
    mutex = kernel32.CreateMutexW(None, False, _MUTEX_NAME)
    last = kernel32.GetLastError()
    if last == 183:  # ERROR_ALREADY_EXISTS
        WAIT_OBJECT_0 = 0
        result = kernel32.WaitForSingleObject(mutex, 3000)
        if result == WAIT_OBJECT_0:
            _mutex_handle[0] = mutex
            log("stale_mutex reclaimed (owned)")
            return True
        kernel32.CloseHandle(mutex)
        log("another_instance_running exit")
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
        _native_error("Charger Dashboard", "The dashboard is already running.")
        return 0

    httpd = _start_server_thread()
    if httpd is None:
        log("server_start_failed")
        _native_error("Charger Dashboard", "The dashboard server could not be started.")
        return 1

    if not _wait_for_server(timeout=30):
        log("server_not_ready")
        try:
            httpd.shutdown()
        except Exception:
            pass
        _native_error("Charger Dashboard", "The dashboard server did not become ready in time.")
        return 1

    log("server_ready url=%s" % BASE_URL)

    import webview
    icon = os.path.join(APP_DIR, "public", "toyota-logo.ico")
    if not os.path.exists(icon):
        icon = os.path.join(APP_DIR, "toyota-logo.ico")

    window = webview.create_window(
        APP_NAME,
        BASE_URL + "/",
        width=WINDOW_WIDTH,
        height=WINDOW_HEIGHT,
        min_size=(900, 600),
        confirm_close=False,
    )

    def on_closed():
        log("window_closed shutting_down_server")
        try:
            httpd.shutdown()
        except Exception:
            log("server_shutdown_error:\n%s" % traceback.format_exc())

    window.events.closed += on_closed

    try:
        webview.start()
    except Exception:
        log("webview_start_failed:\n%s" % traceback.format_exc())
        try:
            httpd.shutdown()
        except Exception:
            pass
        _native_error("Charger Dashboard", "The dashboard desktop window could not be opened.")
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
        _native_error("Charger Dashboard", "The dashboard failed to start. Check the log file.")
        sys.exit(1)

