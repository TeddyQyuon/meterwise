# MeterWise — Singapore Estate Energy Operations

An independent public-housing operations pilot built around real HDB public building metadata and simulated hourly electricity readings. It is not affiliated with HDB, a Town Council or the Singapore Government, and has no access to their operational systems.

**Live demo:** [MeterWise on Vercel](https://meterwise-kappa.vercel.app/). Each visitor gets a separate persistent demonstration workspace.

## Singapore estate pilot

- Six real HDB blocks in Ang Mo Kio, Bishan and Tampines, representing 620 dwelling units. The source snapshot preserves dataset, record, licence and retrieval details.
- Twenty-four simulated common-service meters covering lighting, lifts, water pumps and rooftop solar. Equipment installations are fictional; the public dataset does not identify them.
- Solar/load matching for each block and hour. Self-consumption, grid import and exported surplus are counted separately; missing intervals withhold derived grid, cost and carbon estimates.
- Town, block and date filters, per-dwelling-unit benchmarks, service breakdowns and an accessible chart data table.
- CSV preview, a two-reading gap-repair sample, duplicate protection and persistent import history.
- Maintenance triage with assignments, evidence notes and an open → in progress → completed → verified workflow. Version checks reject competing updates and prevent false audit events.
- An area-viewer preview restricted by the server to two Ang Mo Kio blocks. It cannot import data or mutate maintenance records.
- Traceable six-block CSV reports, a lighting-load scenario and a sources/methods page.

The root opens the estate pilot. `#overview` opens the original office-building MVP; its data and workflows remain available. The estate pilot seeds fourteen completed historical SGT days and caps work orders at 100 per visitor workspace.

### Public sources and calculation boundaries

| Source | Use |
| --- | --- |
| [HDB Property Information](https://data.gov.sg/datasets/d_17f5382f26140b1fdae0ba2ef6239d2f/view) | Six selected public records: block, street, town, completion year, floors and dwelling units. Retrieved 4 October 2026 SGT; source data period ends December 2025. |
| [HDB Green Towns Programme](https://www.hdb.gov.sg/about-us/our-role/create-smart-and-sustainable-homes/green-towns-programme) | Context for common-service energy efficiency and electrical sub-metering. |
| [HDB SolarNova and smart electrical sub-meters](https://www.hdb.gov.sg/hdb-pulse/news/2021/hdb-launches-sixth-solarnova-tender-with-smart-electrical-sub-meters-to-optimise-energy-use) | Context for daytime common-service solar consumption and exported surplus. |
| [EMA Singapore Energy Statistics](https://www.ema.gov.sg/resources/singapore-energy-statistics/chapter2) | Historical 2024 grid emission factor: 0.402 kg CO₂/kWh. It is not presented as a current-year factor. |

All meter readings, asset installations, maintenance records and response targets are simulated. S$0.285/kWh is an illustrative flat tariff, not an official tariff or bill; estimates omit GST, contractual pricing and export revenue. Carbon figures are illustrative grid-import estimates, not verified emissions accounting. The lighting scenario estimates load reduction only. This is a reviewable portfolio pilot, not a production government service.

## Original building MVP

A working portfolio MVP for investigating building electricity consumption. It includes a React/Vite frontend, a Node/Express API, a MySQL option through Sequelize, and a Vercel deployment adapter backed by persistent Turso/libSQL storage.

**Live demo:** [MeterWise on Vercel](https://meterwise-kappa.vercel.app/). Every visitor starts with a separate synthetic building workspace.

## Features

- Overview with daily consumption, previous-period comparison, estimated costs, and data coverage.
- Six electricity meters mapped to four fictional tenants/shared areas.
- CSV validation for registered meters, explicit timezones, completed hourly intervals, non-negative consumption, malformed rows, and duplicates.
- Preview before import, content-based import deduplication, and saved import history.
- Configured-threshold consumption alerts, a seeded missing-data alert, and investigation notes/status updates.
- Tenant views enforced by the API. Tenants cannot import readings, alter mappings, or update investigations.
- Downloadable daily meter CSV reports with SGT dates and formula-safe text cells.
- Responsive navigation, keyboard-operable dialogs, screen-reader labels, and an optional chart data table.

## Vercel hosting

The React/Vite frontend and API run on Vercel. `api/[...path].ts` exports a Node.js Web Request/Response handler around the shared application API. Database reads and writes go to Turso using the server-only `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` environment variables. Local SQLite files are never used as production storage.

1. Import this repository into a Vercel project. The checked-in `vercel.json` sets the Vite build, `dist/client` output, Singapore function region, API migration files and security headers.
2. Create a Turso database on a free plan and connect it to the project, or configure the two server environment variables from an existing database. Creating a new integration requires its provider terms to be accepted.
3. Deploy. The adapter creates the schema idempotently on the first database connection. `/api/health` checks an actual database query before returning `ok: true`.
4. Open the app and exercise the sample CSV import, reports, alert investigation and tenant preview.

Each browser gets a random 256-bit, HttpOnly visitor cookie and a separate synthetic workspace. The manager/tenant switch remains a demonstration of server-enforced roles, not real tenant authentication. Do not upload confidential data. Cookies last seven days; clearing them starts another workspace. New synthetic workspaces are capped at 100 to bound seed-storage abuse; existing visitors continue working at capacity. The current demo does not automatically delete old workspaces.

App pages use hash navigation. An API-only rewrite dispatches `/api/:path*`, including nested import and investigation routes, to `api/[...path].ts`. There is no frontend catch-all rewrite.

## Run locally in VS Code

Requires Node.js **22.13 or later** (Node 24 is recommended).

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. Express runs on port 3001. SQLite is the default, so the demo works without a database account. The schema is created from the checked-in migrations and synthetic readings are seeded on first use. Local data persists in `data/meterwise.sqlite`.

The local API trusts only its own origin and the explicit development origins in `CLIENT_ORIGINS` (see `.env.example`). If you run the frontend on a different host or port, add its exact origin there. The hosted Worker accepts same-origin writes only.

To serve the compiled frontend through Express:

```bash
npm run build
npm start
```

Open **http://localhost:3001**.

## Use MySQL

1. Create an empty MySQL database named `meterwise` and grant a local application user access to it.
2. Copy `.env.example` to `.env`.
3. Set `DB_DIALECT=mysql` and your `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` values.
4. Run `npm run dev`. Sequelize connects, creates the demo schema, and seeds the same data.

MySQL is supported by the local adapter but was not integration-tested against a running MySQL server in the build environment. The verified demo paths use local SQLite and Vercel/Turso. The optional Worker/D1 adapter remains in the source.

## Try the full flow

1. Open **Overview**. There are three active alerts and eight missing hourly intervals.
2. Open **Import readings** and download the sample CSV.
3. Choose that file. The preview shows eight valid readings.
4. Import it. Coverage reaches 100% for the complete demo period; the missing-data alert is resolved with an automatic note.
5. Open **Alerts**, investigate an unusual-consumption alert, add a note, and mark it resolved.
6. Open **Meters & tenants** and edit a meter's tenant or threshold.
7. Select **Preview tenant view**. Only Northstar Studio's assigned meters and alerts are accessible.
8. Open **Reports** and download the selected reporting period.

## Reading format

```csv
meter_id,timestamp,consumption_kwh
MW-006,2026-10-01T09:00:00+08:00,4.20
```

`consumption_kwh` is energy used **during a single interval**, not a cumulative meter counter. `timestamp` marks the start of a completed 60-minute interval. The API normalizes timestamps to UTC; analytics and reports group them in `Asia/Singapore`. Missing data is shown as a gap and is not imputed. Zero is a valid consumption value. Imports are limited to 1 MB and 1,500 rows per file.

Estimated costs use the configured demo tariff of S$0.285/kWh. This is a fictional configuration, not a quoted current utility tariff. Taxes and other fees are excluded. Reporting periods are anchored to the newest stored reading. The chart compares the preceding period of the same length, when earlier readings exist. Alerts are listed across all dates for the selected meters.

## Architecture

| Location | Purpose |
|---|---|
| `src/` | React/Vite dashboard and Tailwind/custom CSS |
| `shared/` | Types, Singapore-time calculations, and CSV validation |
| `server/api.ts` | Shared API, scope checks, import processing, reporting, and alert workflow |
| `server/express.ts` | Node/Express HTTP adapter for local development and independent deployment |
| `server/local-database.ts` | Persistent SQLite demo and Sequelize/MySQL adapters |
| `server/worker.ts` | Optional Worker adapter using D1 and trusted platform user identity |
| `api/[...path].ts`, `server/vercel.ts` | Vercel API with separate browser demo workspaces |
| `server/libsql-database.ts` | Persistent Turso adapter with transactional writes |
| `db/schema.ts`, `drizzle/` | Hosted database schema and schema-only migrations |
| `tests/` | Calculation, import, report, role-boundary, and workflow checks |

The optional Worker deployment uses platform sign-in and persistent D1 storage. It has a separate synthetic workspace for each trusted signed-in platform identity. The local Express version deliberately has a shared **demo** identity. The manager/tenant switch previews server-enforced permissions; it is not public tenant onboarding or password authentication. Before offering this to real tenants, provision real memberships and roles, remove the demo switch, and add operational authentication and access controls to the independent Express deployment.

## Checks

```bash
npm run check
npm test
npm run build
```

See `VERIFICATION.md` for results and current limitations.

For responsive browser checks, open `/tests/browser/responsive.html` on the development server. The local-only harness embeds the app at phone, tablet, or desktop widths; it is excluded from the production Vite build. Screenshots and the CSV files downloaded during browser QA are in `docs/qa/`.

## Next development milestone

Connect a real meter-data source, provision manager and tenant memberships, then add a Python forecasting service. Evaluate forecasts on a chronological holdout against a seasonal baseline. This version includes no AI forecasts and does not report fabricated model performance.

## Version 1.1 improvements

The facilities workspace now has a dark navigation rail, a prominent consumption card, clearer status colors and explicit S$ labels. The mobile drawer supports keyboard focus containment and Escape. CSV selection is keyboard accessible, invalid selections clear stale previews, and exports stay unavailable while selected results are loading or invalid.

API writes require JSON objects encoded as UTF-8. Request streams stop at 1.1 MB, CSV duplicate checks query only candidate intervals, and cross-site writes are rejected. Hosted documents, errors and downloads receive security headers, including a document Content Security Policy. See `SECURITY.md` and `VERIFICATION.md` for tested scope and limitations.

## Vercel migration status — 3 October 2026

Version 1.2 is live on Vercel with persistent Turso storage. All 14 automated tests, both TypeScript configurations and the production build pass. Ten production HTTP checks verify remote imports, reports, saved edits, role restrictions and separate visitor workspaces. Cloud-browser checks confirm an eight-reading import survives a reload, coverage reaches 100%, and the downloaded report contains 42 daily meter rows.

Production testing also corrected Node ESM import paths and nested API routing. A NodeNext compiler check now guards the server imports; API failures show a recoverable message instead of a JSON parsing error. See `VERIFICATION.md` for the recorded live checks and screenshots.
