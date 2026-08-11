# Personal/band tenant architecture review

Date: 2026-08-11  
Branch: `feat/tenant-kind-personal` at `7317d74`  
Comparison base: merge-base with `main`, `61e1b317`  

## Scope and method

This is a static architecture review of the committed `main...HEAD` change set, with emphasis on the personal/band tenant model, centralized policy, tenant isolation, duplicated or unused code, simplicity, and SOLID principles. The branch contains 591 changed files and also carries unrelated Resend, places, router, and lint work; those changes were not reviewed unless they intersect tenant-kind behavior.

The working tree contained unrelated uncommitted changes when this review was written. They were deliberately excluded from the review boundary and were not modified. No runtime suite was used as evidence: the relevant server and frontend tests were inspected, but running them against the dirty tree would not test the committed branch in isolation.

Severity means:

- **High**: an invariant can be broken or product/data authorization can become inconsistent.
- **Medium**: a policy is incomplete, a rollout is unsafe under plausible conditions, or the design has substantial change-amplification.
- **Low**: maintainability debt or confirmed branch archaeology with limited immediate impact.

## Executive assessment

The core direction is sound. Modelling a personal workspace as an ordinary tenant preserves the most valuable existing property: shared route/service/repository stacks and tenant-scoped tables remain the default. The capability registry, member-derived `/api/me` scope, composite foreign keys for `my_band_id`, per-audience subscription mapping, and user-level availability projection are all good architectural choices.

The branch is not ready to merge unchanged, however. Two existing global-admin paths bypass invariants that the new model now depends on, and the `display_name` expansion is not safe while the previous container is still serving. The capability registry also overstates how authoritative it is: two declared capabilities have no backend enforcement and one advertised band-only action remains visible in a personal workspace.

Recommended disposition: fix findings 1–4 before merge; resolve or explicitly accept finding 5 before deployment; address findings 6–9 as focused cleanup rather than a broad rewrite.

## Findings

### 1. High — generic owner assignment can split a personal workspace from its sole member

Evidence:

- [`159_tenant_kind.sql`](../server/db/migrations/159_tenant_kind.sql) adds a partial unique index for one personal tenant per owner, but does not require a personal tenant to have an owner.
- `patchTenant()` in [`tenantService.js`](../server/services/tenantService.js) accepts any existing `owner_user_id`, including `null`, for every tenant kind.
- `updateTenantFields()` in [`tenantRepository.js`](../server/repositories/tenantRepository.js) changes only the tenant row. It does not update or validate the personal workspace's membership.
- `listApprovedMemberTenants()` includes a personal tenant only when `owner_user_id` equals the caller, while `resolveTenantId()` authorizes the active tenant by approved membership alone.
- `resolveTenantEntitlements()` derives the product from the current owner and skips tenant-side enforcement entirely when the owner is `null`.
- [`TenantsPage.tsx`](../src/pages/admin/TenantsPage.tsx) exposes “Assign owner” for every row and does not distinguish personal workspaces.

Impact:

1. Reassigning a personal tenant leaves the old owner as its only approved member, while the new owner has no membership.
2. The old owner can still activate and use the workspace through `resolveTenantId()`, but their personal rows disappear from the `/api/me` scope because that scope checks ownership.
3. Entitlements immediately switch to the new owner's artist subscription even though that user cannot enter the workspace.
4. Detaching the owner sets it to `null`, which makes `resolveTenantEntitlements()` bypass enforcement for the personal tenant.

This breaks the stated “one owner, one approved membership, same person” invariant and makes authorization, hub visibility, and billing disagree.

Recommendation:

- Reject generic owner changes for `kind = 'personal'`.
- Add a database check: `kind <> 'personal' OR owner_user_id IS NOT NULL`.
- If personal-workspace transfer is a real requirement, implement it as a dedicated transaction that locks the tenant and both user rows, replaces the membership/admin relationship, updates ownership, and invalidates affected sessions. Do not express it as a generic field patch.
- As defense in depth, make active-personal-tenant resolution require the approved member to be the owner.
- Hide owner/member actions for personal rows in the admin UI.
- Add tests for detach, reassignment, active-tenant resolution after reassignment, and entitlement selection.

### 2. High — the legacy admin-demotion endpoint can remove the final tenant admin

Evidence:

- `removeAdmin()` in [`tenantService.js`](../server/services/tenantService.js) calls `demoteAdminToContributor()` directly, without a transaction, tenant-row lock, or `assertTenantAdminRemains()`.
- The path is exposed by `DELETE /api/admin/tenants/:id/admins/:userId` in [`tenants.js`](../server/routes/tenants.js).
- Other removal/demotion paths centralize the check in [`userService.js`](../server/services/userService.js), but that guard is private to that service and therefore easy to bypass.
- [`lastTenantAdmin.test.js`](../src/tests/server/lastTenantAdmin.test.js) covers `/api/users` and self-leave, not the legacy `/api/admin/tenants/.../admins/...` path. [`admin.test.js`](../src/tests/server/admin.test.js) exercises demotion only while another admin remains.

Impact:

A super admin can demote the sole `tenant_admin`. For a personal workspace this demotes its only member and owner, leaving no administrator at all. It directly contradicts the repository's documented invariant that every tenant retains an approved admin, including when a super admin acts.

Recommendation:

- Remove the duplicate demotion implementation or route it through one exported membership transition service.
- That service should own the tenant lock, last-admin assertion, role mutation, and audit result for every entry point.
- Add a regression test using the exact global-admin endpoint against both a band and a personal workspace.

### 3. High — `display_name` dual writing is not safe during an expand/migrate/contract rollout

Evidence:

- [`159_tenant_kind.sql`](../server/db/migrations/159_tenant_kind.sql) adds nullable `display_name` and backfills it once.
- Synchronization exists only in `tenantRepository.insertTenant()` and `updateTenantFields()`.
- The migration runs while the previous app container still serves. That container knows only `band_name`, so a rename after the backfill can leave `display_name` stale.
- New cross-tenant labeling reads `display_name` directly in `listApprovedMemberTenants()` and user-availability projections.
- The branch still has many reads of both names, including auth payloads, profile context, invoice rendering, billing blockers, notifications, calendar feeds, and the admin UI. The alias is therefore a live consistency boundary, not a cosmetic compatibility field.

Impact:

During deployment, the same tenant can have two different names depending on which endpoint rendered it. A raw SQL writer, maintenance script, old container, or missed future repository can cause the same permanent divergence. Calling `tenantRepository` the “single writer” does not enforce that property.

Recommendation:

- During the expansion phase, install a database trigger that mirrors changes in either column, with a documented conflict rule if both are changed.
- Make `display_name` non-null after backfill and validation.
- Move all new reads to the canonical field, retaining compatibility shaping at a narrow API boundary only.
- Remove the trigger and `band_name` in a later contract deployment after old code can no longer write it.
- Add an upgrade/compatibility test that simulates an old-code `UPDATE tenants SET band_name = ...` after migration 159.

### 4. Medium — the capability registry is not consistently authoritative

The registry in [`tenantCapabilities.js`](../shared/tenantCapabilities.js) is a good single source for applicability, and most full routers/fields are correctly gated in [`routes/index.js`](../server/routes/index.js). Two entries do not match the documented contract:

- `BAND_SHARE` is referenced only by the frontend. This can be valid for client-side image generation, but it means this registry entry is not an authoritative API policy. In [`GigsPage.tsx`](../src/pages/GigsPage.tsx), tour-card and mosaic actions use `hasBandShare`, while the tour-export menu is outside that condition even though [`tenant-kind-architecture.md`](tenant-kind-architecture.md) says tour export belongs to `band_share`. `/api/share/photos` is also shared by both the tour dialog and the ordinary gig-share dialog, so its ungated mount cannot be classified correctly from the capability name alone.
- `ARTIST_CALENDAR` is referenced only by the frontend. The entire `/api/me/*` tier is available to any current-terms user and has no personal-workspace precondition.

`/api/me` may intentionally be a user-level capability that works regardless of the active tenant. If so, `ARTIST_CALENDAR` is an experience-selection flag, not an authoritative tenant capability. Keeping both meanings in one registry makes reviewers and future code assume a backend guarantee that does not exist.

The super-admin tenant UI is another drift point: it offers add-member, switch, and assign-owner actions for personal rows even though the backend refuses or cannot fulfill some of them.

Recommendation:

- Decide whether every registry entry is enforceable at a tenant API boundary. Encode that distinction instead of relying on comments.
- Decide explicitly whether share photos are a shared primitive used by both sharing experiences or band-only tour data. Keep the shared endpoint ungated in the former case; introduce a distinct capability-gated resource in the latter. Do not gate the existing router blindly while `GigShareDialog` also consumes it.
- Put tour export inside the same frontend capability condition if it is genuinely band-only.
- Either document `/api/me` as user-level and remove `ARTIST_CALENDAR` from the authoritative tenant registry, or add the intended personal-workspace ownership precondition.
- Add a table-driven test that, for each tenant-bound capability, proves a supported kind succeeds and an unsupported kind receives `tenant_kind_not_supported` on the actual backend surface.

### 5. Medium — migration 166 knowingly violates the repository's rolling-deploy rule

[`166_plan_audience.sql`](../server/db/migrations/166_plan_audience.sql) creates the artist fallback and switches fallback/subscription uniqueness from global to per-audience in one migration. Its comment acknowledges that the old container can perform an audience-blind fallback query during the deployment window and may select the artist fallback for a band tenant.

The exception is justified by “no user holds a live paid subscription,” but that assumption is not enforced by the migration or a required preflight. It can become false between authoring and deployment. It also conflicts with the explicit project rule that migrations run beside the previous container and must follow expand → migrate → contract.

Recommendation:

- Prefer a staged rollout: add nullable/defaulted audience data and compatible indexes first; deploy audience-aware readers/writers; then add the second fallback and relax uniqueness in a later deployment.
- If the one-shot migration is retained, add a hard preflight for the exact business assumption and make the temporary loss-of-feature behavior an explicit release decision, not only a SQL comment.
- Add an old-reader compatibility test around fallback selection.

### 6. Medium — planning-source selection is only partly centralized

[`usePagedEventTabs.ts`](../src/hooks/usePagedEventTabs.ts) successfully centralizes active-tenant versus `/api/me` selection for upcoming/past lists. The same decision is still repeated elsewhere:

- gig search in [`GigsPage.tsx`](../src/pages/GigsPage.tsx);
- gig detail source selection in [`GigDetailPage.tsx`](../src/pages/GigDetailPage.tsx);
- detail fetch, refresh, roster loading, and allowed self-actions in [`RehearsalDetailPage.tsx`](../src/pages/RehearsalDetailPage.tsx) and [`BandEventDetailPage.tsx`](../src/pages/BandEventDetailPage.tsx);
- a larger set of read/write branches in [`TasksPage.tsx`](../src/pages/TasksPage.tsx).

This is already producing inconsistent assumptions. `GigDetailContent` always loads the active tenant's profile banner before it knows whether the displayed gig came from another tenant, so a foreign-band gig opened from the personal hub can be framed by the personal workspace's banner.

This is an Open/Closed Principle issue: adding another planning aggregate or changing source rules requires editing each page instead of extending one policy boundary.

Recommendation:

- Introduce a small planning-source adapter/hook that exposes the correct list/search/detail fetchers plus source traits such as `labelsTenant`, `canLoadRoster`, and `canWriteOrdinaryEndpoint`.
- Keep `useCrossTenantRow()` as the single row-writability calculation.
- Do not build a generic data framework; extract only the repeated active-vs-hub decision and source identity behavior.
- Suppress or source the correct tenant banner for foreign rows.

### 7. Medium — `meService` is becoming a cross-aggregate god service

[`meService.js`](../server/services/meService.js) is 323 lines and coordinates gigs, rehearsals, band events, tasks, agenda shaping, pagination validation, per-tenant enrichment, detail redaction, and two write proxies. It imports repositories and services from all four aggregates.

The centralized member-derived scope is correct; the centralized feature implementation is the concern. This service now has many reasons to change and couples otherwise independent planning aggregates. It also leaves each aggregate with parallel tenant-scoped and member-tenant repository methods whose projections/order rules can drift.

Recommendation:

- Keep `resolveMemberTenantIds()` and `memberTenantScope()` centralized.
- Split hub application logic by owning aggregate (`meGigService`, `meRehearsalService`, `meBandEventService`, `meTaskService`) and keep a very small agenda composer.
- Retain cross-tenant SQL in each aggregate's repository; do not create a hub repository.
- Reuse projections, ordering fragments, cursor builders, and `memberEventScopeSql`, but avoid a highly generic SQL builder that would obscure tenant scoping. The current explicit parallel queries are safer than an over-abstracted repository API; only identical fragments should be shared.

### 8. Low — abandoned branch concepts and confirmed unused exports remain

Confirmed branch archaeology:

- [`162_external_ensembles.sql`](../server/db/migrations/162_external_ensembles.sql) adds the ensemble-contact model and [`167_drop_external_ensembles.sql`](../server/db/migrations/167_drop_external_ensembles.sql) removes it in the same unmerged branch.
- [`contacts.test.js`](../src/tests/server/contacts.test.js) adds tests explaining that the abandoned value is invalid; this tests generic invalid-category behavior using historical terminology rather than current behavior.
- `legacyPlanAudience()` in [`defaultPlans.js`](../server/db/defaultPlans.js) has no consumer.
- `isKnownTenantKind()` in [`businessRegistry.js`](../shared/businessRegistry.js) has no consumer.
- The frontend re-exports `TENANT_CAPABILITY_KEYS` and wraps `tenantKindsForAudience()` without a frontend consumer.

Recommendation:

- If migrations 162/167 have never been applied outside disposable branch databases, remove both and erase the abandoned concept from current documentation/tests before merge. Keep only a design-decision note if the rationale is valuable.
- If they have been applied to a persistent shared environment, keep the migration history but label it as deployed history; do not pretend it is removable.
- Delete the unused helpers/re-exports or add the real validation call site they were intended to serve.

### 9. Low — tenant-kind definitions are placed in an unrelated registry module

[`businessRegistry.js`](../shared/businessRegistry.js) owns country-specific commercial-register formats, legal forms, and now tenant kinds. The frontend wrapper duplicates the `TenantKind` union and default literal. This weakens Single Responsibility and makes the apparent source of truth less obvious.

Recommendation:

- Move tenant kinds/default/validation to a focused `shared/tenantKinds.js` with the typed frontend wrapper beside the other auth/domain adapters.
- Keep commercial registration and legal-form concerns in `businessRegistry.js`.
- Use the runtime validator at external/admin boundaries, or remove it if every boundary is already closed over known constants.

## What is working well

Several architectural decisions should be preserved during fixes:

- **Shared-by-default tenant model.** Personal workspaces reuse planning, finance, contacts, storage, permissions, and isolation instead of creating parallel stacks. This is the strongest SOLID property in the branch: personal tenants remain substitutable for shared domains.
- **Separate policy axes.** Permissions, subscription entitlements, and tenant applicability answer different questions and are generally enforced independently.
- **Server-derived cross-tenant scope.** `resolveMemberTenantIds()` derives IDs from approved memberships, never accepts a client-supplied tenant set, and deliberately does not set `req.tenantId`.
- **No hub repository.** Cross-tenant queries remain with the aggregate that owns the data.
- **Database isolation backstops.** Composite foreign keys for `my_band_id`, participants, and tenant-owned resources are well considered.
- **Read-only foreign-row policy.** `useCrossTenantRow()` centralizes the key frontend rule, including the subtle “unknown while loading is not writable” state.
- **Audience mapping fails closed.** `audienceForTenantKind()` throws for unknown kinds instead of silently assigning band entitlements.
- **Personal creation serialization.** The user-row lock plus unique index is a good concurrency design for idempotent creation.
- **Availability ownership.** Moving linked-user availability above the tenant and redacting it in a server-side projection is conceptually clean and avoids frontend secrecy rules.
- **Global band-profile identity.** Avoiding shell tenants and private per-artist ensemble contacts is the simpler domain model. The documented lock order and claim-shaping boundary show good attention to deletion and disclosure hazards.

## SOLID summary

| Principle | Assessment |
|---|---|
| Single Responsibility | Mixed. Capability, plan-audience, row-writability, and member-scope primitives are focused; `meService` and `businessRegistry` are not. |
| Open/Closed | Good for adding a tenant-bound capability; weaker for planning-source behavior because page-level `isPersonal` branches remain. |
| Liskov Substitution | Strong for shared tenant domains. Personal workspaces behave as tenants except at explicit capability boundaries. Generic owner/admin operations currently violate the personal subtype's stronger invariants. |
| Interface Segregation | Strong separation of permission, entitlement, and tenant applicability. The registry should distinguish tenant-bound capabilities from user-level experience selection. |
| Dependency Inversion | Generally good through services/repositories and injected executors. Middleware still owns a membership SQL query, and `meService` depends on many concrete aggregate modules. |

## Prioritized remediation plan

1. Centralize all membership role/status transitions and route the legacy admin demotion through the last-admin guard.
2. Make personal ownership immutable through the generic patch path; add the non-null owner constraint and owner-membership defense.
3. Make the name expansion deployment-safe with a DB synchronization trigger and a clear contract migration.
4. Reconcile `BAND_SHARE` and `ARTIST_CALENDAR` with the capability registry's claimed semantics; fix the personal/admin UI affordances.
5. Rework or explicitly preflight the one-shot plan-audience rollout.
6. Extract a small frontend planning-source policy and split `meService` by aggregate without centralizing SQL into a hub repository.
7. Remove abandoned migrations and unused exports where deployment history permits.

## Suggested regression matrix

At minimum, add the following cases before merge:

| Area | Required case |
|---|---|
| Personal ownership | Admin detach and reassignment are rejected, or a dedicated transfer atomically changes owner and sole admin membership. |
| Active tenant | A non-owner membership can never activate a personal tenant, even if bad data exists. |
| Entitlements | A personal tenant can never reach the ownerless enforcement bypass. |
| Last admin | `DELETE /api/admin/tenants/:id/admins/:userId` refuses the sole admin for both tenant kinds. |
| Name rollout | An old-style `band_name` update after migration remains visible through every `display_name` reader. |
| Capability parity | Every tenant-bound capability has one supported-kind and one unsupported-kind backend test. |
| Share surface | Shared photo storage and band-only tour actions follow the chosen policy; personal workspaces do not see actions documented as band-only. |
| Hub semantics | Tests state explicitly whether a user without a personal workspace may call `/api/me/*`. |
| Admin UI | Personal rows do not offer add-member, arbitrary owner assignment, or unusable tenant-switch actions. |
| Rolling deploy | Old audience-blind fallback resolution cannot select the artist fallback for a band tenant. |
