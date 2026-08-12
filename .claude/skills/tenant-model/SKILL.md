---
name: tenant-model
description: Tenant kinds (band vs personal workspace), the capability registry, the cross-tenant hub at /api/me/*, and global band profiles / my_bands. Use when adding kind-specific behavior or a new capability, touching /api/me/* or req.memberTenants or resolveMemberTenantIds, working on band profiles, claims, band discovery, join requests or my_bands, or deciding which feed a planning page reads (usePlanningSource / usePagedEventTabs / cross-tenant row writability).
user-invocable: false
---

# Tenant kinds, the cross-tenant hub, and global band profiles

`docs/tenant-kind-architecture.md` is the reference — **read it before adding
kind-specific behavior**. This file is the invariant set and the entry points; the doc has
the full model, the capability registry walkthrough, and the extension checklist.

CLAUDE.md keeps the isolation invariant itself (every tenant-owned read/write scoped by
`req.tenantId`, cross-tenant returns 404 not 403). Everything below is what sits *around*
or *outside* that scope.

## Tenant kinds

`tenants.kind` is `band` or `personal`. A personal workspace is an ordinary tenant — same
routes, services, repositories, tables, permissions and isolation — that happens to have
one member. Profile, planning, contacts, finance and files are identical for both kinds and
are absent from the capability registry. What differs is the ends of the range: band-shaped
concepts (roster, membership admin, band availability, setlists, merch, discovery,
promotion integrations, share, link page) are band-only, while the artist calendar and the
"bands I'm in" settings section are personal-only. **Shared is the default** — never fork a
domain into band/personal implementations just for wording or visibility.

- Genuine differences are named capabilities in `shared/tenantCapabilities.js`. Prefer
  capability checks over scattered `kind === …` comparisons.
- Backend is authoritative: `requireTenantCapability`,
  `requireTenantCapabilityForBodyFields`, `requireTenantCapabilityWhen`
  (`server/middleware/tenant.js`). The field/predicate variants keep a shared endpoint
  shared when only one subtype is kind-specific. Frontend `useTenantKind().supports(…)` /
  `RequireTenantCapability` are UX only.
- A personal tenant is unique per owner and does not consume the `bands` limit — only
  active owned `band` tenants count.
- `tenants.display_name` is the kind-neutral name; `band_name` is a synced alias with
  `tenantRepository` as the single writer. Prefer kind-neutral vocabulary.
- Tenant kind also selects the subscription ladder — see the **subscription-billing** skill.

**Joining a band** is user-level, so it works from any active tenant. `/invites/redeem`
takes a code (`loadUser` only, no tenant). `/band-directory` only sees bands with
`tenants.join_policy = 'request'`: role is fixed server-side, a non-discoverable target
404s, a `rejected` membership stays rejected, and `enforceJoinRequestCap`
(`server/domain/membership.js`) caps outstanding requests under the user-row lock — no plan
lifts that cap, so it sits outside the `*_limit_reached` family. Every `memberships.source`
insert site names its own value (no SQL default).

## The cross-tenant hub (`/api/me/*`)

1. `resolveMemberTenantIds` — a *sibling* of `resolveTenantId` that **never sets
   `req.tenantId`** — derives the tenant set from the caller's approved, non-archived
   memberships and builds `req.memberTenants` once per request via `memberTenantScope`
   (`server/domain/memberTenants.js`).
2. That scope's `ids` is the only tenant set anything downstream can reach, so **the client
   never names the tenants it wants** — a tenant id in a body or query changes nothing, and
   a tenant the caller can't see is simply *absent* rather than blanked.
3. Queries are `…ForMemberTenants` variants in the owning aggregate's repository (there is
   no hub repository), taking that id list and returning rows interleaved across tenants.
4. Rows are labeled from the same scope (`ref`/`label` supply the band name and avatar), so
   no query joins `tenants` just to render one, and an id outside the scope blanks rather
   than invents a name. Per-tenant enrichment (participants, availability) groups the rows
   by tenant first, because those queries remain tenant-scoped.
5. **The hub is read-only.** Anything that writes goes through the ordinary tenant-scoped
   route with an active tenant. (The narrow exceptions are actions that belong to the
   caller alone: the caller's own rehearsal vote, and the done state of a task assigned to
   them.)

Entry points: `server/planning/agenda/meService.js`, `src/planning/shared/`.

## Global band profiles

One shared row per band that is not a gigbuddy customer, so every musician who plays in it
finds the same record. Four rules are load-bearing:

- **Claim state is derived, never stored.** `band_profiles.claimed_by_tenant_id` plus the
  claim rows are the only facts, so deleting a band tenant releases its profile through the
  foreign keys alone.
- **A profile is self-cleaning** — it lives only while somebody holds it or a claim is live
  — but **a FK cascade runs no service code**, so `deleteTenant` and claim approval both
  collect, lock and sweep the affected profiles inside their own transaction.
- **Lock order is global: `tenants` → `band_profiles` (ascending id) → claims / `my_bands` /
  event rows.** Tenant deletion already holds the tenant row and then cascades into the
  others; taking the profile first deadlocks against it.
- **The claiming band's tenant id leaves the server only when that band is discoverable** —
  it is the input to the join-request and avatar endpoints. `shapeBandProfile` is the single
  exit for a profile payload.

The tenant-owned half is `my_bands` (a personal workspace's collection) and the `my_band_id`
column on gigs, rehearsals and band events, all scoped and composite-FK'd like any other
resource.

Entry points: `server/people/band-profiles/bandProfileService.js`,
`server/people/my-bands/myBandService.js`.

## Frontend: which feed a planning page reads

- **Decided by tenant kind, not by the page**: a band workspace reads the active-tenant
  endpoints, a personal workspace reads the cross-tenant hub, and the same list renders
  both. `usePlanningSource(aggregate)` owns that split for every planning read — it hands
  back the resolved fetchers plus the traits that follow from the source (`labelsTenant`,
  `canLoadRoster`, `canWriteOrdinaryEndpoint`), so pages branch on traits, never on
  `isPersonal`. Paging, "load more" and deep-link resolution sit on top of it in
  `usePagedEventTabs` (which names an aggregate, not fetchers) — a new list goes through
  them, not around them.
- **A row's writability follows the tenant it came from.** Hub rows carry a tenant label;
  active-tenant rows don't, so an unlabeled row is the current tenant's and a labeled
  foreign one is read-only whatever the viewer's role says. A row that hasn't loaded is
  *unknown*: not flagged as foreign, but not writable either. `useCrossTenantRow` (and its
  plain `isCrossTenantRow` form, for list rows) is the only place that decides this. UX only
  — the backend still 404s outside `req.tenantId`.

## Tests

Both kinds must be covered. Backend tests assert the structured 403 for authenticated
active-tenant capability failures, and 404 where a public or cross-tenant lookup must not
disclose existence.
