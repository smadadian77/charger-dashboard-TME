"""
Build script for Charger-Dashboard-Angular.
Bundles Angular app and Python backend into a standalone native desktop .exe using PyInstaller & pywebview.
"""
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = HERE
BUILD_DIR = os.path.join(HERE, "build")
BUILD_DIST_DIR = os.path.join(HERE, "build-dist")
EXE_NAME = "ChargerDashboardAngular.exe"
FINAL_EXE = os.path.join(BUILD_DIST_DIR, EXE_NAME)

PYINSTALLER_EXE = r"C:\Users\s.madadian\AppData\Roaming\Python\Python313\Scripts\pyinstaller.exe"
if not os.path.exists(PYINSTALLER_EXE):
    PYINSTALLER_EXE = "pyinstaller"


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def step1_build_angular():
    log("Step 1/4: Building Angular production bundle...")
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    res = subprocess.run([npm_cmd, "run", "build"], cwd=HERE)
    if res.returncode != 0:
        raise SystemExit(f"Angular build failed with exit code {res.returncode}")
    
    angular_browser = os.path.join(HERE, "dist", "Charger-Dashboard-Angular", "browser")
    if not os.path.isdir(angular_browser):
        raise SystemExit(f"Angular output directory not found: {angular_browser}")
    log("Angular build completed successfully.")


def step2_clean():
    log("Step 2/4: Cleaning build artifacts...")
    for p in [BUILD_DIR, os.path.join(HERE, "dist_exe")]:
        if os.path.exists(p):
            shutil.rmtree(p, ignore_errors=True)
    os.makedirs(BUILD_DIST_DIR, exist_ok=True)
    if os.path.exists(FINAL_EXE):
        try:
            os.remove(FINAL_EXE)
        except OSError:
            pass


def step3_pyinstaller():
    log("Step 3/4: Packaging into native desktop GUI executable with PyInstaller...")

    server_dir = os.path.join(HERE, "server")
    angular_dist = os.path.join(HERE, "dist", "Charger-Dashboard-Angular", "browser")
    public_dir = os.path.join(HERE, "public")

    cmd = [
        PYINSTALLER_EXE,
        "--clean",
        "--noconfirm",
        "--name", "ChargerDashboardAngular",
        "--windowed",
        "--noconsole",
        "--runtime-hook", os.path.join(HERE, "runtime_hook.py"),
        "--paths", server_dir,
        "--paths", HERE,
        "--hiddenimport", "webview",
        "--hiddenimport", "clr_loader",
        "--hiddenimport", "pythonnet",
        "--hiddenimport", "bottle",
        "--hiddenimport", "proxy_tools",
        "--hidden-import", "backend",
        "--hidden-import", "backend.config",
        "--hidden-import", "backend.auth",
        "--hidden-import", "backend.services.serial_service",
        "--hidden-import", "backend.services.outages_service",
        "--hidden-import", "smart_investigations",
        "--hidden-import", "tme_token_bridge",
        "--collect-submodules", "backend",
        "--collect-data", "backend",
        "--add-data", f"{server_dir};server",
        "--add-data", f"{angular_dist};dist/Charger-Dashboard-Angular/browser",
        "--add-data", f"{public_dir};public",
    ]

    toyota_ico = os.path.join(public_dir, "toyota-logo.ico")
    if os.path.exists(toyota_ico):
        cmd.extend(["--icon", toyota_ico])

    cmd.extend(["--onefile", os.path.join(HERE, "launcher.py")])

    res = subprocess.run(cmd, cwd=HERE)
    if res.returncode != 0:
        raise SystemExit(f"PyInstaller failed with code {res.returncode}")
    log("PyInstaller packaging completed.")


def step4_finalize():
    log("Step 4/4: Moving executable to build-dist folder...")
    built_exe = os.path.join(HERE, "dist", "ChargerDashboardAngular.exe")
    if not os.path.exists(built_exe):
        built_exe_alt = os.path.join(HERE, "dist", "ChargerDashboardAngular", "ChargerDashboardAngular.exe")
        if os.path.exists(built_exe_alt):
            built_exe = built_exe_alt

    if not os.path.exists(built_exe):
        raise SystemExit(f"Built executable not found at {built_exe}")

    shutil.copy2(built_exe, FINAL_EXE)
    size_mb = round(os.path.getsize(FINAL_EXE) / (1024 * 1024), 2)
    log("==================================================================")
    log(f"SUCCESS: Native Desktop Executable created in separate build folder!")
    log(f"Location: {FINAL_EXE} ({size_mb} MB)")
    log("==================================================================")


def main():
    step1_build_angular()
    step2_clean()
    step3_pyinstaller()
    step4_finalize()


if __name__ == "__main__":
    main()

