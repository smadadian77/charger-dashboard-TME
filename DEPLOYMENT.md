# Wallbox Event Timeline Dashboard — Deployment Note

Single-file Windows executable: `WallboxDashboard.exe` (14.5 MB, AMD64, no console).

## Architecture

```
PyInstaller one-file EXE
  └── launcher.py
        ├── runtime_hook.py   (safe logging, patches server.BASE_DIR)
        ├── pywebview        (Edge WebView2 backend)
        │     └── native Toyota-branded window
        └── server.py        (existing stdlib HTTP server on a daemon thread)
              └── 127.0.0.1:8000
```

The existing application, frontend, and token-capture logic are unchanged. The launcher wraps them with a native window.

## Prerequisites

- **Windows 10/11** (64-bit).
- **Microsoft Edge WebView2 Runtime** — included in Windows 11; on Windows 10 it is normally present but a small number of systems may lack it. If the runtime is missing the app shows a native Windows message box and writes the technical detail to the log. Install the Evergreen Runtime from Microsoft if that dialog appears; do not embed the ~250 MB Fixed Version runtime.
- **Chrome (or Edge)** — **required** for token capture, not merely preferred. The bridge scans Chrome/Edge Local and Session Storage for the TME JWT and POSTs it back to `http://localhost:8000/api/tme-token`. The dashboard itself runs in WebView2, not Chrome.

## What is truly one-file

Yes. `WallboxDashboard.exe` is a PyInstaller one-file build. On launch it extracts to a temporary `_MEIxxxxxx` directory, runs, and cleans it up on exit. Startup is therefore a little slower than a one-folder install on first run.

## Where logs are stored

`%LOCALAPPDATA%\Wallbox Event Timeline\logs\dashboard.log`

Never contains tokens, cookies, or passwords.

## Known issue fixed in this build

The one-file build initially returned **403 Forbidden** for every static asset. Cause: PyInstaller's extraction directory is an 8.3 short path (`SD121~1.MAD`), while `server.py`'s file-serving guard compares `BASE_DIR` against `os.path.realpath(file_path)`, which resolves to the long form — so the two never matched. Fixed in `runtime_hook.py` by normalizing `BASE_DIR` through `realpath` before patching `server.py`. Verified: `/`, `/index.html`, `/app.js`, `/style.css`, and `/api/health` all return **200**.

## Known issue fixed in this build

The first packaged build reported **"already running" on every launch** and **never opened the TME tab or captured a token**. Both had one cause: `server.py`'s `start_token_capture()` spawns `[sys.executable, "tme_token_bridge.py"]`, and in the packaged build `sys.executable` is `WallboxDashboard.exe` — so it re-ran the launcher (a second instance -> "already running") instead of the bridge. Fixed in `launcher.py`, which now patches `start_token_capture` and `is_token_capture_running` on the exact module object serving HTTP and runs the bridge **in-process on a daemon thread**. The single-instance check also now decides on a live-process lookup rather than mutex state, so a stale mutex from a killed process no longer blocks a fresh launch. Verified: the bridge starts in-process, opens the TME page in Chrome, and the captured JWT is saved automatically.

## Known issue fixed in this build

A second launch after closing all windows still showed **"already running"**. Cause: the named mutex was never released on exit, so the lock leaked. Fixed in `launcher.py`:

- The mutex name dropped the `Global\` prefix (`Global\WallboxDashboardSingleton` -> `WallboxDashboardSingleton`) because `Global\` requires `SeCreateGlobalPrivilege`, which non-admin users lack, so `CreateMutexW` silently failed and every invocation started.
- The mutex is now released and the handle closed in a `finally` path via `atexit`, so a clean shutdown never leaks the lock.
- The single-instance check now verifies a **live process** (`psutil` with a ctypes `Process32First` fallback) before trusting the mutex, so a stale lock from a crashed or force-killed process is reclaimed and the app proceeds.
- Verified end-to-end: launch -> 200 on `/api/health`; second launch -> duplicate dialog, process exits; kill first; relaunch -> 200 again.

## How to run

Double-click `WallboxDashboard.exe`. A native Toyota-branded window opens; no console appears. When a token is required, the dashboard asks the existing bridge to open the TME page in Chrome; capture then completes automatically.

## Single instance

A Windows named mutex (`WallboxDashboardSingleton`) prevents a second copy from starting. A second double-click shows "The dashboard is already running." The mutex is released on shutdown (via `atexit`), and the check verifies a live process before trusting the mutex, so a stale lock from a crashed or force-killed process is reclaimed automatically.

## Shutdown

Closing the window signals the HTTP server to shut down; worker threads are daemonized so the process never hangs on a WebView2 keep-alive connection.

## Rebuild

```
cd "C:\Users\s.madadian\Desktop\Customer Support\Scripts\requests\2026-09-25-log-management-timeline-dashboard"
python build.py
```

`build.py` kills any running instance, cleans previous artifacts, regenerates the Toyota icon if missing, runs PyInstaller (one-file, windowed, no console) with the runtime hook and all bundled assets, copies the EXE to `requests/WallboxDashboard.exe`, and smoke-tests it. Pass `--launch` to also launch the EXE afterwards. `build.ps1` is a thin PowerShell wrapper around the same driver.

## AV / endpoint security

This is ordinary PyInstaller packaging: no packers, no obfuscation, no persistence, no hidden network access, localhost-only server binding, predictable behavior, reproducible builds. It is not "guaranteed AV-safe." If an endpoint product flags it, submit the file as a false positive or allowlist it after verifying the build.

Digitally sign the EXE with a valid Authenticode certificate before enterprise distribution.