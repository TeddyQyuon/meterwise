# MeterWise verification

Build date: 2 October 2026.

## Automated results

`npm test`: **11 tests passed**, including integration scenarios that exercise the shared API with a real in-memory SQLite database.

- Singapore day boundaries, daily aggregation, and equal-length comparison periods.
- Expected completed hourly intervals and valid zero consumption.
- BOM, reordered CSV columns, quoted commas/newlines, malformed quotes, duplicate rows, unregistered meters, negative consumption, timezone requirements, invalid calendar dates, and unfinished intervals.
- Sample import adds exactly eight readings; repeat import is idempotent; coverage becomes 100%; the data-gap alert resolves automatically.
- Daily meter report generation and estimated-cost arithmetic.
- Investigation status/note persistence and meter remapping.
- Tenant read scope, manager-only writes, inaccessible meters/alerts, owner isolation, cross-origin write rejection, and invalidation of the prior role session.
- Formula-safe text in CSV exports.
- Hosted identity keeps the demo role server-side without depending on third-party cookies.
- Explicitly configured development origins work through the proxy; unrelated origins and lookalike domains remain blocked. The hosted default remains same-origin.

`npm run check`: TypeScript check passed.

`npm run build`: Production client and Worker build passed.

## Cloud browser results

Tested on 2 October 2026 in cloud Chrome against the supervised development preview, using the real Express API and persistent local SQLite database. Browser actions uploaded synthetic CSV files, changed demo records, reloaded the app, and downloaded actual report files. Production D1 data was not changed by these tests.

| Scenario | Observed result |
| --- | --- |
| Initial load and refresh | Dashboard loads successfully after correcting the development-proxy origin check. |
| Chart controls | Consumption/cost switching and the accessible daily data table work. |
| Reporting filters | Seven-day and thirty-day periods, tenant filtering, and custom-date validation work. Reversed dates show a recoverable error. |
| Meter mapping | Changed MW-001 to Juniper Labs and its threshold to 19; both persisted after reload. Restored Northstar Studio and 18 afterward. |
| Invalid CSV | Unknown meter, negative consumption, and a misaligned interval produce three row-specific errors. Import is disabled. |
| Valid sample | Eight readings imported. Consumption increased from 4,051.35 to 4,084.95 kWh; coverage increased from 99.2% to 100%. |
| Duplicate CSV | Re-upload identifies all eight rows as duplicates and disables import. Import history survives reload. |
| Data-gap alert | Resolves automatically after import, with the system note explaining that all intervals were restored. |
| Investigation | Resolving without a note is rejected. Resolving with a note persists both the status and note after reload. |
| Manager report | Download contains 42 daily rows, all six meters, and 4,084.95 kWh in total. |
| Tenant report and view | Northstar Studio sees only MW-001/MW-002, no mapping/import controls, and a report with 14 rows totaling 1,586.56 kWh. Tenant role persists after reload. |
| Phone layout | Overview, meters, imports, alerts, and reports fit a 390 px iframe (375 px content width with the browser scrollbar). Navigation opens and closes on selection; the meter dialog also closes with Escape. |
| Tablet layout | Meter and report screens fit a 768 px iframe (753 px content width). |
| Table containment | Phone document width equals its viewport width; wide table content scrolls within its own container. |
| Export accessibility | The icon-only phone export link retains the accessible name “Export report”. |
| Console | No application warnings or errors recorded in either test tab. Browser-extension diagnostics were excluded. |

### Issues fixed during browser testing

1. The local API compared the frontend Origin with the proxy's internal Host, blocking session creation. The Express adapter now supplies a server-controlled list of trusted frontend origins. Untrusted origins still fail, and the hosted Worker keeps its same-origin behavior.
2. The visually hidden Actions table heading escaped its scroll container and expanded the phone document from 375 to 833 px. Positioning the table scroll container makes it the heading's containing block and keeps scrolling inside the table.
3. Hiding the export link's visible text on phone layouts removed its accessible name. An explicit `aria-label` preserves it.

### Evidence

- [Desktop dashboard after importing the sample](docs/qa/desktop.jpg).
- [Phone viewport after the accessibility/layout fixes](docs/qa/phone.jpg).
- [Building CSV downloaded through the browser](docs/qa/building-report.csv).
- [Tenant CSV downloaded through the browser](docs/qa/tenant-report.csv).

The source includes a local-only responsive harness at `tests/browser/responsive.html` to reproduce the narrow viewport checks. This verifies responsive rendering and mouse/keyboard interaction; it does not emulate mobile hardware or touch input.

## Version 1.1 upgrade checks

- Dependency audit changed from 12 affected packages (6 high, 6 moderate) to **0 known vulnerabilities** on 2 October 2026. Full reports are in `docs/security/`.
- Four security regressions cover malformed/invalid UTF-8 JSON, JSON-only writes, byte-bounded streams and cancellation, cross-site writes without Origin, response headers, candidate-only duplicate checks, and unsafe filenames.
- TypeScript, all 11 tests, production build and Drizzle generation pass after dependency updates. Drizzle reports no schema change. Sequelize UUID v1/v4 defaults work with the compatible patched UUID dependency; a running MySQL server was not tested.
- Browser checks confirm invalid date ranges label retained results and disable exports. Choosing a valid period restores the export link. Northstar Studio filtering displays 1,587 kWh and S$452.17; the building view displays 4,085 kWh and S$1,164.21 (rounded display values).
- A mixed four-row CSV preview shows 1 valid, 2 duplicate and 1 invalid row. A non-CSV selection clears the previous file/preview. Re-selecting the same CSV works; committing stores only the one valid interval and records the skipped rows in history. All writes use the local synthetic demo.
- The downloaded building report still contains 42 daily meter rows. The read-only tenant view shows two meters and no edit/import controls.
- At 390 px, phone content width and document scroll width are both 375 px; at 768 px both are 753 px. Wide meter tables remain inside their scroll container.
- The mobile drawer focuses its close button, wraps Shift+Tab to Reports, closes with Escape, restores focus to Open navigation, and closes on page selection. Page changes reset the content scroll position.
- Chart lines render immediately when switching measures; accessible chart tables and SGD labels remain available.

Evidence: [dashboard](docs/qa/v1.1/desktop.jpg), [CSV validation](docs/qa/v1.1/imports.jpg), [phone viewport](docs/qa/v1.1/phone.jpg), [downloaded report](docs/qa/v1.1/building-report.csv).

## Limits

- The initial dataset is synthetic; alerts use explicit thresholds and expected intervals.
- The local Node demo uses SQLite by default. The Sequelize/MySQL adapter was supplied but a MySQL daemon was unavailable for integration testing.
- Browser UI checks used the local Express/SQLite adapter. The hosted D1 adapter is covered by shared API/identity tests and deployment/build checks, not a browser round-trip to production.
- The browser exposed no registered WebMCP tools, so the optional read-only energy-summary integration could not be exercised in this browser.
- Demo role switching demonstrates server-side view/write checks. Real tenant account provisioning is a separate next milestone.
- Forecasting, hardware integration, automated notifications, and live tariffs are not implemented in this first version.

## Vercel migration checks — 3 October 2026

Version 1.2: **14 tests pass**, TypeScript checks pass, production Vite build passes, and the full npm dependency audit reports **0 known vulnerabilities**.

New integration tests use the real libSQL client against a local SQLite file. They verify imported readings and history survive closing and reopening the client; separate browser workspaces cannot read each other's alerts; Secure/HttpOnly/SameSite cookies; tenant write restrictions; rejected missing/foreign/cross-site origins before database access; generic database-failure responses; atomic batch rollback; and a bound on new synthetic workspaces.

Remote Turso and live Vercel browser checks are pending provider integration consent. The local libSQL test does not demonstrate a remote database connection.
