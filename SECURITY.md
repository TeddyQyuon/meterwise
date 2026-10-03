# MeterWise security review

Reviewed 2 October 2026 for version 1.1. Rechecked on 3 October: all 11 tests pass and npm audit still reports zero known vulnerabilities.

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

The hosted Site remains owner-private and uses trusted platform identity. Local Express deliberately uses a shared demo identity and should not be exposed as a real tenant service. The role switch is a demo preview, not tenant authentication or membership provisioning. All included datasets and browser screenshots are synthetic.

Browser checks used the supervised Express/SQLite preview. The deployed Worker/D1 code is covered by shared API tests and the build/deployment workflow; it was not tested by navigating to production. A separate MySQL daemon was unavailable.

## Independent Vercel demo

Vercel uses server-only Turso credentials. No database token is sent to the frontend. Each visitor receives a random 256-bit HttpOnly/Secure workspace cookie plus the existing session cookie. Incoming platform identity headers are ignored. Writes require the exact same origin, including session creation. Tenant views remain server-restricted. Synthetic workspace creation is capped at 100 using an atomic SQL conditional insert. The role switch is a public demo feature, not real account authentication.
