# Tenant-kind architecture and review tasks

This document records the architectural boundary for weaving `personal` into
the existing tenant model. A personal workspace remains an ordinary tenant for
shared data and services; tenant kind only controls genuinely different
capabilities.

## Central rule

`shared/tenantCapabilities.js` is the single applicability registry consumed by
the server and SPA. New code should ask whether the active tenant supports a
named capability, not compare `kind` inline.

- Shared by default: profile, gigs, rehearsals, tasks, contacts, venues, songs,
  files, email templates, finance and accounting.
- Band capabilities: roster, membership administration, availability grid,
  setlists, merch, discovery, sharing, band-promotion integrations and the
  public link page.
- Personal capability: external ensembles stored as contacts in the personal
  workspace.
- Backend middleware is authoritative. Frontend capability checks only hide
  inapplicable navigation, fields, and deep links.
- Shared endpoints use field/value capability middleware for kind-specific
  subtypes. They are not duplicated into personal and band route trees.
- Band subscription capacity counts owned active `band` tenants only. A
  `personal` tenant is unique per owner and never consumes the band allowance.

## Review tasks and desired end-state

1. Membership provenance
   - Task: make every membership insert satisfy the non-null `source` invariant.
   - Desired end-state: seed-admin bootstrap is idempotent and records `owner`;
     authentication bootstrap succeeds after migration 162.

2. Kind-aware profile
   - Task: keep one profile page while removing band roster and promotion fields
     from personal workspaces, and use neutral identity copy.
   - Desired end-state: both kinds reuse profile storage and editing; only a
     tenant with the corresponding capabilities sees members or Bandsintown.

3. Initial subscription capacity
   - Task: apply the same locked target-capacity check to first subscription as
     to downgrade, and bind pending checkout numeric limits immediately.
   - Desired end-state: `artist_gold` (`bands: 0`) cannot be selected while an
     owned band is active, nor can a band be created during its checkout.

4. Personal workspace lifecycle
   - Task: distinguish personal and band activation during unarchive.
   - Desired end-state: personal unarchive is serialized but bypasses the band
     cap; band unarchive still enforces it.

5. Promotion integration boundary
   - Task: gate Bandsintown and Shopify routes and profile fields through the
     band-promotion capability.
   - Desired end-state: personal tenants receive the standard structured 403
     for both direct endpoints and shared profile-field writes.

6. External ensemble ownership
   - Task: anchor external-band creation in the personal tenant and capability-
     gate the `ensemble` contact subtype and gig association.
   - Desired end-state: ensemble contacts/tags exist only in a personal
     workspace; the contacts and gigs domains themselves remain shared.

7. Bands settings
   - Task: keep the artist's memberships and join flows in their personal
     workspace settings.
   - Desired end-state: bands are configured from settings; the artist's own
     workspace is never presented as a band.

8. Link-page boundary
   - Task: gate the link-page editor mount and the public content export on the
     band link-page capability.
   - Desired end-state: a personal workspace gets the structured 403 on
     `/linkpage/*` and its slug is unknown to the export; the "Edit link page"
     affordance is absent from its profile.

9. Invite-only onboarding
   - Task: redirect users without a resume pointer when tenant creation is
     disabled.
   - Desired end-state: `/onboarding` lands directly on `/redeem-invite` rather
     than rendering a dead-end message; resumable onboarding remains available.

## Extension checklist

When adding a kind-specific feature, add a named capability to the shared
registry, protect the backend entry point, and consume the same capability in
navigation or fields. Do not fork an existing shared service, repository, page,
or table solely because a personal workspace uses different wording.
