# CLAUDE.md

Guidance for Claude Code working in this repository. These are the non-obvious fundamentals — architecture, conventions, and environment quirks you can't infer by reading code. For *what the code does*, read the code.

## Environment & secrets

**Node 24** everywhere: local dev, CI (`.github/workflows/deploy.yml`), and the Docker images (`node:24-alpine`). Keep the three in sync when bumping.

**Secrets are injected by Infisical — never edit `.env` by hand and never paste credentials.** Every command that needs env vars must be wrapped:

```
infisical run -- <command>
```

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

## Logging

Structured JSON-line logging, zero external dependencies — `docker logs` (the `json-file` driver) is the only log sink, there's no ELK/Datadog.

- **`server/utils/logger.js`** exports `logger.debug/info/warn/error(event, fields)`. One JSON line per call to stdout (debug/info) or stderr (warn/error). `LOG_LEVEL` env var (`debug|info|warn|error`, default `info`; an unrecognized value also falls back to `info`) gates verbosity.
- **`fields.err` is auto-redacted to `{errorName, errorCode, errorStatus}` only — never `err.message`/`err.stack`, in any environment.** This is deliberate, not a gap: a thrown error's `.message` can embed secrets (see the credential-leak case in `src/tests/server/logger.test.js`). Don't reintroduce message/stack via an env-gated "non-production" branch — that was considered and rejected.
- Every other field must be in the `CONTEXT_KEYS` whitelist in `logger.js` **and** a primitive (string/number/boolean/null) — non-whitelisted or non-primitive values are silently dropped. Extending `CONTEXT_KEYS` is the intended way to add a new field; never add a generic `message`/free-text key — route diagnostic text through `err` instead.
- **Request correlation is automatic, no `req` threading required.** `server/middleware/requestContext.js`'s `requestContext` middleware opens an `AsyncLocalStorage` store (`server/utils/requestContextStore.js`) per request and returns the id as the `X-Request-Id` response header; `loadUser` (`middleware/auth.js`) and `resolveTenantId` (`middleware/tenant.js`) call `setContextField` once `userId`/`tenantId` resolve. Any `logger.*` call anywhere in the route→service→repository chain — including background `.catch()` handlers — picks these up for free. When both an ALS value and a caller-passed field share a name, **the ALS value wins** (a stale closure value must never override the real request's tenant/user).
- `requestLogger` (mounted on `/api`, before the body parser/session so a parse/session failure still gets logged) emits one `http.request` line per request: `info` for `<400`, `warn` for `<500` (also the client-disconnect/abort path, flagged `aborted: true`), `error` for `>=500`.
- **`server/utils/auditLog.js` is a separate, untouched security-audit-trail logger** (`action`/`userId`/`tenantId`/`ip` shape, its own whitelist) for sensitive events like login/invite-redeem. Don't conflate it with `logger.js` or change its field shape — it predates and is independent of the request-logging work above.

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

## Bank statement import (CAMT.053 / MT940)

Bank statements are imported into the ledger from the `/ledger` toolbar ("Import statement", finance-manage only). The stack: parsers `server/services/bankStatement/{index.js,camt053.js,mt940.js}`, then `server/{services/bankImportService.js,repositories/bankImportRepository.js,validators/bankImportValidators.js,routes/bankImport.js}` (mounted finance-gated at `/api/bank-import`), migrations `111` (`contacts.iban`) + `112` (`bank_statement_imports` + `bank_statement_lines`), frontend `src/components/ledger/BankStatementImportDialog.tsx` + `src/api/bankImport.ts`. Modeled on the Shopify importer (report-and-skip, own-transaction-per-line). Non-obvious rules:

- **Two-phase; client money is never trusted.** `parse` stages every parsed line into `bank_statement_lines`; `commit` sends only per-line *decisions* referencing staged line ids, and the service re-reads amounts/direction and locks the target doc (`FOR UPDATE`) before posting. Amounts never come from the request.
- **New source_type `bank_statement_line` with two events** so the browser signs rows without the direction: `received` (credit, +1) and `paid` (debit, −1), posted by `postBankStatementLine` (added to `TYPE_MAP`/`describe` in `ledgerEntryTypes.js`; the frontend mirror needs no change — bank lines use the existing `payments` group). Direct-journal lines post **gross, no VAT split**.
- **Decision model per line**: `reconcile_invoice` / `reconcile_purchase` (mark the existing doc paid via `postInvoicePaid`/`postBillPaid` on the statement booking date — exact-amount match is **mandatory**, Mollie-linked invoices are excluded), `journal_paid` (outgoing → expense contra + optionally link/create a supplier), `journal_received` (incoming → one chosen income account), `skip`. **All imported external movements clamp to the open period** (`clampToOpenPeriod: true`) — the single documented closed-period policy.
- **Supplier match = `contacts.iban`** (migration 111, **deliberately non-unique**): match by normalized IBAN then exact name; **multiple matches are ambiguous and never auto-picked** — the user chooses. Suppliers are created deferred, at commit.
- **Dedup is `file_hash` (hard) + a soft "possibly already imported" flag; never a content-fingerprint unique** (recurring rent / identical lines are legitimate). Exact re-upload of a file returns the existing import. Per-line ledger idempotency comes from `source_id = bank_statement_lines.id`. The soft flag uses `duplicateIdentity` (account+bankRef+date+amount+direction) against **other** imports only; sentinel refs (`NONREF`/`NOTPROVIDED`) are ignored (`meaningfulRef`).
- **Only the tenant currency posts.** Other-currency lines stage as `skipped_currency` and never reach the ledger. Parse rejects >1000 lines (matches the commit-decision cap). An import is marked `committed` only when **no pending lines remain** (an all-skipped import still finalizes; user skips are explicit terminal decisions).
- **Parser gotchas** (`fast-xml-parser` is a direct dep): namespaces are stripped for compatibility across `camt.053.001.NN`; `parseTagValue:false` keeps account ids/amounts as strings (leading zeros); `Ntry/Amt` is always the booked movement. Multiple `NtryDtls/TxDtls` expand only when every detail amount is in the booked currency and their sum exactly matches `Ntry/Amt`; otherwise the entry stays aggregate (never inherit the aggregate amount per detail). V02 direct party names and V08+ `Pty/Nm` are both read; non-IBAN `Othr/Id` accounts are supported; `CdtDbtInd` remains the booked direction for reversals while `RvslInd` selects parties using the original direction, and `RtrInf` only flags. MT940 handles SWIFT block wrappers, wrapped `:61:` continuation, and both `?nn` and `/TAG/` `:86:` forms. All parsed IBANs are normalized (`normalizeIban`: strip spaces, upper-case) to match stored contact IBANs.
- Reference tests: `src/tests/server/bankStatementParsers.test.js` (real Goldman Sachs MT940, Westpac CAMT, ING CAMT + synthetic fixtures under `fixtures/bankStatements/`), `bankImport.test.js` (isolation, idempotency, reconcile, dedup, currency, `ledger_transaction_id`).

## Finance onboarding & in-app tutorials

Migration `114`, two **independent** foundations — a domain-agnostic tutorial-overlay system and one domain (finance) that uses it.

- **Opening balance is a ledger entry, not a setting.** `postOpeningBalance` (`ledgerService.js`) posts `opening_balance/set` — DR checking / CR system Opening Balance Equity (`39000`); signed amount (negative = overdrawn swaps sides); **idempotent per tenant** (`sourceId` = tenant id); **not** clamped to the open period. `hasOpeningBalance()` gates the welcome tutorial and the bank-import nudge. The finance stack (`server/*/financeOnboarding*`, `/api/finance-onboarding`, `src/pages/FinanceOnboardingPage.tsx` stepper wizard) only owns its transaction/error contract and reuses that posting.
- **Tutorials are frontend-driven — adding one needs no backend/schema change.** `src/tutorials/registry.tsx` is the single ordered registry (order = priority); each `TutorialDef` has a stable `key` (**never rename — persisted in `user_tutorial_dismissals`**), optional sync `eligible(ctx)` + async `condition()` gates, and a self-contained `Dialog` Card. `useActiveTutorial` picks the first eligible/undismissed/passing one; `TutorialHost` (mounted in `AppShell`) renders it.
- **Dismissals are per-user, global (cross-tenant).** Thin backend: `POST /api/tutorials/:key/dismiss` (`currentTermsUser`, no tenant resolution), key validated by **format only, no allow-list**; dismissed keys ride on `/auth/me` as `user.dismissedTutorials`.

## Subscriptions, entitlements & platform billing

Paid tiers (bronze/silver/gold) gate features and limits per tenant; billing runs on Mollie behind a provider port (migrations `100`–`105`). **Load the subscription-billing skill** before touching plans, entitlement gates, limits, tenant ownership, the billing lifecycle (incl. the downgrade/purge flow — the one flow that deletes data), or the gating UI. The invariants to never break:

- **Subscriptions are user-level; tenants inherit from `tenants.owner_user_id`.** An ownerless tenant skips enforcement entirely (legacy; deliberate, no backfill).
- **`shared/entitlements.js` is the single source of truth** for features/limits (`null` limit = unlimited).
- The entitlement resolver enforces all time bounds itself on read — the scheduler is repair-only; **access never depends on it running**. A lapsed subscription fallback-locks to the free plan; data is never deleted by a lapse — only a confirmed downgrade purges, and only after the target plan is real (paid or period-end final).
- **Never call the payment provider inside a DB transaction**, never import a concrete adapter (use `getPaymentProvider()`), and every remote mutation goes through the `billing_operations` outbox saga with a deterministic idempotency key.
- Payment ingestion is one funnel (`applyPaymentOutcome`); the webhook payment id is a routing hint only — status is always re-fetched from the provider.
- Entitlement gating in the frontend is presentation only; the API gate is the defense. Tier-locked nav stays visible (diamond → `/upgrade/:feature`); role-gated nav is hidden.

## Backend layering: route → service → repository

Backend resources follow a route → service → repository → validator split. **The rehearsals stack is the canonical example** — `server/routes/rehearsals.js`, `server/services/rehearsalService.js`, `server/repositories/rehearsalRepository.js`, `server/validators/rehearsalValidators.js`. New routes and refactors must follow it. Load the **backend-layering** skill for the full layer responsibilities, error contract, and refactoring playbook.

## Achievements

Per-tenant gamification badges, evaluated **lazily on read, no scheduler** — `server/achievements/definitions.js` is the single registry (stable snake_case `key`, `category`, `cheers` worth, pure `test(facts, unlockedKeys)` predicate; **never rename a shipped key**, it's persisted in `tenant_achievements` and doubles as the frontend i18n/icon key). `factsBuilder.js` owns all the SQL, producing a flat primitive facts object so predicates stay pure and I/O-free. `achievementService.listAchievements()` re-tests still-locked definitions against fresh facts on every `GET /api/achievements`, persists new unlocks (insert-only, `ON CONFLICT DO NOTHING`), and fires a notification — except on a tenant's first-ever evaluation ("baseline pass"), which suppresses notifications to avoid a burst from pre-existing history. Once every definition is unlocked for a tenant the payload is cached indefinitely (unlocks are permanent); a deploy restarts the process and clears it. Meta-achievements read `unlockedKeys` and must be declared after their prerequisites so they unlock in the same pass as the last one.

## Migrations

New migrations go in `server/db/migrations/` as `NNN_name.sql` and run on the next `migrate`. The runner sorts alphabetically, so **numeric prefixes must stay monotonic** and zero-padded. They run automatically; don't hand-apply SQL.

## Conventions

### TypeScript & React
- Load react-frontend skill before working on the front end.
- **The frontend is TypeScript, strict mode on.** All app code under `src/` is `.ts`/`.tsx`; only tests stay `.jsx`/`.js`. `tsc --noEmit` via `npm run type-check` is the type gate — keep it at 0 errors. tsconfig has `strict:true` (incl. `strictNullChecks`); only `noUnusedLocals`/`noUnusedParameters` stay off (eslint covers unused, and tsc's variant is noisier on PascalCase type imports).
- Because of strict null checks, **entity fields that carry `null` in API payloads are typed `T | null`, not just optional `T?`** (e.g. `Slot.band_member_id?: Id | null` where null = whole band, `Contact.email?: string | null`) — match that when a payload sends an explicit `null`; don't paper over it by switching the call site to `undefined` (that changes the JSON sent).
- Canonical shared entity types live in `src/types/entities.ts` (the `Id`, `Gig`, `Invoice`, … you import instead of redeclaring); api error shape in `src/types/api.ts`.
- Type MUI icon component props as `SvgIconComponent` (from `@mui/icons-material`), not `ComponentType<…>` — raw MUI icons are `OverridableComponent` and won't assign to a plain `ComponentType`.
- Imports use explicit extensions; when a test mocks a module by path (`vi.mock`), the path must match the `.ts`/`.tsx` source.
- ESLint lints `.ts/.tsx` via `typescript-eslint` (non-type-checked recommended) and `.js/.jsx` (tests, server, config) via the JS recommended set; `npm run lint` and `npm run type-check` should both stay clean.
- **Components are typed, not PropTyped.** Every component declares a `interface ComponentNameProps { ... }` on its signature (no `prop-types`; React 19 ignores PropTypes at runtime). Reuse shared entity types from `src/types/entities.ts` rather than redeclaring shapes inline; add a field there when a component needs one that isn't present yet. For a local-only field, extend the entity (`type Foo = Account & { __stale?: boolean }`).

### MUI & theming
- **MUI v9** (Material 3 theme, `borderRadius: 12`); `TextField`'s `inputProps` is replaced by `slotProps.htmlInput`. System-prop placement (`sx` vs bare props) is covered by the react-frontend skill.
- **Theme mode detection**: use `const { mode } = useThemeMode()` from `src/contexts/themeModeContext.ts` to get `'light' | 'dark'`. Do not use MUI's `useTheme().palette.mode` for branching — `useThemeMode` is the single source of truth. Use it to switch between logo variants (e.g. `mode === 'dark' ? '/share/foo/foo_white.png' : '/share/foo/foo_black.png'`) or to apply conditional styles.
- **Currency in tables**: render money amounts with `<MoneyCells cents={…} />` (and `<MoneyHeaderCells label="…" />` in the head) from `src/components/shared/MoneyCells.tsx`. It splits the EUR symbol into its own narrow right-aligned column so the `€` lines up vertically across rows while the digits stay right-aligned. Each `MoneyCells`/`MoneyHeaderCells` emits **two** `<TableCell>`s — account for that in `colSpan`. Don't put a bare `formatEur()` in a `TableCell` (compact card views still use `formatEur` directly).

### API & data flow
- New resource routers are registered in `server/routes/index.js`; each frontend resource gets one thin `src/api/*.ts` wrapper around `_client.request` (the only place that knows the `/api/*` path). Use the generic `request<T>()` so responses are typed.
- Auto-save fields use `useDebouncedSave` (600 ms debounce; `flush()` on modal close).

### i18n
- **i18n (i18next, selector API).** Load the i18n skill before non-trivial translation work. Strings are localized en/nl via the **typed selector form** `t($ => $.key)` (never bare `t('key')`) — a missing key is a `type-check` error. `src/i18n/` has 28 namespaces scaffolded from the nav + views (`common`, `navigation`, `glossary`, `validation`, then one per view); per-view bodies are still mostly hardcoded English — extract them into the **existing** namespace. `index.ts` registers en (canonical) + nl, with a `DeepKeyShape` `satisfies` guard enforcing en/nl key parity at compile time. When wiring an existing English string, copy its wording verbatim (tests assert literal copy).

### Misc
- When giving the user a multi-line vs. line-by-line command, say which — don't leave a block ambiguous.
- Don't restructure readable code solely to satisfy a linter or SonarQube cognitive-complexity (S3776) threshold — prefer a clear `switch`/early-returns, or mark the issue `accept`. Extracting genuine helpers is fine; obfuscating to win a metric is not.
