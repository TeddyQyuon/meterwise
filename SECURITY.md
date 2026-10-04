# MeterWise security review — Python backend 2.1

The Python migration preserves visitor isolation, workspace identity and saved data. `VERIFICATION.md` records the checks actually run. Dependency advisories and application regression tests cover different risks; a clean advisory report is not a claim that every vulnerability is eliminated.

## Access and persistence

- Random 256-bit visitor and session cookies are HttpOnly, Secure on HTTPS and SameSite=Lax, with seven-day expiry. Existing Node cookie/session hashes and epoch-millisecond expirations remain compatible. Platform identity headers are ignored.
- All operational queries and writes use workspace-bound SQL parameters. Area viewers see only two Ang Mo Kio blocks; legacy tenants see assigned meters. Foreign orders/alerts return 404, and manager-only writes return 403.
- Every unsafe request, including session creation, requires the exact origin (scheme, host and port). Cross-site requests are rejected before database work. An explicit local development allowlist is disabled when running on Vercel.
- Workspace creation uses an atomic conditional SQL insert capped at 100; existing visitors retain access at capacity. Work orders are capped at 100 per workspace.
- Existing SQL migrations are applied idempotently without replacing tables. Estate readings and the seed-window marker commit together. Historical windows are preserved across deployments.
- Turso credentials remain in server environment variables. Production cannot fall back to local storage. SQL, provider response bodies and credential-bearing URLs are excluded from application error messages and logs.

## Imports, analytics and maintenance

- UTF-8 JSON object bodies and media types are checked before mutation. Declared and actual streamed bodies are limited to 1,100,000 bytes; the application stops reading an oversized stream. Invalid JSON, nonfinite numbers and lone Unicode surrogates are rejected.
- CSV files are limited to 1,000,000 bytes and 1,500 rows, with strict quoting, registered meter IDs, valid explicit ISO timezones, completed aligned intervals and finite nonnegative consumption. Estate imports stay inside their workspace’s fourteen-day window.
- Duplicate checks query only validated candidate intervals, with at most 81 bind parameters. Plain filenames reject path separators and control characters. Imports are content-deduplicated and reports quote cells and neutralize text formulas.
- Solar/grid matching runs per block and hour. Missing values are not imputed as zero; derived grid, cost, carbon and comparisons are withheld for incomplete data.
- Maintenance transitions require evidence, a valid assignee and the current integer version. The order update and its event are one atomic transaction; a unique mutation ID prevents a failed competing save from appending an event. Audit records are append-only through the application, not independently tamper-proof.
- SQLite and Turso batch writes roll back on failure. The Turso HTTP adapter uses documented conditional Hrana transactions in one round trip and never retries mutations after a timeout.

## HTTP and dependency controls

API responses, CSV downloads and failures have no-store caching, no-sniff, referrer, permissions and CSP headers. HTTPS includes HSTS. Vercel documents permit same-origin scripts and React/Recharts inline styles. The Python service exposes only its API routes. The frontend service exposes the Vite output. Local data, the virtual environment and credentials are excluded from Git; source files and QA evidence have no public static route.

Python runtime dependencies are pinned in `requirements.txt` and `uv.lock`; test/audit tools are separate in `requirements-dev.txt`. Express, Sequelize, MySQL, Wrangler, Drizzle tooling and TypeScript API runtime dependencies were removed. TypeScript is retained for the frontend only.

## Demo boundaries

This remains an independent portfolio pilot with public HDB building metadata and simulated operational data. No government affiliation, agency credentials, real resident records, meter hardware or actual contractor dispatch are claimed. Public demo role switching is not production authentication. Live tariffs and verified emissions accounting are outside scope. Vercel preview protection remains enabled; existing free storage is reused.
