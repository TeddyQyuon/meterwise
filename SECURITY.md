# MeterWise security review

Version 2.0 reviewed on 3 October 2026 UTC. Both TypeScript checks, all 19 automated tests and the production build pass. The registry audit reports zero known vulnerabilities; this does not establish that all application vulnerabilities have been eliminated.

## Estate pilot controls

- Operational readings, imports, maintenance orders and evidence are scoped by visitor workspace. Area viewers can read only two configured Ang Mo Kio blocks; all writes and the gap-repair download require the manager role.
- Block/town/date filters are checked by the API. SQL uses bound parameters. Import duplicate queries inspect only candidate pairs, and imported intervals must fall within the workspace's fourteen-day demonstration window.
- Work-order transitions require evidence and a matching version. The update and its audit event are atomic; an update-specific mutation ID prevents a competing update from inserting false evidence. Creation is capped at 100 orders per workspace.
- Public HDB metadata is distinct from simulated electricity and maintenance data. No government credentials, resident details or real contractor dispatch are included. Audit records are append-only through the application, not independently tamper-proof.
- New schema migrations add estate tables without replacing the existing building workspace. SQLite and libSQL adapters apply the sorted migrations idempotently. MySQL deployment remains unverified against a live daemon.

## Dependencies

`npm audit` reported 12 affected packages: 6 high and 6 moderate. After upgrading Vite to 8.3.2, Wrangler to 4.146.0 and compatible Workers types, plus narrow dependency overrides for the legacy Drizzle loader's esbuild and Sequelize's UUID, the audit reports zero known vulnerabilities. The before/after reports are in `docs/security/`. These are registry advisory results, not a claim that all application vulnerabilities have been eliminated.

The overrides keep the installed Drizzle and Sequelize major versions. Drizzle generation, Sequelize UUID defaults, TypeScript, all 11 automated tests and the production build were checked after installation.

## Application changes

- JSON object bodies, media types and UTF-8 encoding are validated before database mutations. Declared and actual streamed sizes are bounded to 1,100,000 bytes; oversized streams are cancelled. CSV contents remain limited to 1,000,000 bytes and 1,500 rows.
- Invalid CSV files do not read the complete meter history. Duplicate checks fetch only validated meter/timestamp pairs in workspace-scoped queries below D1's bind limit.
- Foreign Origins and cross-site unsafe requests without Origin are rejected; the local development adapter has an explicit frontend-origin allowlist.
- Import filenames must be plain, nonempty names without control characters or path separators. API validation errors are explicit; unexpected database messages stay out of client responses.
- Both HTTP adapters apply no-sniff, referrer and permissions policies. Hosted HTML uses a Content Security Policy allowing local scripts and the existing ChatGPT embed origins; HTTPS responses include HSTS. Inline style is permitted for React/Recharts style attributes. Development Vite documents intentionally do not use the production document policy.
- Existing parameterized SQL, workspace/tenant scope checks, manager-only writes, HttpOnly/SameSite cookies, CSV formula protection and import idempotency remain covered by regression tests.

## Deployment boundaries

The optional hosted Site remains owner-private and uses trusted platform identity. Local Express deliberately uses a shared demo identity and should not be exposed as a real tenant service. The role switch is a demo preview, not tenant authentication or membership provisioning. Building metadata in the estate pilot comes from public HDB records; operational readings and maintenance are synthetic.

Earlier browser checks used the supervised Express/SQLite preview. Vercel production checks are recorded in `VERIFICATION.md`. The optional Worker/D1 code is covered by shared API tests and its deployment workflow; a separate MySQL daemon was unavailable.

## Independent Vercel demo

Vercel uses server-only Turso credentials. No database token is sent to the frontend. Each visitor receives a random 256-bit HttpOnly/Secure workspace cookie plus the existing session cookie. Incoming platform identity headers are ignored. Writes require the exact same origin, including session creation. Tenant views remain server-restricted. Synthetic workspace creation is capped at 100 using an atomic SQL conditional insert. The role switch is a public demo feature, not real account authentication.
