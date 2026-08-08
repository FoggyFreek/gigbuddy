# CLAUDE.md

Guidance for Claude Code in this repository: environment quirks, the architecture map, and the invariants you can't infer from any single file. For *what the code does*, read the code — start at the files named below.

## Environment & secrets

**Node 24** everywhere: local dev, CI (`.github/workflows/deploy.yml`), Docker images (`node:24-alpine`). Keep the three in sync when bumping.

**Secrets are injected by Infisical — never edit `.env` by hand and never paste credentials.** Prefix every application command with `infisical run --` (default `dev` slug). Backend tests are the exception and must select the dedicated slug explicitly: `infisical run --env=test -- …`, which sets `PGDATABASE=gigbuddy_test`. `.infisical.json` maps git branches to environments (`main` → `dev`).

**Local dev runs the app on the host against Dockerized services** (Windows host, *not* `docker-compose.yml`): start `bosdat-postgres` (Postgres) and `bosdat-v2-rustfs-1` (S3-compatible storage) with `docker start` before running locally. The compose `app`/`migrate` services are for container deploys; `rustfs_init` only initializes local storage. Outside Docker, leave `S3_*` empty to use the `RUSTFS_*` localhost fallback; the `app` container uses `S3_CONTAINER_ENDPOINT=rustfs`. One S3-compatible bucket holds every image and file: RustFS locally, private Backblaze B2 in production.

## Commands

```
infisical run -- npm run dev:all     # API (:3002, nodemon) + Vite (:5173, proxies /api → :3002)
infisical run -- npm run server:dev  # API only
infisical run -- npm run dev         # Vite only
infisical run -- npm run migrate     # apply pending SQL migrations
npm run build                        # production Vite build
npm run lint                         # ESLint
npm run type-check                   # tsc --noEmit (the type gate — keep at 0 errors)
```

## Workflow: test-driven

Write or adjust the test first, watch it fail, then implement until it passes. Always npm run lint, type check before finishing a task.

```
infisical run -- npm test -- --run                          # frontend, single run
infisical run -- npm test -- --run src/tests/Foo.test.jsx   # one frontend file
infisical run --env=test -- npx vitest run --config vitest.server.config.js src/tests/server/<file>.test.js   # targeted backend test — the default
infisical run --env=test -- npm run test:server             # FULL backend suite — only when explicitly asked
```

- **Always pass `--config vitest.server.config.js` for backend runs** — it owns the parallel-database harness; without it the run falls back to one shared database. `npm run test:server -- <file>` does NOT narrow the run (the script already passes a path), it runs everything.
- **Frontend** (`src/tests/`, jsdom): `src/api/*` is mocked with `vi.mock`; components go through a local `wrap()` helper (MUI `ThemeProvider` + `LocalizationProvider`/`MemoryRouter` as needed); debounced-save tests use `vi.useFakeTimers()` + `vi.runAllTimersAsync()`.
- **Backend** (`src/tests/server/`) runs against a **real Postgres database whose name must end in `_test`** — the mutating `_db.js` helpers verify `current_database()` against the expected `_test` name before migrating, truncating or seeding, so never weaken that check. `_envSetup.js` stays the first import. `_app.js` builds a real Express app with `x-test-user-id`/`x-test-tenant-id` standing in for OIDC and CSRF short-circuited; `_db.js` exposes `runMigrations`, `truncateAll`, `seedTwoTenants`.
- Workers clone a reusable schema-only template database (`_globalSetup.js`, `_workerDatabase.js`); one database per **worker**, so files keep the `truncateAll()` + `seedTwoTenants()` rhythm. Editing an already-applied migration in place needs `GIGBUDDY_TEST_FRESH_TEMPLATE=1`. `GIGBUDDY_TEST_MAX_WORKERS` (8) × `PG_POOL_MAX` (5) must stay under the server's `max_connections`.

When you add backend behavior, add an isolation test proving **tenant isolation holds** — a cross-tenant read/write must 404, not leak.

## Architecture map — where to start reading

One Node process in production: Express serves `/api`, the built `dist/` assets, and the SPA fallback. Vite proxies `/api` → :3002 in dev.

| Concern | Start here |
|---|---|
| Frontend bootstrap / provider hierarchy | `src/main.tsx` |
| Route tree + frontend access guards | `src/App.tsx` (`RequireAuth`/`RequirePermission`/`RequireEntitlement`/`RequireTenantCapability`/`RequireSuperAdmin`) |
| App shell / navigation | `src/components/AppShell.tsx`, `src/components/appShell/` |
| Backend bootstrap + middleware pipeline | `server/index.js` |
| API composition, access tiers, rate limits, gates | `server/routes/index.js` |
| DB connection / transactions | `server/db/index.js`, `server/db/withTransaction.js` |
| Schema evolution | `server/db/migrate.js`, `server/db/migrations/` |
| Rules shared by frontend & backend | `shared/` (`permissions.js`, `entitlements.js`, `tenantCapabilities.js`, …) |
| Shared frontend types | `src/types/entities.ts`, `src/types/api.ts` |
| Tenant-kind applicability | `shared/tenantCapabilities.js`, `docs/tenant-kind-architecture.md` |
| Band vs artist plan products | `shared/planAudiences.js`, `server/services/entitlementService.js` |
| Cross-tenant artist calendar (`/api/me/*`) | `server/routes/me.js`, `server/services/meService.js`, `src/components/ArtistCalendarSection.tsx` |

**Domain navigation convention**: for any resource `foo` — `server/routes/foo.js` → `server/services/fooService.js` → `server/repositories/fooRepository.js` → `server/validators/fooValidators.js` → `src/api/foo.ts` → its page/components. Domains: planning (gigs, rehearsals, band events, availability, tasks), people/CRM (contacts, venues, band members, invites, tenants, band directory), music (songs, setlists, chordpro), finance (accounting profile + tax scheme enrolments, accounts, invoices, purchases, journal, ledger, reimbursements, VAT returns, reports), merch (+ Shopify import), promotion (Bandsintown, public calendars, share), admin, achievements, tutorials.

**Decoupled link-page app**: band link pages live in a separate repo with their own DB and deploy, talking to gigbuddy only over HTTP — `server/routes/publicLinkpage.js` (unauthenticated, shared-secret bearer: content export + signed image proxy) and `server/routes/linkpage.js` (short-lived editor handoff tokens). Secrets: `LINKPAGE_SECRET`, `LINKPAGE_URL`. Entitlement gating stays in `shared/entitlements.js` / `server/db/defaultPlans.js`.

## Tenant kinds — shared architecture, capability split

`tenants.kind` is `band` or `personal`. A personal workspace is an ordinary tenant — same routes, services, repositories, tables, permissions and isolation — that happens to have one member. Profile, planning, contacts, finance and files are identical for both kinds and are absent from the capability registry. What differs is the ends of the range: band-shaped concepts (roster, membership admin, band availability, setlists, merch, discovery, promotion integrations, share, link page) are band-only, while the artist calendar and the "bands I'm in" settings section are personal-only. **Shared is the default** — never fork a domain into band/personal implementations just for wording or visibility.

- Genuine differences are named capabilities in `shared/tenantCapabilities.js`. Prefer capability checks over scattered `kind === …` comparisons.
- Backend is authoritative: `requireTenantCapability`, `requireTenantCapabilityForBodyFields`, `requireTenantCapabilityWhen` (`server/middleware/tenant.js`). The field/predicate variants keep a shared endpoint shared when only one subtype is kind-specific. Frontend `useTenantKind().supports(…)` / `RequireTenantCapability` are UX only.
- A personal tenant is unique per owner and does not consume the `bands` limit — only active owned `band` tenants count.
- `tenants.display_name` is the kind-neutral name; `band_name` is a synced alias with `tenantRepository` as the single writer. Prefer kind-neutral vocabulary.
- Read `docs/tenant-kind-architecture.md` before adding kind-specific behavior; add a capability, not a parallel feature stack.

**Joining a band** is user-level, so it works from any active tenant. `/invites/redeem` takes a code (`loadUser` only, no tenant). `/band-directory` only sees bands with `tenants.join_policy = 'request'`: role is fixed server-side, a non-discoverable target 404s, a `rejected` membership stays rejected, and `enforceJoinRequestCap` (`server/domain/membership.js`) caps outstanding requests under the user-row lock — no plan lifts that cap, so it sits outside the `*_limit_reached` family. Every `memberships.source` insert site names its own value (no SQL default).

## Multi-tenant isolation — the core invariant

Multiple bands share one instance with strict data isolation. This is the most important thing to preserve.

- Every tenant-owned read/write/join is scoped by `req.tenantId`. Never trust a client id without the tenant scope. Composite FKs (`(child_id, tenant_id) → parent(id, tenant_id)`) are the DB backstop, not the primary defense.
- **Cross-tenant reads and updates return 404, not 403** — existence must not leak.
- The active tenant lives in `req.session.activeTenantId`; `resolveTenantId` (`server/middleware/tenant.js`) loads the matching approved membership or 403s — no fallback. URLs stay flat (`/gigs`), no tenant prefix.
- **Intra-tenant shared trust**: any approved member reads and writes *all* of the tenant's resources. **Do not add per-user ownership checks inside a tenant unless explicitly asked.**
- Privilege tiers: tenant admin (`role='tenant_admin'` or super admin) manages memberships/invites/logo; super admins (`users.is_super_admin`) manage globally but still need an approved membership to *use* a tenant's data. Role permissions have one source: `shared/permissions.js` (enforcement `server/middleware/permissions.js`, typed frontend wrapper `src/auth/permissions.ts`).
- File keys are `tenants/<tenant_id>/<category>/<uuid>`; access is gated by an ownership lookup in the active tenant before streaming, and uploads go through storage quota enforcement (`server/services/storageService.js`). **Tenant profile pictures are the deliberate exception**: `server/routes/tenantAvatar.js` (mounted at `/api/tenants/:id/avatar` and the legacy `/api/notifications/tenant-avatar/:tenantId`) authorizes by *membership*, because avatars render for every tenant the caller can see.

Two things sit deliberately outside tenant scoping: user-level availability (next section), and **the cross-tenant hub `/api/me/*`**, which shows a musician everything they are required for across all their bands (a personal workspace's planning views are built on it).

How a cross-tenant read works, and why it is still safe:

1. `resolveMemberTenantIds` — a *sibling* of `resolveTenantId` that **never sets `req.tenantId`** — derives the tenant set from the caller's approved, non-archived memberships and builds `req.memberTenants` once per request via `memberTenantScope` (`server/domain/memberTenants.js`).
2. That scope's `ids` is the only tenant set anything downstream can reach, so **the client never names the tenants it wants** — a tenant id in a body or query changes nothing, and a tenant the caller can't see is simply *absent* rather than blanked.
3. Queries are `…ForMemberTenants` variants in the owning aggregate's repository (there is no hub repository), taking that id list and returning rows interleaved across tenants.
4. Rows are labeled from the same scope (`ref`/`label` supply the band name and avatar), so no query joins `tenants` just to render one, and an id outside the scope blanks rather than invents a name. Per-tenant enrichment (participants, availability) groups the rows by tenant first, because those queries remain tenant-scoped.
5. **The hub is read-only.** Anything that writes goes through the ordinary tenant-scoped route with an active tenant.

## Availability belongs to the user, not a tenant

"Busy on 14 March" is a fact about the person, so slots live on `user_availability_slots` and each band reads a **redacted projection**.

- `availability_slots` remains for `band_members` rows with `user_id IS NULL` (deps, CRM-only entries). The band-side read (`availabilityService.js`) unions both, still keyed on `band_member_id`, so `/api/availability` keeps its URLs and shape.
- **Redaction happens in `server/services/availabilityProjection.js`, before serialization** — the API never emits a reason or band name the viewer may not see, so the frontend has nothing to hide. `users.availability_detail_visible` governs slot reasons, `users.cross_band_gig_detail_visible` governs bookings in other bands; both default off. Bookings in the *viewing* band aren't projected at all.
- Writes: `availability.write.self` (granted to `READER`) covers your own; writing another member additionally needs `planning.write` **and** that member's `memberships.availability_managed_by_band` for this band, both checked against the *target's* row — denial is 403. Band-wide and unlinked-member slots stay behind `planning.write`. Delegated writes record `created_by_user_id` / `created_in_tenant_id`.
- The musician's own calendar and the privacy/delegation settings are `/api/me/availability` (+ `/settings`), editable nowhere else.

## Backend foundations

- **Layering: route → service → repository → PostgreSQL**, validators at the service boundary. Routes stay thin; SQL lives in repositories; transactions (`withTransaction`) in services; common errors in `server/services/serviceErrors.js`; domain constants in `server/domain/`. **Canonical example: the rehearsals stack.** Load the **backend-layering** skill before adding or refactoring a backend resource.
- **Collection reads are scoped** — load the **collection-scoping** skill before adding or changing any list endpoint. `server/services/limitedCollectionService.js` owns every envelope (`limitedCollection`, `limitedCollectionWithTotal`, `limitedCollectionWithCursor`, `windowedCollection`): a service passes a fetcher and enriches `result.items`, never assembling `meta` by hand.
- **Deep bounded feeds ("load more") use a keyset cursor, never offset/page params** — `parseListCursor` (`server/validators/common.js`, alongside the shared `INVALID_CURSOR`/`INVALID_TODAY` messages), keyed on the same `(date, id)` tuple the repository's `ORDER BY … DESC, id DESC` tiebreaks on. Frontend types `LimitedCollectionWithCursorResponse<T>` / `ListCollectionCursor`. Reference: `GET /gigs/past`.
- **Notifications dispatch after the commit.** The transaction returns *what happened* (e.g. `{ gig, notifications: { … } }`) and the service acts on it once `withTransaction` resolves — no caller can forget to notify, and nothing goes out for a rolled-back write.
- **Shared primitives have one owner.** Search before adding a repository query or normalization helper. Aggregate reads belong to the aggregate's repository (e.g. `getBandMemberIdForUser` in `bandMemberRepository.js`); shared normalization to `server/utils`. Never duplicate equivalent SQL.
- Auth: OIDC protocol `server/oidc.js`, flows `server/routes/auth.js` → `authService.js`, user/terms middleware `server/middleware/auth.js`. A sign-in with zero memberships goes to `/onboarding` (or `/redeem-invite` when `isTenantOnboardingEnabled` is off). `ADMIN_EMAIL` bootstraps the super admin.
- CSRF (`server/middleware/csrf.js`): synchronizer token on `/api`; the SPA reads it from the `X-CSRF-Token` header on the `/auth/me` bootstrap. OIDC redirect GETs and **`/push/resubscribe`** are deliberately exempt.
- Logging (`server/utils/logger.js`): structured JSON, `docker logs` is the only sink. **`fields.err` is auto-redacted to name/code/status — never `.message`/`.stack`, in any environment; secrets leak via messages, don't reintroduce it.** Other fields must be whitelisted in `CONTEXT_KEYS` and primitive. Request correlation is automatic via AsyncLocalStorage (`server/middleware/requestContext.js`) — no `req` threading. `server/utils/auditLog.js` is a separate security audit trail — don't conflate them.

## Frontend foundations

- **Strict TypeScript** (`tsc --noEmit` at 0 errors); all `src/` app code is `.ts`/`.tsx`, only tests stay `.js`/`.jsx`. Backend stays ESM JavaScript. Load the **react-frontend** skill before frontend work.
- Anything derivable from props or state is **calculated during render, not stored in state**.
- No Redux/React Query — React contexts + hooks + component state; central contexts in `src/contexts/` (auth/tenant switching, profile, theming, toasts).
- **All HTTP goes through `src/api/_client.ts`** (CSRF header, error normalization, 401 events) behind a thin typed `src/api/<resource>.ts`. Page components never embed `/api/...` paths.
- Frontend guards and entitlement gating are **UX only** — backend middleware is authoritative.
- Key hooks: `usePermissions`, `useEntitlements`, `useTenantKind`, `useDebouncedSave` (600 ms, `flush()` on modal close), `useTenantQuerySync`.
- **Which feed a planning page reads is decided by tenant kind, not by the page**: a band workspace reads the active-tenant endpoints, a personal workspace reads the cross-tenant hub, and the same list renders both. That split, together with paging, "load more" and deep-link resolution, is owned by shared hooks (`usePagedEventTabs`, `useCrossTenantRow`) — a new list goes through them, not around them.
- **A row's writability follows the tenant it came from.** Hub rows carry a tenant label; active-tenant rows don't, so an unlabeled row is the current tenant's and a labeled foreign one is read-only whatever the viewer's role says. A row that hasn't loaded is *unknown*: not flagged as foreign, but not writable either. UX only — the backend still 404s outside `req.tenantId`.
- **Compact/mobile layout**: `useCompactLayout()` for compact-vs-desktop structure (table→card, stacked controls); it honors `CompactLayoutContext` (forced by `SplitView`). No new direct `useMediaQuery(breakpoints.down('sm'))` checks; name the boolean `isCompact`.
- Types: reuse `src/types/entities.ts` / `src/types/api.ts` rather than redeclaring shapes. Fields that carry `null` in payloads are `T | null`, not `T?` — switching a call site to `undefined` changes the JSON. Response-shape concerns stay in `api.ts` (the cross-tenant band label is `CrossTenantRef` / `MaybeCrossTenant<T>`, so entities carry no tenant-label fields). Components declare a `Props` interface, no `prop-types`; MUI icons are `SvgIconComponent`; imports use explicit extensions and `vi.mock` paths must match the `.ts`/`.tsx` source.
- **MUI v9** (Material 3). Theme-mode branching uses `useThemeMode()` (`src/contexts/themeModeContext.ts`), not `useTheme().palette.mode`. Money in tables uses `<MoneyCells>` + `<MoneyHeaderCells>` — each emits **two** `<TableCell>`s, so account for that in `colSpan`; compact cards use `formatEur`.
- **i18n**: i18next typed selector form `t($ => $.key)`, never bare `t('key')`; en canonical + nl in `src/i18n/`, parity enforced at compile time. Load the **i18n** skill for non-trivial work; copy existing English wording verbatim when extracting (tests assert literal copy).
- **Tutorials are frontend-driven** — registry `src/tutorials/registry.tsx` (order = priority), `useActiveTutorial.ts`, `TutorialHost.tsx`. No backend/schema change needed; dismissals are per-user, cross-tenant, ride on `/auth/me`. **Never rename a shipped tutorial key** (persisted).

## Finance & billing

The financial core is an **immutable double-entry ledger** (`ledger_transactions` + `ledger_entries`). Read `server/services/ledgerService.js` and the reference tests (`ledger.test.js`, `ledgerCompliance.test.js`, `ledgerBrowser.test.js`) before touching anything financial.

- **`postJournal()` is the only insert path** — never write ledger rows directly. Idempotency by `UNIQUE (tenant_id, source_type, source_id, source_event)`; re-posting returns `{ posted: false }`.
- **Corrections-forward, never edits**: entries are never updated or deleted. Open-period mistakes are *voided*, closed-period ones *reversed* (`applyCorrection`); external payments in closed periods use `clampToOpenPeriod`.
- Business services post **inside the same DB transaction** as the state change.
- Display classification of `(source_type, source_event)` lives in `server/services/ledgerEntryTypes.js` with a frontend mirror `src/utils/ledgerEntryType.ts` — **keep both in sync**.
- Tenant accounting settings are guarded by a per-tenant advisory lock (shared with `server/routes/accounts.js`).

**Accounting profile** — `tenant_accounting_profiles` is the single source of the tenant's regime (country, legal form, entity size, bases, financial-year start, base currency, default VAT rate, VAT registration and filing frequency).

- **`loadAccountingProfile` / `loadAccountingBehavior` (`accountingProfileService.js`) are the read primitives** and **throw `AccountingProfileMissingError`** (409 `accounting_profile_missing`) rather than defaulting — never guess a jurisdiction. Repair is an operator job: `node server/scripts/backfillAccountingProfiles.js --check`, then `--apply --tenant=<id> --country=<cc>`.
- Every tenant gets its profile in the **same transaction as the tenant insert**.
- `country_code` is immutable through PATCH (409 `country_immutable`); only `changeAccountingCountry` moves it, and it refuses once financial documents exist.
- Fiscal-year maths has one owner: `shared/fiscalYear.js` (consumed by `server/utils/periodQuery.js` and `src/utils/invoicePeriod.ts`). VAT quarters and invoice numbering stay calendar-based.
- **The `tenants` row carries no regime and no stored currency** — the books' currency is derived from `base_currency`, never stored. `tenants.directors` is the exception (a contact fact disclosed on invoices for incorporated legal forms, so renderers take the legal form as a parameter).
- Frontend: **`useAccountingProfile()` owns `accountingCountry` and `defaultVatRate`**; `ProfileContext` is band identity only, no regime.

**VAT treatment** — `server/services/vatTreatmentService.js` is the single owner. An **issued** invoice/purchase renders from its persisted `*_snapshot` columns so an old document reproduces what was sent; a **draft** resolves live and date-aware from `tax_scheme_enrolments` at the tax point. Registry `shared/taxSchemes.js`. Renderers (`renderInvoicePdf`/`renderInvoiceUbl`) and `shared/{invoiceReadiness,peppolReadiness}.js` stay pure — the caller passes the resolved treatment/regime in.

**Bank statement import** (CAMT.053/MT940): parsers `server/services/bankStatement/`, `bankImport*` service/repo/validators, dialog `src/components/ledger/BankStatementImportDialog.tsx`. Two-phase (parse-stage, then commit by line id) — **client money is never trusted**, amounts are re-read server-side.

**Platform billing** (Mollie, user-level subscriptions; tenants inherit from `tenants.owner_user_id`): **load the subscription-billing skill** before touching plans, entitlements, limits, tenant ownership, the billing lifecycle, or gating UI. Hard rules: `shared/entitlements.js` is the single source of truth; **never call the payment provider inside a DB transaction**; never import a concrete adapter (use `getPaymentProvider()`); remote mutations go through the `billing_operations` outbox saga. Customer-invoice Mollie payments and platform subscription billing are separate flows.

**Plans are two independent PRODUCTS**, not one ladder: `subscription_plans.audience` is `band` (`bronze` fallback, `silver`, `gold`) or `artist` (`artist_bronze` fallback, `artist_gold`), registered in `shared/planAudiences.js`.

- **One live subscription per audience per user**, and **a subscription is bound to its audience for life**: no upgrade or downgrade crosses the boundary, DB triggers refuse it, and every entry point routes by the *target plan's* audience, so naming a plan on the other ladder is an ordinary 404.
- **Tenant kind selects the ladder** (band tenant → owner's band subscription, personal → artist), entirely inside `resolveOwnerEntitlements`/`resolveTenantEntitlements`. Callers using the `{ ownerUserId, tenantKind }` fast path must supply **both** — `audienceForTenantKind` throws rather than defaulting.
- Anything band-scoped reads the **band** ladder: `enforceBandCap` ignores an artist plan's vestigial `bands: 0`, and downgrade blockers and the purge are scoped to `tenantKindsForAudience(…)` so an artist downgrade never touches a band.
- Ranking, the free fallback and trials are per-product. Frontend `src/utils/planLadder.ts` + `PlanLadderSection` render one ladder each; `SubscriptionSummaryCard` and the AppShell logo follow the *active tenant's* ladder.

A sideman on a cheap artist plan still plays in someone else's gold band — a band's entitlements come from its *owner's* subscription. Every plan carries a complete entitlements object; `FEATURES.CALENDAR_SYNC` gates the ICS feed independently of `integrations`. Keep `server/db/defaultPlans.js` and the seeding migration in step.

## Cross-cutting services

- Storage: MinIO client `server/utils/storage.js`; tenant keys, quotas, cleanup and version-aware tenant purge in `server/services/storageService.js`; encrypted integration credentials in `server/security/integrationSecrets.js`. Third-party keys are **per-tenant encrypted credentials, never env vars**.
- Notifications `server/services/notificationService.js`; web push `server/services/pushService.js` + `public/sw.js`, registered via `src/registerServiceWorker.ts`. A failed service-worker registration leaves `serviceWorker.ready` pending forever, so failures are logged and every wait on `ready` is time-bounded — the UI reports an unavailable push subscription rather than spinning on "loading".
- Achievements: single registry `server/achievements/definitions.js`, facts SQL in `factsBuilder.js`, evaluated lazily on read (no scheduler). **Never rename a shipped achievement key** (persisted, doubles as i18n/icon key). The catalogue is a *function of tenant kind*: each definition declares `kinds`, filtering happens before evaluation, and totals are only comparable within a kind — count "x of y" against `definitionsForKind(kind)`, never the union.
- Metrics `server/metrics.js`; Grafana Alloy config `observability/config.alloy`.

## Migrations

New migrations go in `server/db/migrations/` as `NNN_name.sql`. The runner sorts alphabetically, so **numeric prefixes must stay monotonic and zero-padded**. They run on the next `migrate`; never hand-apply SQL. Deploys migrate while the previous app container still serves — follow **expand → migrate → contract**, never dropping a column in the same deployment as the code change.

## Misc conventions

- Keep comments minimal and concise — only where they aid understanding; otherwise let the code speak.
- When giving the user a multi-line vs. line-by-line command, say which.
- Don't restructure readable code solely to satisfy a linter or SonarQube complexity threshold — prefer a clear `switch`/early returns, or mark the issue `accept`.
