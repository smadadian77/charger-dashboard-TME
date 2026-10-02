# Charger Dashboard - Angular Edition

Angular 21 and Python desktop dashboard for inspecting charger fleets and charger telemetry.

## Desktop Launch

The launch scripts start the local Python API in a PyWebView window. Build the Angular assets first, especially after frontend changes:

- **Option A (Double-Click):** Double-click [`launch.bat`](file:///c:/Users/s.madadian/Charger-Dashboard-Angular/launch.bat) directly in Windows Explorer.
- **Option B (PowerShell):** Run `.\launch.ps1`
- **Option C (Python):** Run `python launcher.py`

The launcher does not run the Angular development server or rebuild the frontend.

---

## Architectural Overview

### 1. Frontend: Angular (v21+)
- **Current structure:** Angular bootstraps a static root template. Fleet, charger diagnostics, and operations are DOM views controlled by `src/dashboard-engine.js`.
- **Migration status:** `src/app/app.routes.ts` is currently empty; the screens are not yet route-driven Angular feature components. The staged target is documented in `ARCHITECTURE_ENHANCEMENT_PLAN.md`.
- **Styling:** Toyota Motor Europe styles, CSS variables, light/dark themes, and responsive rules live in `src/styles.css`.
- **Telemetry:** The UI checks upstream SSE availability but does not maintain a persistent browser `EventSource` connection.

### 2. Backend Recommendation: Python vs Java
**Decision: Python is retained as the recommended best practice for this backend.**
- **Why Python?** 
  1. The core backend functionality depends on **Playwright** (`tme_token_bridge.py`) for automated headless browser session capture and JWT token extraction. In Python, this is lightweight, portable, and requires no external JVM runtime.
  2. A Java (Spring Boot) backend would introduce significant JVM overhead (~300MB+ idle memory vs ~30MB for Python), slower cold-starts, and complex Playwright/Selenium Maven wrappers.
  3. Python's lightweight local proxying (`http.server` or FastAPI) is standard and ideal for local operational dashboards.

## Manual Execution (Alternative)

### 1. Run the Python Backend Server
From the project root:
```bash
python server/server.py
```
*(Local API: `http://localhost:8000`)*

### 2. Run the Angular Frontend
```bash
npm start
```
*(Runs on `http://localhost:4200` and automatically proxies `/api` calls to `http://127.0.0.1:8000` via `proxy.conf.json`)*

### 3. Build for Production
```bash
npm run build
```
Production assets are generated in `dist/Charger-Dashboard-Angular`.

### 4. Run Tests

```bash
npm test
npm run test:backend
npm run test:all
```

Frontend tests use Angular's Vitest builder. Backend tests use Python's standard-library `unittest` with synthetic data and do not call TME or AI services.

## Project Structure
```
Charger-Dashboard-Angular/
├── launch.bat
├── launch.ps1
├── launcher.py
├── public/                           # Logos and icons
├── src/
│   ├── app/
│   │   ├── app.html
│   │   ├── app.ts
│   │   ├── app.routes.ts
│   │   ├── app.spec.ts
│   │   └── dashboard-bootstrap.ts
│   ├── dashboard-engine.js            # Current dashboard behavior
│   └── styles.css
├── server/
│   ├── backend/                       # Configuration, auth, and services
│   ├── tests/                         # Offline backend tests
│   └── server.py                      # Local API and static file server
├── proxy.conf.json                    # Angular dev-server API proxy
├── ARCHITECTURE_ENHANCEMENT_PLAN.md
└── package.json
```

