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
infisical run -- npm run test:server                        # backend isolation tests, sequential, against a real PG
```

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

## Migrations

New migrations go in `server/db/migrations/` as `NNN_name.sql` and run on the next `migrate`. The runner sorts alphabetically, so **numeric prefixes must stay monotonic** and zero-padded. They run automatically; don't hand-apply SQL.

## Conventions
- Load react-frontend skill before working on the front end.
- **MUI v9** (Material 3 theme, `borderRadius: 12`): system props like `justifyContent` go in `sx`; `TextField`'s `inputProps` is replaced by `slotProps.htmlInput`.
- New resource routers are registered in `server/routes/index.js`; each frontend resource gets one thin `src/api/*.js` wrapper around `_client.request` (the only place that knows the `/api/*` path).
- Auto-save fields use `useDebouncedSave` (600 ms debounce; `flush()` on modal close).
- When giving the user a multi-line vs. line-by-line command, say which — don't leave a block ambiguous.
- PropTypes are used extensively. Every component must declare `ComponentName.propTypes = { ... }`. Shared entity shapes live in `src/propTypes/shared.js` (`venueShape`, `gigShape`, `memberShape`, etc.) — import and reuse them rather than redeclaring inline. Add new fields to the shared shapes when a component uses a prop that isn't there yet.
