---
name: subscription-billing
description: Subscription, entitlement, and Mollie platform-billing architecture — one subscription per user composed of band/artist MODULES on one shared cycle, the pricing-rule discount engine and price snapshots, the 30-day trial, proration, refunds. Use when touching plans or plan audiences, pricing rules, entitlements/feature gates, limits (storage/members/bands), tenant ownership, the billing lifecycle (trial/checkout/module change/downgrade/cancel/refund/webhooks/saga/scheduler), or the frontend gating UI (diamond nav lock, tier logos, /billing pages, module sections, DowngradeDialog, CancelDialog).
user-invocable: false
---

# Subscriptions, entitlements & platform billing

Paid tiers gate features and limits per tenant; billing runs on Mollie behind a provider port. Migrations `100`–`105` laid the foundation; `180`–`182` are the modular model. This skill is the code-level map and the invariants you must not break.

## One customer, one subscription, N modules

A user holds **one live subscription** (`subscriptions`, partial unique index on `user_id WHERE status <> 'canceled'`). Which products it contains lives in **`subscription_modules`**: one row per `audience` (`band` | `artist`), each on its own plan.

- **Band and artist are still two independent PRODUCTS** — they are just sold as modules of one subscription, priced together on **one shared cycle** with **one renewal payment**. `shared/planAudiences.js` and `audienceForTenantKind` are unchanged.
- **A module is bound to its ladder for life.** `subscription_modules.audience` is derived from the plan on INSERT and immutable after; DB triggers refuse a cross-ladder `plan_id` or `pending_plan_id`. A fallback plan can never be a module — **absence of a module IS the free plan** for that ladder.
- **Tenant kind selects the module** (band tenant → band module, personal → artist module), entirely inside `resolveOwnerEntitlements`/`resolveTenantEntitlements`.
- Everything genuinely per-audience lives on the **module row**, not the subscription: `entitlement_overrides`, `pending_purge_manifest`, `pending_limits_snapshot`, the pending plan change. This is load-bearing — an artist downgrade's `bands: 0` snapshot must never zero the owner's band cap.
- `subscription_modules.status` is the discriminator for what a module grants **right now**: `pending` (bought, charge not settled — grants nothing, but its target capacity already binds), `active`, `pending_removal` (still grants; the customer paid for this period).
- Anything band-scoped reads the **band** module: `enforceBandCap` ignores an artist plan's vestigial `bands: 0`. Blockers and purges are scoped to `tenantKindsForAudience(…)`.
- A sideman on an artist module still plays in someone else's gold band — a band's entitlements come from its *owner's* band module.

## Plans & entitlements

- **`shared/entitlements.js` is the single source of truth** (server re-export: `server/auth/entitlements.js`; frontend mirror `src/auth/entitlements.ts`). Features: `finance`, `integrations`, `customization`, `song_files`, `chordpro`, `public_promotion`, `linkpage`, `custom_slug`, `calendar_sync`. Limits: `storage_mb`, `members`, `bands`, `linkpage_pages`, `linkpage_stats_days` — **`null` = unlimited**. Plans store *complete* entitlement objects (`validateEntitlements`); `mergeEntitlements` overlays per-module `entitlement_overrides`.
- Plan catalog: `subscription_plans` (migration `100`), defaults seeded from `server/db/defaultPlans.js` **and** the migration SQL — keep both in sync. Bronze/artist_bronze are `is_fallback` (free, always active, undeletable). **`is_trial_tier`** (migration `181`, one per audience) names the plan the free trial grants — resolved by flag and **never by slug**, because slugs are admin-editable and have drifted in the field.
- Price semantics: `NULL` = interval unavailable, `0` = free-fallback only, `>0` = paid. Super-admin CRUD at `/admin/plans`; a plan's `audience` is create-only.
- Tier logos `public/icons/gb_{bronze,silver,gold}.png` are keyed **by plan slug** via `src/commerce/billing/planLogo.ts`.

## Pricing rules & price snapshots

- **`shared/pricing.js` is the pricing engine** — pure, shared by server and frontend, so a quote shown to a customer and the amount charged cannot drift. `computePriceSnapshot`, `computeProrationCents`, `validatePriceSnapshot`, `priceForInterval`. Typed frontend wrapper: `src/commerce/billing/pricing.ts`.
- `pricing_rules` (migration `180`): percentage (`NUMERIC(5,2)`) or fixed (`amount_cents`), `combinable`, `is_active`, half-open `[effective_from, effective_to)`, `required_audiences`, `min_module_count`, `billing_intervals`, `priority`.
- **Selection is deterministic**: candidates sorted by `priority, code`; the first always applies, each later one only if **it and every applied rule** are `combinable`. **Every discount is computed against the ORIGINAL subtotal**, never a running total, so amounts are order-independent.
- **Terms are NEVER edited in place.** A snapshot pins `{ code, version }`, so `pricingRuleService` supersedes instead: deactivate the live version, insert `version + 1` (versions count up from the highest EVER used). Only `name` is editable. Super-admin CRUD at `/admin/pricing-rules` (`POST /:id/versions`).
- A subscription carries three snapshots, each with a distinct job: `price_snapshot`/`total_cents` (what the CURRENT period was charged), `next_price_snapshot`/`next_total_cents` (what the next renewal charges, and the durable mirror of the provider schedule's amount), `pending_price_snapshot`/`pending_total_cents` (a mid-cycle change awaiting its prorated charge). `subscription_payments.price_snapshot` records what each individual charge billed.

## Ownership: subscriptions are user-level, tenants inherit

- A subscription belongs to a **user**. A tenant's entitlements come from `tenants.owner_user_id`. **`owner_user_id IS NULL` (legacy tenant) skips enforcement entirely.** Deliberately no backfill.
- Self-service tenant creation (`tenantSelfService.js`): the creator becomes owner + `tenant_admin`. The **bands limit** caps *active owned* tenants under a `FOR UPDATE` user-row lock in the same transaction as insert/unarchive.

## Resolution & gating

- `entitlementService.resolveTenantEntitlements` **enforces all time bounds itself on read** — trial end + 2d grace, period end + 2d grace (+7d max while a renewal charge is nonterminal at Mollie/SEPA), past_due + 14d. The scheduler only repairs durable status; **access never depends on it running**. Locked = fall back to that ladder's fallback plan (fallback-lock; data is never deleted on lapse). `financeReadOnly` = plan lacks finance but the tenant has finance data.
- Server gates (`server/middleware/entitlements.js`): `requireEntitlement(feature)` → 403 `{ code: 'entitlement_required', feature }`; `requireEntitlementForWrites(FEATURES.FINANCE)` is finance read-only mode (GET/HEAD/OPTIONS pass). Credential GET+DELETE stay ungated.
- Numeric caps go through `limitService.enforceMemberCap/enforceBandCap` — **must run inside the caller's transaction**; 409 `{ code, limit }`. Storage is reservation-based (`storageService.uploadObjectWithQuota` → 413).
- Frontend: `/auth/me` carries `entitlements`; `useEntitlements()` mirrors `usePermissions`; `RequireEntitlement` is the route guard. **Tier-locked nav items stay visible** with a `DiamondOutlined` icon linking to `/upgrade/:feature`. All presentation — the API gate is the defense.

## Lifecycle

- **Provider port**: `server/commerce/billing/paymentProvider/` — code imports `getPaymentProvider()` from `providerFactory.js`, never a concrete adapter, and speaks **canonical statuses only** (`statuses.js`, including `REFUND_STATUS`). Tests inject `src/tests/server/_fakeProvider.js`, which throws a **real `ProviderError`** so `retryable: false` is actually exercised. Adapters must pass the reusable `providerContractTests.js` suite.
- **Trial** — 30 days, **once per USER** (`hasUsedTrial(db, userId)`), **Gold only**, one starter module. Starting it requires **no mandate, provider object or payment**. A second module added during the trial is free and does **not** extend it. A trial that lapses is cancelled by `reconcileExpiredTrials`; the canceled row is what keeps the trial spent.
- **Trial continuation** — the canonical behavior and rationale live in [ADR 001](../../../docs/architecture-decisions/001-trial-mandate-verification.md). Implementation entry points are `checkout`, `createMandateVerificationCheckout`, `applyPaymentOutcome` and `repairSchedule`; keep them consistent with that decision.
- **Direct paid signup** — for a user whose trial is already spent, `subscribe` creates `pending_activation` and `createConversionCheckout` immediately takes one full combined `sequenceType: first` payment that both opens the first paid period and establishes the mandate.
- **Mid-cycle add/upgrade** — activate-first: durable pending state, then an on-demand charge for the **prorated positive difference**, and on paid the module lands while **`current_period_end` is deliberately preserved**. A bundle discount can make the larger configuration cheaper; then nothing is owed and it applies immediately. Routing to the purge flow stays **entitlement-shaped** (`isDowngrade`), never price-shaped.
- **Renewal** — the schedule charges `next_total_cents`; ingestion advances the period, installs the next snapshot, re-anchors the refund window, and applies any module change scheduled for the boundary.
- **Re-pricing** — `reconcileNextPeriodPricing` keeps `next_total_cents` in step with the live rule catalog and flags the schedule stale only when the amount actually moved. This is what makes a *temporary* discount temporary.
- **Renewal notices** — T-7 and T-1, one type with two dedupe keys carrying the period end. The sweep window is wide and the tick is 15 minutes, so the copy is **date- and amount-based, never "in 7 days"**.
- **Local state first, remote second, never a provider call inside a DB transaction.** Every remote mutation goes through `billingSaga.js` and the `billing_operations` outbox with a deterministic key claimed *before* the call. The proration key **includes the amount** — without it two differently-priced charges collide and the second is silently skipped.
- **Ingestion is one funnel**: webhook (`/api/public/billing/mollie/webhook` — always 200, posted id is a routing hint, status re-fetched, customer verified) and the reconcile poll both call `ingestProviderPayment` → `applyPaymentOutcome` under the subscription row lock. The transition predicate lives **in SQL** (`billing_payment_transition_allowed`, migration `104`).
- **Cancel** — paid period → `cancel_at_period_end`, no refund. Resume clears it. Complimentary subscriptions carry no provider objects and block self-management.

## Downgrade, removal & purge

Informed consent first, **no data loss before the target plan is real**.

- `POST /api/billing/downgrade` takes `{ audience, planId | remove: true, confirmation }`. Type-to-confirm (`downgrade to <slug>` / `remove <audience>`), validated server-side. The confirm transaction freezes a **purge manifest** and a **limits snapshot** on the MODULE row; the snapshot binds capacity growth immediately via the resolver.
- **Blockers** (`computeModuleBlockers`) check member/storage limits against **ALL owned tenants of that kind, archived included**; only the **band cap** counts active tenants. Re-run under the exact lock set every capacity-growing write takes → 409 `over_target_limit`.
- **The change lands at the period boundary**, where the already-repaired schedule charges the lower amount; the purge runs when that renewal is authoritatively **paid**. A failed renewal is `past_due` with **nothing purged**. A trial change is immediate, and so is its purge.
- **The downgrade REPLACEMENT SAGA IS GONE.** With one shared cycle a downgrade is a scheduled change to the same subscription's amount, which is what `repairSchedule` already does. `scheduleDowngradeReplacement`, `superseded_mollie_subscription_id`, `downgrade_schedule_pending`, the replacement-recognition metadata hint and `finalizeFailedDowngrade` no longer exist — do not reintroduce them.
- **`executeModulePurge(db, { moduleId } | { subscriptionId, audience, manifest })`** is idempotent and self-serializing (per-module session advisory lock). Scope is **recovery-safe**: only manifest features still off on the *current* effective entitlements are purged — an admin plan edit after confirmation can only SHRINK the purge. Covers **ALL owned tenants of that kind including archived**. Finance is never purgeable. The integrations purge deletes credentials except the tenant Mollie key with paid payment links (retained encrypted, readable only via `loadRetainedIntegrationCredential`).

## Refunds

- **Withdrawal window**: within `REFUND_WINDOW_DAYS = 5` of the charge that **opened the current period** (`last_charge_at`), `POST /api/billing/cancel { immediate: true }` ends access immediately and refunds that charge **in full**. Outside the window it is a 409 `refund_window_closed` — the server never silently falls back to a period-end cancel. **Nothing is purged**: a cancellation is a lapse.
- **Super-admin partial refunds**: `POST /api/admin/subscriptions/:id/refunds`. The "total refunded ≤ payment amount" rule is a SUM, enforced in the service under a `FOR UPDATE` lock on the payment row. A **failed** refund never moved money and must not consume the refundable balance.
- The local `subscription_refunds` row is the durable **intent**, committed before the provider call; the outbox makes the retry safe.
- **`canceled` is terminal**: `setStatusGuarded` refuses to flip a canceled subscription, which is what stops a post-cancellation refund (Mollie reports it as `paid → refunded` on the ORIGINAL payment) from reviving the row as `past_due`.

## Reference tests

`src/tests/server/`: `pricingRules.test.js` (engine + catalog + versioning), `subscriptionModules.test.js` (trial mechanics, proration arithmetic asserted against the shared function, module triggers), `billingLifecycle.test.js` (trial → mandate verification → scheduled activation → mid-cycle change → renewal), `billingRefunds.test.js` (window boundary, over-refund guard, canceled-terminal), `billingScheduler.test.js` (all reconcile tasks incl. renewal notices and re-pricing), `downgradePurge.test.js` (boundary landing, purge scope, recovery-safe shrink), `planAudiences.test.js` (module/ladder independence + DB backstops), `entitlements.test.js`, `entitlementGates.test.js`, `adminBilling.test.js`, `storageQuota.test.js`, `memberBandCaps.test.js`, `tenantSelfCreate.test.js`. Fakes: `_fakeProvider.js`, `_billing.js` (`createSubscription({ modules: […] })`).

Frontend: `src/commerce/billing/__tests__/` (`pricing`, `planLadder`, `SubscriptionSummaryCard`, `SubscriptionsPage`, `PlanCatalogSection`), `src/admin/pricing/__tests__/PricingRulesSection.test.jsx`, `src/people/workspaces/__tests__/BillingSettingsSection.test.jsx`, `src/app/__tests__/DowngradeDialog.test.jsx`.
