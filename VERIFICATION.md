# MeterWise verification

Initial build: 2 October 2026. Vercel release verification: 3 October 2026.

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
- The earlier version 1.1 browser checks used the local Express/SQLite adapter. Version 1.2 was also checked against live Vercel/Turso, as recorded below. The optional D1 adapter has not had a production browser round-trip.
- The earlier local preview exposed no registered WebMCP tools. The live Vercel page exposes a read-only energy-summary tool, which was exercised successfully in the version 1.2 checks.
- Demo role switching demonstrates server-side view/write checks. Real tenant account provisioning is a separate next milestone.
- Forecasting, hardware integration, automated notifications, and live tariffs are not implemented in this first version.

## Vercel migration checks — 3 October 2026

Version 1.2: **14 tests pass**, the frontend and NodeNext server TypeScript checks pass, the production Vite build passes, and the full npm dependency audit reports **0 known vulnerabilities**.

New integration tests use the real libSQL client against a local SQLite file. They verify imported readings and history survive closing and reopening the client; separate browser workspaces cannot read each other's alerts; Secure/HttpOnly/SameSite cookies; tenant write restrictions; rejected missing/foreign/cross-site origins before database access; generic database-failure responses; atomic batch rollback; and a bound on new synthetic workspaces.

### Live Vercel and Turso checks

The production app at **https://meterwise-kappa.vercel.app/** was tested against its connected Turso database on 3 October 2026. `/api/health` returned HTTP 200 after an actual database query, identifying version 1.2.0, Vercel hosting and Turso storage. The database uses the free Starter plan; credentials are server-only Vercel environment variables.

All **10 production HTTP checks passed** using two fresh synthetic visitor workspaces:

1. Live function and remote database health.
2. Rejection of missing/foreign write origins and anonymous nested API requests.
3. Secure, HttpOnly, SameSite visitor cookies and seeded workspace creation.
4. Eight valid CSV rows previewed and committed; coverage reached 100%.
5. Repeated imports did not duplicate import history.
6. Remote CSV report contained 42 daily meter rows.
7. Investigation note and status changes persisted.
8. Meter threshold changes persisted.
9. Tenant views contained only assigned meters; imports, meter edits and foreign-tenant filters were rejected.
10. Another visitor retained its own baseline and empty history; an alert from another workspace was inaccessible.

The cloud browser independently exercised the public app:

| Scenario | Observed result |
| --- | --- |
| CSV import and reload | Eight readings imported; saved history survived reload. Coverage changed from 99.2% to 100% and the missing-data alert resolved. |
| Report download | The actual downloaded CSV contained 42 rows, all with 100% coverage. |
| Tenant preview | Northstar Studio saw two meters, its own figures and no import controls. Returning to manager restored the building view. |
| Mixed CSV preview | One valid reading, two duplicates and one unknown-meter error were identified. This validation-only fixture was not committed. |
| Read-only WebMCP summary | Returned 4,083.53 kWh, S$1,163.81, 1,008 expected/received intervals, zero missing intervals and two open alerts, matching the dashboard. |

Production testing found and fixed two deployment defects: extensionless server imports failed under Node ESM, and nested API paths initially returned 404. Explicit `.js` import specifiers, the NodeNext compiler check and an API-only Vercel rewrite resolved them. The frontend now handles a non-JSON API failure with a clear retry message.

The 390 px and 768 px responsive checks above apply to the earlier local version 1.1; they were not repeated against the remote release. A live MySQL server and real meter hardware remain untested.

Evidence: [live HTTP checks](docs/qa/v1.2/live-api-checks.json), [Vercel dashboard](docs/qa/v1.2/desktop.jpg), [Vercel CSV validation](docs/qa/v1.2/imports.jpg), [downloaded building report](docs/qa/v1.2/building-report.csv).
