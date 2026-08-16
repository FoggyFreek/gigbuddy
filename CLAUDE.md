# CLAUDE.md

Guidance for Claude Code in this repository: environment quirks, the architecture map, and the invariants you can't infer from any single file. For *what the code does*, read the code — start at the files named below.

**This file keeps the prohibitions; the skills keep the procedures.** Depth that only some tasks need lives in `.claude/skills/` and is listed under "Architecture map" below — load the named skill before working in its area.

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
infisical run -- npm test -- --run src/<domain>/<feature>/__tests__/Foo.test.jsx   # one frontend file
infisical run --env=test -- npx vitest run --config vitest.server.config.js src/tests/server/<file>.test.js   # targeted backend test — the default
infisical run --env=test -- npm run test:server             # FULL backend suite (~8 min) — only when explicitly asked
```

- **Always pass `--config vitest.server.config.js` for backend runs** — it owns the parallel-database harness. `npm run test:server -- <file>` does NOT narrow the run, it runs everything.
- **Backend tests mutate a real Postgres database whose name must end in `_test`** — the `_db.js` helpers verify `current_database()` before migrating, truncating or seeding. **Never weaken that check.**
- **Frontend** (co-located `src/<domain>/<feature>/__tests__/`, jsdom): mock the feature API module with `vi.mock`; components go through a local `wrap()` helper (MUI `ThemeProvider` + `LocalizationProvider`/`MemoryRouter` as needed); debounced-save tests use `vi.useFakeTimers()` + `vi.runAllTimersAsync()`.
- When you add backend behavior, add an isolation test proving **tenant isolation holds** — a cross-tenant read/write must 404, not leak.
- Load the **test-harness** skill for the harness itself: fixtures, the per-worker template database, and the `GIGBUDDY_TEST_FRESH_TEMPLATE=1` rule when you edit an already-applied migration.

## Architecture map — where to start reading

One Node process in production: Express serves `/api`, the built `dist/` assets, and the SPA fallback. Vite proxies `/api` → :3002 in dev.

| Concern | Start here |
|---|---|
| Frontend bootstrap / provider hierarchy | `src/main.tsx` |
| Route tree + frontend access guards | `src/app/App.tsx` (`RequireAuth`/`RequirePermission`/`RequireEntitlement`/`RequireTenantCapability`/`RequireSuperAdmin`) |
| App shell / navigation | `src/components/AppShell.tsx`, `src/components/appShell/` |
| Backend bootstrap + middleware pipeline | `server/index.js` |
| API composition, access tiers, rate limits, gates | `server/app/apiRouter.js` |
| DB connection / transactions | `server/db/index.js`, `server/db/withTransaction.js` |
| Schema evolution | `server/db/migrate.js`, `server/db/migrations/` |
| Rules shared by frontend & backend | `shared/` (`permissions.js`, `entitlements.js`, `tenantCapabilities.js`, …) |
| Shared frontend types | `src/types/entities.ts`, `src/types/api.ts` |

**Depth lives in skills — load the one that matches before you work:**

| Skill | Covers |
|---|---|
| `backend-layering` | route → service → repository structure, the error contract, the canonical rehearsals stack |
| `collection-scoping` | any list endpoint: `?limit=`, `?from=&to=`, keyset cursors, the `{ items, meta }` envelope |
| `tenant-model` | band vs personal tenants, capabilities, the cross-tenant `/api/me/*` hub, global band profiles, `my_bands` |
| `availability` | user-level slots, the redacted band projection, delegated writes |
| `finance-ledger` | double-entry ledger, accounting profile/regime, VAT treatment, bank import |
| `subscription-billing` | plans, subscription modules, pricing rules & snapshots, entitlements, limits, Mollie lifecycle, refunds, gating UI |
| `test-harness` | backend test database internals |
| `react-frontend` / `i18n` / `material-ui-theming` | frontend rules, translations, theming |
| `detail-component-permissions` | gating editing affordances in detail/editor components |
| `chordpro` / `sonarqube-issues` | the chart format; triaging Sonar findings |

## Project structure — vertical slices

Organize application code by domain and feature. Start in the owning slice, read its existing patterns, and put new feature-specific code there.

- **Backend:** `server/<domain>/<feature>/` owns its routes, service, repository, validators, and feature tests. Keep application wiring in `server/app/`, reusable platform capabilities in `server/platform/`, cross-domain rules in `server/domain/`/`server/utils/`, and database code exclusively in `server/db/`.
- **Frontend:** `src/<domain>/<feature>/` owns its API wrapper, pages, feature components, hooks, helpers, i18n, and `__tests__/`. `src/app/` composes routes; `src/api/_client.ts` is the sole HTTP client; `src/components/` is only for reusable shared UI; `src/contexts/`, `src/hooks/`, `src/types/`, `src/utils/`, and `src/i18n/` hold genuinely cross-feature code.
- **Domains:** `app`, `planning`, `people`, `music`, `finance`, `commerce`, `promotion`, `user`, `admin`, and `platform`. Prefer an existing domain/feature over creating a parallel horizontal layer.
- Do not move or change `server/db/` (including migrations) when restructuring application code.

**Decoupled link-page app**: band link pages live in a separate repo with their own DB and deploy, talking to gigbuddy only over HTTP — `publicLinkpage.js` is **unauthenticated** (shared-secret bearer: content export + signed image proxy), `linkpage.js` issues short-lived editor handoff tokens, both in `server/promotion/linkpage/`. Secrets: `LINKPAGE_SECRET`, `LINKPAGE_URL`. The wire contract is `docs/linkpage-integration.md` — read it before touching the slug outbox or the handoff payload.

## Tenant kinds — shared architecture, capability split

`tenants.kind` is `band` or `personal`. A personal workspace is an ordinary tenant — same routes, services, repositories, tables, permissions and isolation — that happens to have one member. **Shared is the default**: never fork a domain into band/personal implementations just for wording or visibility.

- Genuine differences are named capabilities in `shared/tenantCapabilities.js`. Prefer capability checks over scattered `kind === …` comparisons.
- Backend is authoritative (`requireTenantCapability` and its field/predicate variants in `server/middleware/tenant.js`); frontend `useTenantKind().supports(…)` / `RequireTenantCapability` are UX only.
- `tenants.display_name` is the kind-neutral name. Prefer kind-neutral vocabulary.
- **Load the tenant-model skill** (and `docs/tenant-kind-architecture.md`) before adding kind-specific behavior — add a capability, not a parallel feature stack.

## Multi-tenant isolation — the core invariant

Multiple bands share one instance with strict data isolation. This is the most important thing to preserve.

- Every tenant-owned read/write/join is scoped by `req.tenantId`. Never trust a client id without the tenant scope. Composite FKs (`(child_id, tenant_id) → parent(id, tenant_id)`) are the DB backstop, not the primary defense.
- **Cross-tenant reads and updates return 404, not 403** — existence must not leak.
- The active tenant lives in `req.session.activeTenantId`; `resolveTenantId` (`server/middleware/tenant.js`) loads the matching approved membership or 403s — no fallback. URLs stay flat (`/gigs`), no tenant prefix.
- **Intra-tenant shared trust**: any approved member reads and writes *all* of the tenant's resources. **Do not add per-user ownership checks inside a tenant unless explicitly asked.**
- Privilege tiers: tenant admin (`role='tenant_admin'` or super admin) manages memberships/invites/logo; super admins (`users.is_super_admin`) manage globally but still need an approved membership to *use* a tenant's data. Role permissions have one source: `shared/permissions.js` (enforcement `server/middleware/permissions.js`, typed frontend wrapper `src/auth/permissions.ts`). **A tenant must always keep one approved `tenant_admin`** — `assertTenantAdminRemains` (`server/people/memberships/userService.js`) guards every path that could take the last one away (removal, self-leave, demotion, rejection), super admins included. Leaving a band is user-level: `DELETE /api/me/memberships/:tenantId`.
- File keys are `tenants/<tenant_id>/<category>/<uuid>`; access is gated by an ownership lookup in the active tenant before streaming, and uploads go through storage quota enforcement (`server/platform/files/storageService.js`). **Tenant profile pictures are the deliberate exception**: `server/people/workspaces/tenantAvatar.js` authorizes by *membership*, because avatars render for every tenant the caller can see.

Three things sit deliberately **outside** tenant scoping — user-level availability, the cross-tenant hub `/api/me/*`, and global band profiles. They are not loopholes; each has its own rules, and touching any of them means loading the **tenant-model** or **availability** skill first.

## Availability belongs to the user, not a tenant

"Busy on 14 March" is a fact about the person, so slots live on `user_availability_slots` and each band reads a **redacted projection** produced in `server/planning/availability/availabilityProjection.js` *before* serialization — the API never emits a reason or band name the viewer may not see. The musician's own calendar and privacy settings are `/api/me/availability`, editable nowhere else.

Load the **availability** skill before changing slots, the projection, or who may write another member's availability.

## Backend foundations

- **Layering inside each backend slice: route → service → repository → PostgreSQL**, with validators at the service boundary. Routes stay thin; SQL lives in repositories; transactions (`withTransaction`) in services; common errors are in `server/platform/http/serviceErrors.js`; domain constants are in `server/domain/`. Load the **backend-layering** skill for the full contract.
- **Collection reads are scoped** — load the **collection-scoping** skill before adding or changing any list endpoint. `server/platform/collections/limitedCollectionService.js` owns every envelope; a service passes a fetcher and enriches `result.items`, never assembling `meta` by hand. **Never add offset pagination.**
- **Notifications dispatch after the commit.** The transaction returns *what happened* (e.g. `{ gig, notifications: { … } }`) and the service acts on it once `withTransaction` resolves — no caller can forget to notify, and nothing goes out for a rolled-back write.
- **Shared primitives have one owner.** Search before adding a repository query or normalization helper. Aggregate reads belong to the aggregate's repository (e.g. `getBandMemberIdForUser` in `bandMemberRepository.js`); shared normalization to `server/utils`. Never duplicate equivalent SQL.
- Auth: OIDC protocol `server/oidc.js`, flows `server/user/identity/auth.js` → `authService.js`, user/terms middleware `server/middleware/auth.js`. A sign-in with zero memberships goes to `/onboarding` (or `/redeem-invite` when `isTenantOnboardingEnabled` is off). `ADMIN_EMAIL` bootstraps the super admin.
- CSRF (`server/middleware/csrf.js`): synchronizer token on `/api`; the SPA reads it from the `X-CSRF-Token` header on the `/auth/me` bootstrap. OIDC redirect GETs and **`/push/resubscribe`** are deliberately exempt.
- Logging (`server/utils/logger.js`): structured JSON, `docker logs` is the only sink. **`fields.err` is auto-redacted to name/code/status — never `.message`/`.stack`, in any environment; secrets leak via messages, don't reintroduce it.** Other fields must be whitelisted in `CONTEXT_KEYS` and primitive. Request correlation is automatic via AsyncLocalStorage (`server/middleware/requestContext.js`) — no `req` threading. `server/utils/auditLog.js` is a separate security audit trail — don't conflate them.

## Frontend foundations

- **Strict TypeScript** (`tsc --noEmit` at 0 errors); all `src/` app code is `.ts`/`.tsx`, only tests stay `.js`/`.jsx`. Backend stays ESM JavaScript. Load the **react-frontend** skill before frontend work.
- Anything derivable from props or state is **calculated during render, not stored in state**.
- No Redux/React Query — React contexts + hooks + component state; central contexts in `src/contexts/` (auth/tenant switching, profile, theming, toasts).
- **All HTTP goes through `src/api/_client.ts`** (CSRF header, error normalization, 401 events) behind a thin typed API module in the owning frontend feature slice. Page components never embed `/api/...` paths.
- Frontend guards and entitlement gating are **UX only** — backend middleware is authoritative.
- **MUI v9** (Material 3). Component conventions, shared types, the cross-feature hooks (`useDebouncedSave`, `useCompactLayout`, …) and the tutorial registry are all in the **react-frontend** skill. **Never rename a shipped tutorial key** (persisted).
- **Which feed a planning page reads is decided by tenant kind, not by the page** — `usePlanningSource(aggregate)` and `usePagedEventTabs` own that split, and a row's writability follows the tenant it came from. A new list goes through them, not around them; see the **tenant-model** skill.
- **i18n**: i18next typed selector form `t($ => $.key)`, never bare `t('key')`; shared namespaces live in `src/i18n/`, feature namespaces live beside their feature, with en canonical + nl and parity enforced at compile time. Load the **i18n** skill for non-trivial work; copy existing English wording verbatim when extracting (tests assert literal copy).

## Finance & billing

Two separate concerns, each with its own skill. **Load the skill before touching either** — the prohibitions below are the minimum that must hold even if you don't.

**Books** (`server/finance/`, `src/finance/`) → the **finance-ledger** skill. An immutable double-entry ledger (`ledger_transactions` + `ledger_entries`):

- **`postJournal()` is the only insert path** — never write ledger rows directly.
- **Corrections-forward, never edits** — entries are never updated or deleted; open-period mistakes are voided, closed-period ones reversed.
- Business services post **inside the same DB transaction** as the state change.
- **Never guess a jurisdiction.** `loadAccountingProfile` throws `AccountingProfileMissingError` (409) rather than defaulting; `tenant_accounting_profiles` is the single source of the tenant's regime.
- Never change persisted math — `computeInvoiceTotals` output is frozen once posted; new views must be additive and tie back to it exactly.

**Platform billing** (Mollie, user-level subscriptions; tenants inherit from `tenants.owner_user_id`) → the **subscription-billing** skill:

- `shared/entitlements.js` is the single source of truth for features and limits; **`shared/pricing.js` is the single source of truth for money** — the server charges and the frontend quotes from the same pure engine, so a quote and an invoice cannot drift.
- **Never call the payment provider inside a DB transaction**, and never import a concrete adapter — use `getPaymentProvider()`. Remote mutations go through the `billing_operations` outbox saga.
- **One subscription per user, composed of band/artist MODULES** on one shared cycle (`subscription_modules`, migration `181`). Band and artist stay two independent products (`subscription_plans.audience`, `shared/planAudiences.js`) and tenant kind selects the module; what they share is the cycle, the price and the renewal payment. **Absence of a module IS that ladder's free plan** — a fallback plan can never be stored as one. Keep `server/db/defaultPlans.js` and the seeding migration in step.
- Per-product state (`entitlement_overrides`, purge manifest, limits snapshot, a scheduled plan change) lives on the **module row**, never the subscription — an artist downgrade's `bands: 0` snapshot must not zero the owner's band cap.
- **Pricing-rule terms are never edited in place** — a price snapshot pins `{ code, version }`, so changing a discount supersedes it with a new version.
- Customer-invoice Mollie payments and platform subscription billing are separate flows.
- Product-level docs: `docs/subscriptionmodel/`.

## Cross-cutting services

- Storage: MinIO client `server/utils/storage.js`; tenant keys, quotas, cleanup and version-aware tenant purge in `server/platform/files/storageService.js`; encrypted integration credentials in `server/security/integrationSecrets.js`. Third-party keys are **per-tenant encrypted credentials, never env vars**.
- Notifications `server/user/notifications/notificationService.js`; web push `server/user/push/pushService.js` + `public/sw.js`, registered via `src/registerServiceWorker.ts`. A failed service-worker registration leaves `serviceWorker.ready` pending forever, so failures are logged and every wait on `ready` is time-bounded — the UI reports an unavailable push subscription rather than spinning on "loading".
- Achievements: single registry `server/user/achievements/definitions.js`, facts SQL in `factsBuilder.js`, evaluated lazily on read (no scheduler). **Never rename a shipped achievement key** (persisted, doubles as i18n/icon key). The catalogue is a *function of tenant kind*: each definition declares `kinds`, filtering happens before evaluation, and totals are only comparable within a kind — count "x of y" against `definitionsForKind(kind)`, never the union.
- Metrics `server/metrics.js`; Grafana Alloy config `observability/config.alloy`.

## Migrations

New migrations go in `server/db/migrations/` as `NNN_name.sql`. The runner sorts alphabetically, so **numeric prefixes must stay monotonic and zero-padded**. They run on the next `migrate`; never hand-apply SQL. Extensions are usable (`168_band_profiles.sql` creates `pg_trgm`): dev, CI and production all bootstrap Postgres from `POSTGRES_USER`, which is a superuser. Deploys migrate while the previous app container still serves — follow **expand → migrate → contract**, never dropping a column in the same deployment as the code change.

## Misc conventions

- Keep comments minimal and concise — only where they aid understanding; otherwise let the code speak.
- When giving the user a multi-line vs. line-by-line command, say which.
- Don't restructure readable code solely to satisfy a linter or SonarQube complexity threshold — prefer a clear `switch`/early returns, or mark the issue `accept`.
