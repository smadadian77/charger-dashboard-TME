"""
Runtime hook executed by PyInstaller before the main script.

Its only job in the packaged build is to make stdout/stderr safe: in
--windowed builds they are None, and server.py / tme_token_bridge.py write
diagnostics to them. Everything else (BASE_DIR normalization, in-process
bridge, single-instance logic) lives in launcher.py so there is exactly one
execution path and no import-order confusion.
"""
import os
import sys
import time

APP_NAME = "Wallbox Event Timeline"
APP_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(sys.argv[0])))
sys.path.insert(0, APP_DIR)

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


def _log(message):
    line = "%s %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), message)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


# Redirect stdout/stderr to the log file (they are None in --windowed builds).
try:
    _stream = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
    sys.stdout = _stream
    sys.stderr = _stream
except OSError:
    pass

_log("runtime_hook loaded app_dir=%s" % APP_DIR)