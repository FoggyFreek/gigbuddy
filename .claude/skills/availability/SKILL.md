---
name: availability
description: User-level availability slots and the redacted per-band projection. Use when touching availability in any form — busy/unavailable slots, user_availability_slots or availability_slots, the /api/availability band read, /api/me/availability, availability privacy or delegation settings, the planning-form availability matrix, or who may write another member's slots.
user-invocable: false
---

# Availability belongs to the user, not a tenant

"Busy on 14 March" is a fact about the person, so slots live on `user_availability_slots`
and each band reads a **redacted projection**.

- `availability_slots` remains for `band_members` rows with `user_id IS NULL` (deps,
  CRM-only entries). The band-side read (`availabilityService.js`) unions both, still keyed
  on `band_member_id`, so `/api/availability` keeps its URLs and shape.
- **Redaction happens in `server/planning/availability/availabilityProjection.js`, before
  serialization** — the API never emits a reason or band name the viewer may not see, so
  the frontend has nothing to hide. `users.availability_detail_visible` governs slot
  reasons, `users.cross_band_gig_detail_visible` governs bookings in other bands; both
  default off. Bookings in the *viewing* band aren't projected at all.
- The musician's own calendar and the privacy/delegation settings are `/api/me/availability`
  (+ `/settings`), editable nowhere else.

## Who may write

| Target | Requires |
|---|---|
| Your own slots | `availability.write.self` (granted to `READER`) |
| Another linked member's slots | `availability.write.self` **plus** `planning.write` **and** that member's `memberships.availability_managed_by_band` for this band |
| Band-wide slots, unlinked members | `planning.write` |

Both conditions for a delegated write are checked against the **target's** row, and denial
is **403**. Delegated writes record `created_by_user_id` / `created_in_tenant_id`.

## Kind split

Band availability is a band capability: `/api/availability` and the planning-form
availability matrices apply only to band tenants. The personal availability page uses the
artist calendar and cross-tenant event feeds — it does not expose a one-member band
availability grid. See the **tenant-model** skill for the capability mechanics.
