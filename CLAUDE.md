# CLAUDE.md

Guidance for Claude Code working in this repository. These are the non-obvious fundamentals — architecture, conventions, and environment quirks you can't infer by reading code. For *what the code does*, read the code.

## Environment & secrets

**Secrets are injected by Infisical — never edit `.env` by hand and never paste credentials.** Every command that needs env vars must be wrapped:

```
infisical run -- <command>
```

`.infisical.json` maps git branches to Infisical environments (`main` → `dev`). `pg` and the app read `PGHOST`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`/`PGPORT` and the rest from the process env that Infisical populates. `.env.example` documents the variable *names* only.

**local dev env: Postgres and object storage run on a local Docker instance** (Windows host, different from `docker-compose.yml`):

Container needs a start 'bosdat-postgres' and 'bosdat-v2-rustfs-1`. `docker start bosdat-postgres` and `docker start bosdat-v2-rustfs-1` # start the local DB image S3-compatible storage

The `app`/`migrate`/`rustfs_init` compose services are for container deploys; for local dev run the app on the host (below) against the Dockerized Postgres + RustFS. RustFS is S3-compatible (MinIO client). Outside Docker use `RUSTFS_ENDPOINT=localhost`; the `app` container overrides it to `rustfs`.

## Commands

Run everything through `infisical run --`. Two processes during development:

```
infisical run -- npm run dev:all     # API (:3002, nodemon) + Vite (:5173, proxies /api → :3002) together
infisical run -- npm run server:dev  # API only
infisical run -- npm run dev         # Vite only
```

```
infisical run -- npm run migrate     # apply pending SQL migrations
npm run build                        # production Vite build
npm run lint                         # ESLint (JS + JSX)
```

## Workflow: test-driven

Write or adjust the test first, watch it fail, then implement until it passes. Two suites:

```
infisical run -- npm test                                   # frontend (vitest watch), excludes server tests
infisical run -- npm test -- --run                          # frontend, single run
infisical run -- npm test -- --run src/tests/Foo.test.jsx   # one file
infisical run -- npm run test:server                        # FULL backend suite (~10 min!) — only when explicitly asked
infisical run -- npx vitest run --no-file-parallelism src/tests/server/<file>.test.js   # targeted backend test — default
```

**Backend tests are slow** (sequential, real Postgres). Run only the affected file(s) via `npx vitest` as shown. Note `npm run test:server -- <file>` does NOT narrow the run — the npm script already passes `src/tests/server` as a path, so appended file args are ignored and the full suite runs anyway.

- **Frontend** tests (`src/tests/`, jsdom): all `src/api/*.js` modules are mocked with `vi.mock`. Components are wrapped in MUI `ThemeProvider` (+ `LocalizationProvider`/`MemoryRouter` as needed) via a local `wrap()` helper. Debounced-save tests use `vi.useFakeTimers()` + `vi.runAllTimersAsync()`. 
 
- **Backend** tests (`src/tests/server/`) run against a **real Postgres test database** whose name must end in `_test` (defaults to `${PGDATABASE}_test`, override with `PGDATABASE_TEST`); the harness refuses any other name and rewrites `PGDATABASE` before the pool is imported. Create the test DB manually once. `_app.js` builds a real Express app but `x-test-user-id`/`x-test-tenant-id` headers stand in for OIDC and CSRF is short-circuited. `_db.js` exposes `runMigrations`, `truncateAll`, `seedTwoTenants`.

When you add backend behavior, add an isolation test that proves **tenant isolation holds** (see below) — a cross-tenant read/write must 404, not leak.

## Multi-tenant isolation — the core invariant

Multiple bands (tenants) share one instance with strict data isolation. This is the most important thing to preserve.

- Every tenant-owned table has a `tenant_id`. Parent tables carry `UNIQUE(id, tenant_id)` so child FKs use composite `(child_id, tenant_id) → parent(id, tenant_id)` references. **The DB rejects cross-tenant child rows even if a route forgets its `WHERE tenant_id`** — this is the backstop, not the primary defense.
- Every read/write/join in a route must be scoped by `req.tenantId`. Never trust an id from the client without the tenant scope.
- The active tenant lives in `req.session.activeTenantId`. `resolveTenantId` (middleware) loads the matching approved membership or 403s — it does **not** fall back to "first membership." URLs stay flat (`/gigs`), no `/t/<slug>/` prefix.
- **Cross-tenant reads and updates return 404, not 403**, so existence isn't leaked.
- Memberships join users↔tenants with `role` (`tenant_admin` | `member`) and `status` (`pending` | `approved` | `rejected`). Super admins (`users.is_super_admin`) manage everything globally but must still hold an approved membership to *use* a tenant's data. Seed tenant id is `1`.
- File keys use `tenants/<tenant_id>/<category>/<uuid>`; access is gated by an ownership lookup in the active tenant before streaming. Legacy keys (`logo/`, `gig-banners/`, `share/`) are read-only.

## Authorization model

**Intra-tenant shared trust**: any approved member of tenant T can read and write *all* of T's resources (gigs, rehearsals, votes on behalf of others, availability, contacts, etc.). **Do not add per-user ownership checks inside a tenant unless explicitly asked.**

Privileged tiers:
- **Tenant admin** (`role = 'tenant_admin'` OR super admin): manage memberships, issue/revoke invites, upload tenant logo.
- **Super admin** (`is_super_admin`): manage all tenants and users globally; only super admins may grant or invite at the `tenant_admin` role.

Gates: `requireApproved` 403s non-approved users; `resolveTenantId` 403s a non-approved active tenant.

## CSRF & auth gotchas

- Synchronizer-token CSRF (`server/middleware/csrf.js`) is mounted on `/api` before routers. The SPA picks up the token from the `X-CSRF-Token` response header on the `/auth/me` bootstrap and attaches it to every unsafe request (`_client.js`).
- OIDC redirect GETs (`/auth/login`, `/auth/callback`) bypass CSRF. **`/push/resubscribe` is explicitly CSRF-exempt** — the service worker can't read the in-memory token; `sameSite:lax` cookies + the `(oldEndpoint, user_id)` match are the integrity gate there.
- Cold sign-in is **invite-only**: a new Google sign-in creates an approved `users` row with zero memberships → `/redeem-invite`. Access comes from invite redemption + tenant-admin approval. `ADMIN_EMAIL` is bootstrapped as super admin + seed-tenant admin on first login.

## Double-entry ledger

Finance is built on an **immutable double-entry ledger** (`ledger_transactions` + `ledger_entries`, migration `065`). Rules that aren't obvious from any single file:

- **`postJournal()` in `server/services/ledgerService.js` is the only insert path.** Never write ledger rows directly. It validates balance (debits = credits), drops zero lines, requires ≥2 non-zero lines, and enforces period close (`books_closed_through`).
- **Idempotency by `UNIQUE (tenant_id, source_type, source_id, source_event)`** — re-posting the same event returns `{ posted: false }` instead of duplicating. New posted events follow the `source_type/source_event` pattern (e.g. `invoice/sent`, `purchase/payment`, `vat_settlement/filed`).
- **Postings are corrections-forward, never edits**: a correction posts a reversing transaction; ledger *entries* (amounts) are never updated or deleted.
- **Manual ledger corrections split on the booking period** (`applyCorrection` in `ledgerService.js`, migration `079`): an **open-period** entry is **voided** — the original gets a `voided_at` marker and both halves hide from the default ledger view and are *excluded* from every financial calculation/report (`EXCLUDE_VOIDED_SQL` in `ledgerRepository.js`), but stay visible via "Show voided". A **closed-period** entry is **reversed** (`source_event='reversal'`) — a *visible* corrections-forward entry that stays in the ledger and in reports, netting the mistake out forward without mutating the closed period. `POST /api/ledger/:id/void` vs `/reverse`. This metadata marking on `ledger_transactions` is the one place a posted transaction row is updated. Invoice/merch domain voids are unchanged (they still self-cancel mathematically).
- Business services (invoice, purchase, reimbursement, journal, VAT return) post **inside the same DB transaction** as the state change — keep it that way for new events.
- Tenant accounting settings (receivable/payable/revenue/VAT/reimbursement account codes, seeded from `server/db/defaultChartOfAccounts.js`) are guarded by a **per-tenant Postgres advisory lock** (`ledgerService.js`, shared with `server/routes/accounts.js`) so settings can't change while a posting races.
- External payments (Mollie webhooks) use `clampToOpenPeriod` so cash receipts still book when the original date falls in a closed period.
- Display classification of `(source_type, source_event)` lives in `server/services/ledgerEntryTypes.js` with a frontend mirror in `src/utils/ledgerEntryType.js` — **keep both in sync** when adding events.
- Best reference tests: `src/tests/server/ledger.test.js` (posting invariants), `ledgerCompliance.test.js` (period close, audit, settings guard), `ledgerBrowser.test.js` (read side).

## Backend layering: route → service → repository

Backend resources follow a three-layer split. **The rehearsals stack is the canonical example** — `server/routes/rehearsals.js`, `server/services/rehearsalService.js`, `server/repositories/rehearsalRepository.js`, `server/validators/rehearsalValidators.js`. New routes and refactors must follow it; the backend-layering skill has the full rules.

- **Route** (`server/routes/`): HTTP only — parse/validate params, call one service function, translate `{ error: { status, body } }` to a response. No SQL, no business rules.
- **Service** (`server/services/`): domain logic, transactions, push notifications, mapping DB errors (e.g. `23505` → 409). Returns `{ error: { status, body } }` on expected failures, a domain payload on success. Throws only on unexpected errors.
- **Repository** (`server/repositories/`): SQL only. Every function takes an `executor` (pool or transaction client) as its first argument so callers control transactions. Every query is tenant-scoped.
- **Validators** (`server/validators/`): pure input parsing/normalization and SET-fragment builders, no DB access.

## Migrations

New migrations go in `server/db/migrations/` as `NNN_name.sql` and run on the next `migrate`. The runner sorts alphabetically, so **numeric prefixes must stay monotonic** and zero-padded. They run automatically; don't hand-apply SQL.

## Conventions
- Load react-frontend skill before working on the front end.
- **MUI v9** (Material 3 theme, `borderRadius: 12`): system props like `justifyContent` go in `sx`; `TextField`'s `inputProps` is replaced by `slotProps.htmlInput`.
- New resource routers are registered in `server/routes/index.js`; each frontend resource gets one thin `src/api/*.js` wrapper around `_client.request` (the only place that knows the `/api/*` path).
- Auto-save fields use `useDebouncedSave` (600 ms debounce; `flush()` on modal close).
- When giving the user a multi-line vs. line-by-line command, say which — don't leave a block ambiguous.
- PropTypes are used extensively. Every component must declare `ComponentName.propTypes = { ... }`. Shared entity shapes live in `src/propTypes/shared.js` (`venueShape`, `gigShape`, `memberShape`, etc.) — import and reuse them rather than redeclaring inline. Add new fields to the shared shapes when a component uses a prop that isn't there yet.
- **Currency in tables**: render money amounts with `<MoneyCells cents={…} />` (and `<MoneyHeaderCells label="…" />` in the head) from `src/components/shared/MoneyCells.jsx`. It splits the EUR symbol into its own narrow right-aligned column so the `€` lines up vertically across rows while the digits stay right-aligned. Each `MoneyCells`/`MoneyHeaderCells` emits **two** `<TableCell>`s — account for that in `colSpan`. Don't put a bare `formatEur()` in a `TableCell` (compact card views still use `formatEur` directly).
- Don't restructure readable code solely to satisfy a linter or SonarQube cognitive-complexity (S3776) threshold — prefer a clear `switch`/early-returns, or mark the issue `accept`. Extracting genuine helpers is fine; obfuscating to win a metric is not.
