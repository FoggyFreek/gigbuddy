# CLAUDE.md

Guidance for Claude Code working in this repository: environment quirks, the architecture map, and the invariants you can't infer from any single file. For *what the code does*, read the code — start at the files named below.

## Environment & secrets

**Node 24** everywhere: local dev, CI (`.github/workflows/deploy.yml`), and the Docker images (`node:24-alpine`). Keep the three in sync when bumping.

**Secrets are injected by Infisical — never edit `.env` by hand and never paste credentials.** Application commands use the default `dev` slug:

```
infisical run -- <command>
```

Backend tests are the exception: always select the dedicated `test` slug explicitly:

```
infisical run --env=test -- <test command>
```

The `test` slug sets `PGDATABASE=gigbuddy_test`. Do not run backend tests with the default Infisical environment.

`.infisical.json` maps git branches to Infisical environments (`main` → `dev`). `pg` and the app read `PGHOST`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`/`PGPORT` and the rest from the process env that Infisical populates. `.env.example` documents the variable *names* only.

**local dev env: Postgres and object storage run on a local Docker instance** (Windows host, different from `docker-compose.yml`):

Start both before running locally: `docker start bosdat-postgres` (Postgres) and `docker start bosdat-v2-rustfs-1` (S3-compatible storage).

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
npm run lint                         # ESLint (TS/TSX app code + JS/JSX tests/server/config)
npm run type-check                   # tsc --noEmit (the type gate — keep at 0 errors)
```

## Workflow: test-driven

Write or adjust the test first, watch it fail, then implement until it passes. Two suites:

```
infisical run -- npm test                                   # frontend (vitest watch), excludes server tests
infisical run -- npm test -- --run                          # frontend, single run
infisical run -- npm test -- --run src/tests/Foo.test.jsx   # one file
infisical run --env=test -- npm run test:server                        # FULL backend suite (~10 min!) — only when explicitly asked
infisical run --env=test -- npx vitest run --no-file-parallelism src/tests/server/<file>.test.js   # targeted backend test — default
```

**Backend tests are slow** (sequential, real Postgres). Run only the affected file(s) via `npx vitest` as shown. Note `npm run test:server -- <file>` does NOT narrow the run — the npm script already passes `src/tests/server` as a path, so appended file args are ignored and the full suite runs anyway.

- **Frontend** tests (`src/tests/`, jsdom): all `src/api/*` modules are mocked with `vi.mock`. Components are wrapped in MUI `ThemeProvider` (+ `LocalizationProvider`/`MemoryRouter` as needed) via a local `wrap()` helper. Debounced-save tests use `vi.useFakeTimers()` + `vi.runAllTimersAsync()`.

- **Backend** tests (`src/tests/server/`) run against a **real Postgres test database** whose name must end in `_test`. Resolution order is: `PGDATABASE_TEST`, then `PGDATABASE` itself when it already ends in `_test` (for dedicated test-only Infisical credentials), otherwise `${PGDATABASE}_test`. `_envSetup.js` must remain the first import, but safety does not depend on import order alone: every mutating `_db.js` helper requires its bootstrap marker and verifies PostgreSQL's actual `current_database()` exactly matches the expected `_test` database before migrations, truncation, or fixture inserts. Create the test DB manually once. `_app.js` builds a real Express app but `x-test-user-id`/`x-test-tenant-id` headers stand in for OIDC and CSRF is short-circuited. `_db.js` exposes `runMigrations`, `truncateAll`, `seedTwoTenants`.

When you add backend behavior, add an isolation test that proves **tenant isolation holds** — a cross-tenant read/write must 404, not leak.

## Architecture map — where to start reading

One Node process in production: Express serves `/api`, the built `dist/` assets, and the SPA fallback. Vite proxies `/api` → :3002 in dev.

| Concern | Start here |
|---|---|
| Frontend bootstrap / provider hierarchy | `src/main.tsx` |
| Route tree + frontend access guards | `src/App.tsx` (`RequireAuth`/`RequirePermission`/`RequireEntitlement`/`RequireSuperAdmin`) |
| App shell / navigation | `src/components/AppShell.tsx`, `src/components/appShell/` |
| Backend bootstrap + middleware pipeline | `server/index.js` |
| API composition, access tiers, rate limits, gates | `server/routes/index.js` |
| DB connection / transactions | `server/db/index.js`, `server/db/withTransaction.js` |
| Schema evolution | `server/db/migrate.js`, `server/db/migrations/` |
| Rules shared by frontend & backend | `shared/` (`permissions.js`, `entitlements.js`, …) |
| Shared frontend entity types | `src/types/entities.ts`, `src/types/api.ts` |

**Domain navigation convention**: for any resource `foo`, look for `server/routes/foo.js` → `server/services/fooService.js` → `server/repositories/fooRepository.js` → `server/validators/fooValidators.js` → `src/api/foo.ts` → its page/components. Domains: planning (gigs, rehearsals, band events, availability, tasks), people/CRM (contacts, venues, band members, invites, tenants), music (songs, setlists, chordpro), finance (accounts, invoices, purchases, journal, ledger, reimbursements, VAT returns, reports), merch (+ Shopify import), promotion (Bandsintown, public calendars, share), admin, achievements, tutorials.

**Decoupled link-page app**: band link pages are served by a separate app living in its own repo (own package.json, own Postgres DB, own deploy). It talks to gigbuddy only over HTTP: `server/routes/publicLinkpage.js` (unauthenticated, shared-secret bearer) exposes a per-band content export and a signed image proxy; `server/routes/linkpage.js` mints short-lived editor handoff tokens for the "Edit link page" profile affordance. The shared HMAC secret is `LINKPAGE_SECRET`; `LINKPAGE_URL` is the link-page app's public origin. Entitlement gating (silver/gold, tenant-admin only) lives in `shared/entitlements.js` / `server/db/defaultPlans.js` as usual.

## Multi-tenant isolation — the core invariant

Multiple bands (tenants) share one instance with strict data isolation. This is the most important thing to preserve.

- Every tenant-owned read/write/join must be scoped by `req.tenantId`. Never trust a client id without the tenant scope. Composite FKs (`(child_id, tenant_id) → parent(id, tenant_id)`) are the DB backstop, not the primary defense.
- **Cross-tenant reads and updates return 404, not 403** — existence must not leak.
- The active tenant lives in `req.session.activeTenantId`; `resolveTenantId` (`server/middleware/tenant.js`) loads the matching approved membership or 403s — no fallback. URLs stay flat (`/gigs`), no tenant prefix.
- **Intra-tenant shared trust**: any approved member can read and write *all* of the tenant's resources. **Do not add per-user ownership checks inside a tenant unless explicitly asked.**
- Privilege tiers: tenant admin (`role='tenant_admin'` or super admin) manages memberships/invites/logo; super admins (`users.is_super_admin`) manage globally but still need an approved membership to *use* a tenant's data. Role permissions have one source: `shared/permissions.js` (backend enforcement `server/middleware/permissions.js`, typed frontend wrapper `src/auth/permissions.ts`).
- File keys use `tenants/<tenant_id>/<category>/<uuid>`; access is gated by an ownership lookup in the active tenant before streaming. All uploads go through storage quota enforcement (`server/services/storageService.js`).

## Backend foundations

- **Layering: route → service → repository → PostgreSQL**, validators at the service boundary. Routes stay thin; SQL lives in repositories; transactions (`withTransaction`) in services; common errors in `server/services/serviceErrors.js`; domain constants in `server/domain/`. **Canonical example: the rehearsals stack** (`server/{routes,services,repositories,validators}/rehearsal*`). Load the **backend-layering** skill before adding or refactoring any backend resource.
- **Collection reads are scoped.** Load the **collection-scoping** skill before adding or changing any endpoint that returns a list (bounded `?limit=` vs windowed `?from=&to=` contract, `{ items, meta }` envelope, interval semantics).
- **Deep bounded feeds ("load more") use a keyset list cursor, never offset/page params.** `parseListCursor` (`server/validators/common.js`) parses `?cursorDate=&cursorId=`, keyed on the same `(date, id)` tuple the repository's `ORDER BY ... DESC, id DESC` tiebreaks on; the repository adds `AND (col, id) < ($cursorDate, $cursorId)`. Service builds `meta.nextCursor` (null once the page is short of `limit`); frontend type is `LimitedCollectionWithCursorResponse<T>` / `ListCollectionCursor` (`src/types/api.ts`). Reference implementation: `GET /gigs/past` (`listPastGigs` in `gigRepository.js` / `gigService.js` / `src/api/gigs.ts`).
- **Shared primitives have one owner.** Before adding a repository query or normalization helper, search for an existing equivalent. Aggregate reads belong to the aggregate's repository; shared normalization belongs in `server/utils`. Never duplicate equivalent SQL or normalization logic.
- Auth: OIDC protocol in `server/oidc.js`, flows in `server/routes/auth.js` → `authService.js`; user/terms middleware `server/middleware/auth.js`. Cold sign-in is **invite-only**: a new sign-in gets zero memberships → `/redeem-invite`; `ADMIN_EMAIL` bootstraps the super admin.
- CSRF (`server/middleware/csrf.js`): synchronizer token, mounted on `/api`; the SPA picks it up from the `X-CSRF-Token` header on the `/auth/me` bootstrap. OIDC redirect GETs and **`/push/resubscribe`** are deliberately exempt.
- Logging (`server/utils/logger.js`): structured JSON lines, `docker logs` is the only sink. **`fields.err` is auto-redacted to name/code/status — never `.message`/`.stack`, in any environment; this is deliberate (secrets leak via messages), don't reintroduce it.** Other fields must be whitelisted in `CONTEXT_KEYS` and primitive. Request correlation is automatic via AsyncLocalStorage (`server/middleware/requestContext.js`) — no `req` threading; the ALS value wins over caller-passed fields. `server/utils/auditLog.js` is a separate security audit trail — don't conflate or reshape it.

## Frontend foundations

- **Strict TypeScript** (`tsc --noEmit` stays at 0 errors); all app code under `src/` is `.ts`/`.tsx`, only tests stay `.js`/`.jsx`. Backend stays ESM JavaScript. Load the **react-frontend** skill before frontend work.
- No Redux/React Query — state is React contexts + hooks + component state. Central contexts live in `src/contexts/` (auth/tenant switching, profile, theming, toasts).
- **All HTTP goes through `src/api/_client.ts`** (CSRF header, error normalization, 401 events); each resource gets a thin typed `src/api/<resource>.ts` wrapper. Page components never embed `/api/...` paths.
- Frontend guards and entitlement gating are **UX only** — backend middleware is authoritative.
- Key hooks: `usePermissions`, `useEntitlements`, `useDebouncedSave` (600 ms debounce, `flush()` on modal close), `useTenantQuerySync`.
- **Compact/mobile layout**: use `useCompactLayout()` (`src/hooks/useCompactLayout.ts`) for compact-vs-desktop structure decisions (table→card, stacked controls); it also honors `CompactLayoutContext` (forced by `SplitView`). Don't add new direct `useMediaQuery(breakpoints.down('sm'))` checks; name the boolean `isCompact`.
- Types: reuse `src/types/entities.ts` / `src/types/api.ts` instead of redeclaring shapes. Fields that carry `null` in API payloads are typed `T | null`, not just `T?` — don't switch a call site to `undefined` (that changes the JSON). Components declare a `Props` interface, no `prop-types`. Type MUI icon props as `SvgIconComponent`. Imports use explicit extensions; `vi.mock` paths must match the `.ts`/`.tsx` source.
- **MUI v9** (Material 3 theme). Theme mode branching uses `useThemeMode()` from `src/contexts/themeModeContext.ts`, not `useTheme().palette.mode`. Money in tables renders via `<MoneyCells cents={…}/>` + `<MoneyHeaderCells/>` (`src/components/shared/MoneyCells.tsx`) — each emits **two** `<TableCell>`s, account for that in `colSpan`; compact card views use `formatEur` directly.
- **i18n** (i18next, typed selector form `t($ => $.key)` — never bare `t('key')`): en canonical + nl in `src/i18n/`, key parity enforced at compile time. Load the **i18n** skill for non-trivial translation work; copy existing English wording verbatim when extracting (tests assert literal copy).
- **Tutorials are frontend-driven** — registry `src/tutorials/registry.tsx` (order = priority), selection `useActiveTutorial.ts`, renderer `TutorialHost.tsx`. Adding one needs no backend/schema change; dismissals are per-user, cross-tenant, ride on `/auth/me`. **Never rename a shipped tutorial key** (persisted).

## Finance & billing

The financial core is an **immutable double-entry ledger** (`ledger_transactions` + `ledger_entries`). Read `server/services/ledgerService.js` and the reference tests (`src/tests/server/ledger.test.js`, `ledgerCompliance.test.js`, `ledgerBrowser.test.js`) before touching anything financial. Non-negotiable invariants:

- **`postJournal()` in `ledgerService.js` is the only insert path** — never write ledger rows directly. Idempotency by `UNIQUE (tenant_id, source_type, source_id, source_event)`; re-posting returns `{ posted: false }`.
- **Corrections-forward, never edits**: entries are never updated or deleted. Open-period mistakes are *voided*, closed-period mistakes are *reversed* (`applyCorrection`); external payments in closed periods use `clampToOpenPeriod`.
- Business services post **inside the same DB transaction** as the state change — keep it that way for new events.
- Display classification of `(source_type, source_event)`: `server/services/ledgerEntryTypes.js` with frontend mirror `src/utils/ledgerEntryType.ts` — **keep both in sync** when adding events.
- Tenant accounting settings are guarded by a per-tenant advisory lock (shared with `server/routes/accounts.js`).

**Bank statement import** (CAMT.053/MT940): parsers `server/services/bankStatement/`, service/repo/validators `bankImport*`, dialog `src/components/ledger/BankStatementImportDialog.tsx`. Two-phase (parse-stage, then commit by line id) — **client money is never trusted**; amounts are re-read server-side. Reference tests: `bankStatementParsers.test.js`, `bankImport.test.js`.

**Platform billing** (Mollie, user-level subscriptions; tenants inherit from `tenants.owner_user_id`): **load the subscription-billing skill** before touching plans, entitlements, limits, tenant ownership, the billing lifecycle, or gating UI. Hard rules: `shared/entitlements.js` is the single source of truth; **never call the payment provider inside a DB transaction**; never import a concrete adapter (use `getPaymentProvider()`); remote mutations go through the `billing_operations` outbox saga. Customer-invoice Mollie payments and platform subscription billing are separate flows.

## Cross-cutting services

- Storage: RustFS/MinIO client `server/utils/storage.js`; tenant keys, quotas, cleanup `server/services/storageService.js`; encrypted integration credentials `server/security/integrationSecrets.js`.
- Notifications `server/services/notificationService.js`; web push `server/services/pushService.js` + `public/sw.js`.
- Achievements: single registry `server/achievements/definitions.js`, facts SQL in `factsBuilder.js`, evaluated lazily on read (no scheduler). **Never rename a shipped achievement key** (persisted, doubles as i18n/icon key).
- Metrics `server/metrics.js`; Grafana Alloy config `observability/config.alloy`.

## Migrations

New migrations go in `server/db/migrations/` as `NNN_name.sql`. The runner sorts alphabetically, so **numeric prefixes must stay monotonic and zero-padded**. They run on the next `migrate`; never hand-apply SQL.

## Misc conventions

- When giving the user a multi-line vs. line-by-line command, say which — don't leave a block ambiguous.
- Don't restructure readable code solely to satisfy a linter or SonarQube cognitive-complexity threshold — prefer a clear `switch`/early-returns, or mark the issue `accept`.
