#!/usr/bin/env python3
"""One-click build driver for the Wallbox Event Timeline Dashboard.

Usage:
    python build.py                # one-file build + smoke test
    python build.py --launch       # build, smoke test, then launch the EXE
    python build.py --mode onefolder

It kills any running instance, cleans previous artifacts, regenerates the
Toyota icon if missing, runs PyInstaller, copies the EXE next to the source
folder, and smoke-tests the bundled executable.
"""
import os
import shutil
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP = HERE
ROOT = os.path.dirname(HERE)
NAME = "WallboxDashboard"
EXE = os.path.join(ROOT, NAME + ".exe")
PYI = [sys.executable, "-m", "PyInstaller"]

ASSETS = [
    "server.py",
    "index.html",
    "app.js",
    "style.css",
    "tme_token_bridge.py",
    "toyota-logo.ico",
    "toyota-logo.svg",
    "toyota-logo-256.png",
    "toyota-logo-128.png",
    "toyota-logo-64.png",
    "toyota-logo-48.png",
    "toyota-logo-32.png",
]


def run(cmd, **kw):
    print("+", " ".join(cmd))
    return subprocess.run(cmd, cwd=APP, **kw)


def kill_instances():
    """Kill any running dashboard/browser processes.

    Pure Python: no PowerShell subprocess, so a stuck host can never block
    the build. Uses psutil when available and falls back to os.kill.
    Retries a couple of times because the launcher spawns a child process.
    """
    print("[1/5] Killing any running instance...", flush=True)
    names = {"WallboxDashboard", "python", "msedge", "chrome", "cscript", "wscript"}
    killed = 0
    for attempt in range(3):
        try:
            import psutil
            for proc in psutil.process_iter(["pid", "name"]):
                try:
                    if (proc.info.get("name") or "").lower() in {n.lower() for n in names}:
                        proc.kill()
                        killed += 1
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except ImportError:
            try:
                import ctypes
                TH32CS_SNAPPROCESS = 2
                PROCESS_ALL_ACCESS = 0x1FFFFF
                snapshot = ctypes.windll.kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
                entry = PROCESSENTRY32()
                entry.dwSize = ctypes.sizeof(entry)
                if ctypes.windll.kernel32.Process32First(snapshot, ctypes.byref(entry)):
                    while True:
                        name = entry.szExeFile.decode("utf-8", "replace").lower()
                        if name in {n.lower() for n in names}:
                            try:
                                handle = ctypes.windll.kernel32.OpenProcess(PROCESS_ALL_ACCESS, 0, entry.th32ProcessID)
                                if handle:
                                    ctypes.windll.kernel32.TerminateProcess(handle, 1)
                                    ctypes.windll.kernel32.CloseHandle(handle)
                                    killed += 1
                            except OSError:
                                pass
                        if not ctypes.windll.kernel32.Process32Next(snapshot, ctypes.byref(entry)):
                            break
                ctypes.windll.kernel32.CloseHandle(snapshot)
            except Exception:
                pass
        time.sleep(2)
    print("kill_instances done: killed %d" % killed, flush=True)


def clean():
    print("[2/5] Cleaning previous build artifacts...")
    for path in ("build", "dist", "__pycache__"):
        p = os.path.join(APP, path)
        if os.path.exists(p):
            shutil.rmtree(p, ignore_errors=True)
    if os.path.exists(EXE):
        os.remove(EXE)


def ensure_icon():
    ico = os.path.join(APP, "toyota-logo.ico")
    svg = os.path.join(APP, "toyota-logo.svg")
    if not (os.path.exists(ico) and os.path.exists(svg)):
        print("[2b] Generating Toyota icon...")
        subprocess.run([sys.executable, os.path.join(APP, "make_icon.py")],
                       cwd=APP, check=True)


def build(mode="onefile"):
    print("[3/5] Building with PyInstaller (%s)..." % mode)
    args = list(PYI) + [
        "--clean", "--noconfirm",
        "--name", NAME,
        "--windowed", "--noconsole",
        "--runtime-hook", "runtime_hook.py",
        "--hiddenimport", "webview",
        "--hiddenimport", "clr_loader",
        "--hiddenimport", "pythonnet",
        "--hiddenimport", "bottle",
        "--hiddenimport", "proxy_tools",
    ]
    for asset in ASSETS:
        args += ["--add-data", asset + ";."]
    args += ["--icon", "toyota-logo.ico"]
    args += ["--onefile" if mode == "onefile" else "--onedir"]
    args += ["launcher.py"]
    proc = run(args, check=False)
    if proc.returncode != 0:
        raise SystemExit("pyinstaller failed with exit code %d" % proc.returncode)


def copy_exe(mode="onefile"):
    print("[4/5] Copying executable...", flush=True)
    built = os.path.join(APP, "dist", NAME + ".exe") if mode == "onefile" \
        else os.path.join(APP, "dist", NAME, NAME + ".exe")
    if not os.path.exists(built):
        raise SystemExit("PyInstaller output not found: %s" % built)
    shutil.copy2(built, EXE)
    print("Built -> %s (%d bytes)" % (EXE, os.path.getsize(EXE)), flush=True)


def smoke_test(timeout=600):
    print("[5/5] Smoke testing the bundled executable...")
    test_dir = os.path.join(os.environ.get("TEMP", "/tmp"), "wallbox-build-test")
    if os.path.exists(test_dir):
        shutil.rmtree(test_dir, ignore_errors=True)
    os.makedirs(test_dir, exist_ok=True)
    script = os.path.join(test_dir, "verify.ps1")
    with open(script, "w", encoding="ascii") as handle:
        handle.write(
            '$ErrorActionPreference = "Continue"\n'
            '$base = "http://127.0.0.1:8000"\n'
            '$fail = $false\n'
            'foreach ($path in @("/", "/index.html", "/app.js", "/style.css", '
            '"/api/health")) {\n'
            '  try {\n'
            '    $r = Invoke-WebRequest -Uri ($base + $path) -UseBasicParsing -TimeoutSec 10\n'
            '    Write-Host ("OK  {0} {1}" -f $r.StatusCode, $path)\n'
            '  } catch {\n'
            '    Write-Host ("ERR {0} -> {1}" -f $path, $_.Exception.Message)\n'
            '    $fail = $true\n'
            '  }\n'
            '}\n'
            'if ($fail) { exit 1 } else { exit 0 }\n'
        )

    launcher = subprocess.Popen([EXE], cwd=ROOT)
    deadline = time.time() + timeout
    ok = False
    while time.time() < deadline:
        time.sleep(2)
        if launcher.poll() is not None:
            print("launcher exited early")
            break
        r = subprocess.run(
            ["powershell", "-NoProfile", "-File", script],
            capture_output=True, text=True, timeout=30,
        )
        if r.stdout:
            print(r.stdout.rstrip())
        if r.returncode == 0:
            ok = True
            break
    if not ok:
        log = os.path.join(os.environ.get("TEMP", "/tmp"), "dashboard.log")
        if os.path.exists(log):
            with open(log, encoding="utf-8", errors="replace") as handle:
                print(handle.read()[-2000:])
        launcher.terminate()
        raise SystemExit("Smoke test failed: the bundled executable did not serve the dashboard.")
    launcher.terminate()
    try:
        launcher.wait(timeout=5)
    except subprocess.TimeoutExpired:
        launcher.kill()
    print("Smoke test passed.")


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["onefile", "onefolder"], default="onefile")
    parser.add_argument("--launch", action="store_true",
                        help="launch the EXE after a successful build")
    args = parser.parse_args()

    kill_instances()
    clean()
    ensure_icon()
    build(args.mode)
    copy_exe(args.mode)
    smoke_test()
    print("Build complete: %s" % EXE)
    if args.launch:
        subprocess.Popen([EXE], cwd=ROOT)


if __name__ == "__main__":
    main()