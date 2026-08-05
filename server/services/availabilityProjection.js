// What one band is allowed to see of a musician's availability.
//
// Redaction happens HERE, before serialization, so the API never emits a reason
// or a band name the viewer isn't allowed to see — the frontend has nothing to
// hide and cannot leak it by accident.
//
// The rules, per the musician's own two flags:
//
//   source of busy            | flag off (default)          | flag on
//   --------------------------|-----------------------------|------------------
//   manual slot               | unavailable, no reason      | reason included
//   booking in another band   | unavailable, no band/title  | band + title
//   the musician's own row    | full detail, always
//
// Bookings in the VIEWING band are not projected at all: its grid already shows
// its own gigs, rehearsals and events, so a busy block for them would duplicate
// what is on screen.
//
// `availability_detail_visible` governs the first row, `cross_band_gig_detail_visible`
// the second. A personal workspace counts as "another band" for redaction.
//
// Pure: no I/O, so the rules can be read and tested on their own.

/** Busy that came from a slot the musician (or a delegate) entered. */
export const SOURCE_SLOT = 'slot'
/** Busy derived from a booking — no one entered a slot for it. */
export const SOURCE_BOOKING = 'booking'

function redactedEntry(base) {
  return {
    ...base,
    status: 'unavailable',
    reason: null,
    title: null,
    description: null,
    tenantName: null,
    redacted: true,
  }
}

// `viewer` is { userId, tenantId }: who is looking, and from which band's grid.
// `owner` is { userId, availabilityDetailVisible, crossBandGigDetailVisible }.
export function projectSlot(slot, owner, viewer) {
  const base = {
    id: slot.id,
    source: SOURCE_SLOT,
    userId: owner.userId,
    // snake_case like the band-local rows they are unioned with: the grid and
    // the span aggregation index both sources on the same two keys.
    start_date: slot.start_date,
    end_date: slot.end_date,
    // Provenance, so the musician can see "set by X (Band Y)" and revert it.
    createdByUserId: slot.created_by_user_id ?? null,
    createdInTenantId: slot.created_in_tenant_id ?? null,
  }
  const full = { ...base, status: slot.status, reason: slot.reason ?? null, title: null, tenantName: null, redacted: false }

  // Your own availability is never redacted from you, in any tenant.
  if (viewer.userId === owner.userId) return full
  return owner.availabilityDetailVisible ? full : redactedEntry(base)
}

export function projectBooking(booking, owner, viewer) {
  const base = {
    id: `${booking.source}-${booking.source_id}`,
    source: SOURCE_BOOKING,
    bookingType: booking.source,
    userId: owner.userId,
    start_date: booking.start_date,
    end_date: booking.end_date,
    createdByUserId: null,
    createdInTenantId: booking.tenant_id,
  }
  const full = {
    ...base,
    status: 'unavailable',
    reason: null,
    title: booking.title ?? null,
    description: [booking.title, booking.tenant_name].filter(Boolean).join(' — ') || null,
    tenantName: booking.tenant_name ?? null,
    redacted: false,
  }

  if (viewer.userId === owner.userId) return full
  // Bookings from the viewing band never reach here — they are excluded by the
  // query, because its own grid already renders them from their own endpoints.
  // So everything projected here is another band's, and the cross-band flag
  // decides whether it is named.
  return owner.crossBandGigDetailVisible ? full : redactedEntry(base)
}
