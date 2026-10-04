# MeterWise — Singapore Estate Energy Operations

An independent public-housing operations pilot using real HDB public building metadata and simulated energy and maintenance records. It is not affiliated with HDB, a Town Council or the Singapore Government.

**Live demo:** https://meterwise-kappa.vercel.app/

## Stack

- React, Vite, Tailwind CSS, Recharts and TypeScript for the frontend.
- **Python 3.12 and FastAPI** for the entire REST backend: sessions, analytics, CSV validation/imports, reports, meter mapping and maintenance audit trails.
- Python SQLite for local development; persistent Turso/libSQL over HTTPS for Vercel.
- Vercel serves the built frontend and the Python ASGI function in Singapore. Node.js is used only by the frontend build tooling.

Version 2.1 replaces the TypeScript backend and removes Express, Sequelize, MySQL and the optional Worker/D1 runtime. Existing Turso table names, visitor/session cookies, workspace hashes, historical seed windows, API paths and saved records are preserved. No database reset is required. The SQL migrations in `drizzle/` are retained as historical schema files; Python applies them idempotently.

## Estate workflows

- Six real HDB blocks in Ang Mo Kio, Bishan and Tampines, representing 620 public-record dwelling units.
- Twenty-four simulated meters covering common-area lighting, lifts, pumps and rooftop solar over fourteen completed SGT days.
- Solar/load matching separately for every block and hour. Grid imports, self-consumption and surplus exports are counted separately. Missing readings withhold derived energy, cost and carbon figures; valid zeros count as readings.
- Town/block/date filters, service breakdowns, public-dwelling-unit benchmarks and an accessible chart data table.
- CSV preview, a two-reading gap-repair sample, content deduplication and persistent import history.
- Evidence-based open → in progress → completed → verified work orders. Optimistic version checks and an atomic update/event transaction reject conflicting saves without false audit events. Completed orders can return for rework and verified orders can reopen.
- Area viewers are restricted by the backend to two Ang Mo Kio blocks, eight assets and read-only reports. Only managers import readings or edit orders.
- Traceable six-block CSV reports, an illustrative lighting scenario and sources/methods.

The root opens the estate pilot. `#overview` opens the original building demo with six meters, four fictional tenants, thirty historical days, alert investigation notes, tenant/meter mapping, eight-reading CSV repair and daily meter reports. Its dataset and import history remain separate from the estate pilot.

## Public sources and boundaries

| Source | Use |
| --- | --- |
| [HDB Property Information](https://data.gov.sg/datasets/d_17f5382f26140b1fdae0ba2ef6239d2f/view) | Six selected block records, streets, towns, completion years, floors and dwelling units. Retrieved 4 October 2026 SGT; source period ends December 2025. |
| [HDB Green Towns Programme](https://www.hdb.gov.sg/about-us/our-role/create-smart-and-sustainable-homes/green-towns-programme) | Context for common-service efficiency and sub-metering. |
| [HDB SolarNova](https://www.hdb.gov.sg/hdb-pulse/news/2021/hdb-launches-sixth-solarnova-tender-with-smart-electrical-sub-meters-to-optimise-energy-use) | Context for daytime common-service solar use and exported surplus. |
| [EMA Singapore Energy Statistics](https://www.ema.gov.sg/resources/singapore-energy-statistics/chapter2) | Historical **2024** grid emission factor of **0.402 kg CO₂/kWh**. |

Asset installations, meter readings, maintenance records and 24/72-hour response targets are simulated. S$0.285/kWh is an illustrative flat tariff excluding GST, contract pricing and export revenue. Carbon estimates are illustrative, not verified emissions accounting. The lighting scenario estimates load reduction only. No real hardware, resident details, contractor dispatch, agency authentication or live tariffs are connected.

## Run in VS Code

Install Node.js 24 and Python 3.12. Create and activate a virtual environment:

```bash
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS / Linux:
source .venv/bin/activate
```

Then:

```bash
python -m pip install -r requirements-dev.txt
npm ci
npm run dev
```

Open http://localhost:5173. FastAPI runs on port 3001; Vite proxies `/api` to it. SQLite persists locally at `data/meterwise.sqlite`. The Node launcher finds `.venv` on Windows, macOS and Linux; `PYTHON_BIN` can select another Python executable.

Copy `.env.example` to `.env` for optional local settings. `npm run dev` loads it. Only the exact development origins in `CLIENT_ORIGINS` can write through the proxy. Production always requires the exact request origin.

To serve the built frontend through Python:

```bash
npm run build
npm start
```

Open http://localhost:3001. To run the backend directly, use `python -m uvicorn backend.app:app --host 127.0.0.1 --port 3001` from the activated environment.

## Vercel

`vercel.json` defines separate Vite and FastAPI services on the existing domain. `/api/(.*)` routes to the Python `backend.app:app` entrypoint; other paths route to the built frontend. Services preserve the original request paths. The checked-in Python version and dependency pins are used by the Python runtime.

Keep the existing **server-only** `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` project environment variables. Never prefix secrets with `VITE_`. Vercel requires Turso; it cannot fall back to an ephemeral SQLite file. The health endpoint queries the database and identifies `backend: Python`, `framework: FastAPI`, version 2.1.0 and Turso storage. Protected previews remain protected.

Each visitor gets a random 256-bit HttpOnly/Secure/SameSite workspace cookie plus an expiring session cookie. The public manager/tenant switch demonstrates server-enforced roles; it is not real account provisioning. Workspaces are isolated and persistent. New workspaces are atomically capped at 100 and orders at 100 per workspace. Clearing cookies starts a new workspace; the demo does not automatically delete old workspaces. Use synthetic data only.

## Verification

```bash
python -m pytest -q
ruff check backend api tests/python
npm run check
npm run build
pip-audit -r requirements.txt
npm audit
```

The Python suite checks the old TypeScript API response contract, energy balances, missing-versus-zero data, persistent restarts and old cookie identity, CSV bounds, role and workspace isolation, origin checks, streamed body limits, stale/racing updates and transaction rollback. The real Turso HTTP adapter is exercised through a protocol transport backed by SQLite; live Vercel/Turso checks are recorded separately.

`python scripts/verify-estate-live.py` verifies two fresh synthetic workspaces on the published app. Evidence and limits are in `VERIFICATION.md` and `SECURITY.md`; historical v1/v2 evidence remains available.
