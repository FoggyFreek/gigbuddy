# Tenant-kind architecture

Gigbuddy has two tenant kinds:

- `band`: a workspace for a band and its members.
- `personal`: one musician's artist workspace.

Both kinds use the same tenant model, tenant isolation, route/service/repository
layers, permissions, storage, and domain tables. Tenant kind controls only the
parts of the product whose meaning is specific to a band or to an individual
artist.

## Core model

`tenants.kind` is constrained to `band` or `personal`. The shared definitions
live in `shared/businessRegistry.js`; `src/utils/businessRegistry.ts` provides
the typed frontend view.

A personal workspace is a tenant with these additional invariants:

- It has one owner and one approved membership. The owner is its
  `tenant_admin`; invite, membership-grant, and roster-management paths do not
  apply.
- Each user owns at most one personal workspace. The partial unique index on
  `tenants.owner_user_id` enforces this at the database boundary.
- Its accounting profile is created with the `sole_trader` legal form.
- It has its own profile, planning data, contacts, files, finance records,
  achievements, subscription entitlements, and storage limits.
- It does not count toward the owner's active-band limit.

`tenants.display_name` is the kind-neutral tenant name. `band_name` contains the
same value, and `server/repositories/tenantRepository.js` is the single writer
that keeps both columns synchronized. New internal vocabulary should use
tenant, workspace, and display name unless the concept is specifically a band.

## Shared domains are the default

Profile, gigs, rehearsals, band events, tasks, contacts, venues, songs, files,
email templates, finance, accounting, calendar feeds, and tenant-scoped storage
apply to both kinds. They use the same tables and the same backend stacks.

Do not create parallel band and personal routes, services, repositories, pages,
or tables for a shared domain. A kind-specific field or subtype stays on the
shared endpoint and receives a focused capability gate.

## Capability registry

`shared/tenantCapabilities.js` is the source of truth for feature
applicability. The backend imports it directly. The frontend consumes the same
values through `src/auth/tenantCapabilities.ts` and
`useTenantKind().supports(...)`.

| Capability | Kind | Current surface |
|---|---|---|
| `band_roster` | `band` | Band-member API and the roster section on the profile page |
| `band_membership_admin` | `band` | Invites, membership administration, and the members settings section |
| `band_availability` | `band` | Band availability API, availability matrices, and availability controls on planning forms |
| `setlists` | `band` | Setlist API, routes, and navigation |
| `merch` | `band` | Merch API, routes, and navigation |
| `band_discovery` | `band` | Join-policy management and opt-in band-directory discovery |
| `band_promotion_integrations` | `band` | Bandsintown routes and profile fields, plus Bandsintown and Shopify credentials |
| `band_share` | `band` | Client-side tour sharing, tour export, and banner-mosaic tools on the gigs page |
| `band_linkpage` | `band` | Link-page editor handoff and public link-page content export |
| `my_bands` | `personal` | The musician's band-memberships settings section |
| `artist_calendar` | `personal` | Cross-tenant dashboard, planning feeds, map, and artist calendar |

Features absent from this table are shared unless another access mechanism,
such as a permission or subscription entitlement, restricts them.

### Backend enforcement

`resolveTenantId` in `server/middleware/tenant.js` resolves the active approved
membership and sets `req.tenantId`, `req.membership`, `req.tenantKind`, and the
tenant owner. Kind-specific APIs then use one of three middleware forms:

- `requireTenantCapability(capability)` protects a complete route or router.
- `requireTenantCapabilityForBodyFields(capability, fields)` protects selected
  fields on a shared endpoint.
- `requireTenantCapabilityWhen(capability, predicate)` protects a subtype or
  value on a shared endpoint.

A failed capability gate returns HTTP 403 with the structured
`tenant_kind_not_supported` code. This is appropriate because the caller is an
approved member of the active tenant and already knows its kind.

Permissions, entitlements, and tenant capabilities answer separate questions:

- A permission says whether the member's role may perform the operation.
- An entitlement says whether the tenant's subscription includes the feature
  or capacity.
- A tenant capability says whether the operation makes sense for that tenant
  kind.

An endpoint that needs all three must enforce all three on the backend.

The public link-page export performs its own capability check after resolving a
slug. An unsupported or unknown slug returns 404 because that endpoint is
outside an authenticated tenant context.

### Frontend presentation

`/auth/me` returns `activeTenantKind` and the kind of every membership.
`useTenantKind()` exposes the active `kind`, `isPersonal`, `allowsKind(...)`, and
`supports(...)` without another request.

The SPA uses capability checks to:

- Filter navigation and settings sections.
- Hide fields, controls, profile sections, and integrations that do not apply.
- Guard direct routes with `RequireTenantCapability` where a complete page is
  kind-specific.
- Select the active-tenant or cross-tenant planning feed.

These checks provide the correct user experience. Any corresponding API
boundary remains responsible for authorization.

## Personal-workspace lifecycle

`POST /api/tenants/personal` creates or returns the caller's personal workspace.
Creation is serialized with a user-row lock, and the unique owner index is the
database backstop. The transaction creates the tenant, statistics row, chart of
accounts, accounting profile, owner membership, and optional onboarding resume
pointer together.

The platform tenant-onboarding switch governs self-service creation of both
kinds. Personal creation does not consult the band limit. Band creation checks
the owner's band-product limit under the same user-row lock.

Archiving preserves tenant data. Unarchiving is owner-scoped and serialized:
band tenants re-check the active-band limit, while personal tenants do not.
Ownership failures return 404 so tenant existence is not disclosed.

Only active, owned `band` tenants count toward the `bands` limit. Personal
workspaces and archived bands are excluded.

## Memberships, invites, and band discovery

Membership administration belongs to band tenants. A personal workspace cannot
receive a second member through tenant-admin or super-admin membership grants.
Every membership insert assigns a non-null `source` that identifies the
membership flow.

Joining a band is user-level rather than active-tenant-level:

- `/api/invites/redeem` requires a loaded user but no active tenant.
- `/api/band-directory` searches only active `band` tenants whose
  `join_policy` is `request`.
- The server fixes the requested membership role and caps outstanding requests
  under a user-row lock.
- A tenant outside the discoverable set returns 404.

The personal settings page presents the musician's band memberships, join
requests, and directory flow.

## Subscription audiences

Plans are split into independent products in `shared/planAudiences.js`:

| Tenant kind | Plan audience |
|---|---|
| `band` | `band` |
| `personal` | `artist` |

A user can hold one live subscription in each audience. Checkout, cancellation,
plan changes, downgrade checks, and data purges stay within the selected
audience. A plan change cannot cross audiences.

`resolveTenantEntitlements` loads the tenant owner and kind, maps the kind to an
audience, and resolves that owner's subscription for the selected product.
Ownerless tenants skip tenant-side subscription enforcement. The user-level
band cap always reads the band audience, so an artist plan's `bands` value does
not affect band ownership.

Downgrade blockers and feature-data purges operate only on the owned tenant
kinds governed by the subscription audience. The band audience covers band
tenants; the artist audience covers the personal workspace.

## Cross-tenant artist view

A personal workspace acts as the musician's hub. Its dashboard, gigs,
rehearsals, band events, tasks, availability view, and gig map can combine data
from every band in which the user is an approved member.

The `/api/me/*` access tier does not run `resolveTenantId` and never sets
`req.tenantId`. `resolveMemberTenantIds` derives `req.memberTenants` from the
caller's approved memberships in active tenants. Band memberships are included;
a personal tenant is included only for its owner. The client cannot provide or
expand this tenant set.

`memberTenantScope` exposes the allowed IDs and labels each result with a
`tenantId`, `tenantName`, `tenantAvatarPath`, and `kind`. Aggregate repository
queries accept only that ID list. Enrichment that uses tenant-scoped queries
groups rows by tenant before loading participants or availability.

The hub exposes aggregate reads for agenda, gigs, rehearsals, band events,
tasks, and the gig map. Its write surface is limited to actions that belong to
the caller: setting the caller's rehearsal vote and changing the done state of
a task assigned to the caller. Resource creation and general editing use the
ordinary active-tenant endpoints.

In the SPA, `usePagedEventTabs` owns the choice between active-tenant and
cross-tenant feeds for gigs, rehearsals, and band events. Hub rows carry a
tenant label. Opening or editing a row from another tenant switches to that
tenant before using its ordinary route. A labeled foreign row is not writable
in the current tenant context.

## Availability

Availability is a user-level fact. Linked musicians store slots in
`user_availability_slots`, and `/api/me/availability` manages the caller's own
calendar and privacy settings without resolving an active tenant.

Band availability is a band capability. `/api/availability` and planning-form
availability matrices apply only to band tenants. A band reads a redacted
projection of each linked user's availability; unlinked band members continue
to use tenant-owned availability slots. Redaction happens in
`server/services/availabilityProjection.js` before serialization.

The personal availability page uses the artist calendar and cross-tenant event
feeds. It does not expose a one-member band availability grid.

## Kind-specific content

Achievements and tutorials may select content directly by tenant kind because
their wording and catalogues are content, not access control.

Each achievement definition declares its supported `kinds`.
`definitionsForKind` filters the catalogue before facts are evaluated, and
progress totals use only the active kind's catalogue. Tutorial definitions may
declare `kinds`, and `useTenantKind().allowsKind(...)` selects eligible content.

Direct kind branching is also appropriate for intrinsic mappings such as plan
audience, personal-workspace lifecycle, and planning-feed selection. Product
applicability for an API or UI surface belongs in the capability registry.

## Extension checklist

When adding tenant-kind behavior:

1. Confirm that the domain is not shared by default.
2. Add a named capability to `shared/tenantCapabilities.js` and map it to the
   supported kind.
3. Protect the backend router, route, fields, or subtype with the narrowest
   capability middleware. Keep permissions and entitlements in place as
   separate gates.
4. Consume the same capability through `useTenantKind().supports(...)` for
   navigation, route guards, controls, and fields.
5. Keep shared endpoints and domain stacks shared. Use field- or predicate-level
   gates when only one part of a payload is kind-specific.
6. Use `display_name` and kind-neutral vocabulary for shared identity.
7. Test both supported and unsupported kinds. Backend tests should assert the
   structured 403 for authenticated active-tenant capability failures and 404
   where a public or cross-tenant lookup must not disclose existence.
8. Preserve tenant isolation in every repository query and composite foreign
   key, including kind-specific subtypes attached to a shared resource.
