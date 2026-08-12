// Availability domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a /clarspecific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import { validateSlot, buildSlotUpdateFields } from '../validators/availabilityValidators.js'
import {
  listSlotsInRange,
  listBandMembers,
  listBookingsForMembersInRange,
  eventExistsInTenant,
  insertSlot,
  updateSlotFields,
  deleteSlot as deleteSlotRow,
} from '../repositories/availabilityRepository.js'
import {
  bandMemberExistsInTenant,
  listMemberUserIdsForTenants,
} from '../repositories/bandMemberRepository.js'
import {
  listSlotsForUsersInRange,
  listBookingsForUsersInRange,
  fetchVisibilityForUsers,
} from '../repositories/userAvailabilityRepository.js'
import { projectSlot, projectBooking } from './availabilityProjection.js'
import { prepareMatrix, summarizeSpan, withMembers } from '../domain/availabilitySpan.js'
import {
  assertMayWriteFor,
  loadSlotOwner,
  createMyAvailability,
  patchMyAvailability,
  deleteMyAvailability,
} from './userAvailabilityService.js'
import { bandMemberUserId } from '../repositories/bandMemberRepository.js'
import { badRequest, forbidden, notFound } from './serviceErrors.js'
import {
  INVALID_BOUNDED_RANGE,
  MAX_RANGE_DAYS,
  parseDateRange,
  validateDailyTimeRange,
} from '../validators/common.js'

const NOT_FOUND = notFound('Not found')

// Band-wide slots and slots for members without an account belong to the band,
// not to a person, so they stay behind planning.write.
const PLANNING_WRITE_REQUIRED = forbidden('Forbidden')

// ---------- the user-level half ----------

// A musician's own slots and their bookings across every band they play in are
// keyed by USER, not tenant, so a request that builds matrices for SEVERAL
// bands (the cross-tenant hub) fetches this once for everyone involved instead
// of repeating the heaviest query in the domain per band.
const EMPTY_USER_AVAILABILITY = {
  slotsByUser: new Map(),
  bookingsByUser: new Map(),
  owners: new Map(),
}

function groupByUser(rows) {
  const byUser = new Map()
  for (const row of rows) {
    const existing = byUser.get(row.user_id)
    if (existing) existing.push(row)
    else byUser.set(row.user_id, [row])
  }
  return byUser
}

export async function loadUserAvailability(db, userIds, from, to) {
  if (!userIds.length) return EMPTY_USER_AVAILABILITY

  const [slots, bookings, visibility] = await Promise.all([
    listSlotsForUsersInRange(db, userIds, from, to),
    listBookingsForUsersInRange(db, userIds, from, to),
    fetchVisibilityForUsers(db, userIds),
  ])

  return {
    slotsByUser: groupByUser(slots),
    bookingsByUser: groupByUser(bookings),
    owners: new Map(visibility.map((v) => [v.id, {
      userId: v.id,
      availabilityDetailVisible: v.availability_detail_visible,
      crossBandGigDetailVisible: v.cross_band_gig_detail_visible,
      travelMarginHours: v.availability_travel_margin_hours ?? 2,
    }])),
  }
}

// The user-level half for every musician in `tenantIds`, to hand to each
// per-tenant loadAvailabilityMatrix call as its `shared` argument.
export async function loadSharedUserAvailability(db, tenantIds, from, to) {
  if (!tenantIds.length) return EMPTY_USER_AVAILABILITY
  return loadUserAvailability(db, await listMemberUserIdsForTenants(db, tenantIds), from, to)
}

// The band-side read is a UNION of two sources, keyed on band_member_id so the
// grid keeps its current shape:
//   - band-local slots, for members with no linked account (deps, CRM entries);
//   - the linked members' own user-level slots and bookings, redacted per
//     viewer by availabilityProjection.js before they ever leave the service.
//
// This is the single SQL owner of "what does this band see on these days".
// Everything derived from it — the grid, the single-date read, the per-event
// summaries — goes through summarizeSpan (server/domain/availabilitySpan.js).
export async function loadAvailabilityMatrix(db, tenantId, from, to, viewer = null, shared = null) {
  const [bandLocal, members] = await Promise.all([
    listSlotsInRange(db, tenantId, from, to),
    listBandMembers(db, tenantId),
  ])

  const linked = members.filter((m) => m.user_id !== null)
  const unlinked = members.filter((m) => m.user_id === null)
  const userIds = [...new Set(linked.map((m) => m.user_id))]

  // Everything below depends only on `members`, so it goes out in one batch
  // rather than a round trip for the unlinked half and another for the linked.
  const [localBookings, userAvailability] = await Promise.all([
    listBookingsForMembersInRange(db, tenantId, unlinked.map((member) => member.id), from, to),
    shared ?? loadUserAvailability(db, userIds, from, to),
  ])

  const projectedLocalBookings = localBookings.map((booking) => ({
    id: `${booking.source}-${booking.source_id}`,
    source: 'booking',
    bookingType: booking.source,
    source_id: booking.source_id,
    band_member_id: booking.band_member_id,
    tenant_id: tenantId,
    start_date: booking.start_date,
    end_date: booking.end_date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    travel_margin_hours: 2,
    status: 'unavailable',
    reason: booking.title ?? null,
    title: booking.title ?? null,
    redacted: false,
  }))

  const seenViewer = viewer ?? { userId: null, tenantId }

  // Walk this band's linked members, not the fetched rows: `shared` may cover
  // musicians from other bands entirely, and a projected entry must always land
  // on one of THIS band's member ids — a null there reads as band-wide.
  const projected = []
  for (const member of linked) {
    const owner = userAvailability.owners.get(member.user_id)
    if (!owner) continue
    const attach = (entry) => projected.push({
      ...entry, band_member_id: member.id, tenant_id: tenantId,
    })
    for (const slot of userAvailability.slotsByUser.get(member.user_id) ?? []) {
      attach(projectSlot(slot, owner, seenViewer))
    }
    for (const booking of userAvailability.bookingsByUser.get(member.user_id) ?? []) {
      attach(projectBooking(booking, owner, seenViewer))
    }
  }

  return { members, slots: [...bandLocal, ...projectedLocalBookings, ...projected] }
}

export async function listRange(db, tenantId, query, viewer = null) {
  const range = parseDateRange(query, MAX_RANGE_DAYS)
  if (!range) return badRequest(INVALID_BOUNDED_RANGE)
  const { from, to } = range

  const { slots } = await loadAvailabilityMatrix(db, tenantId, from, to, viewer)
  // Current-tenant events already have their own calendar blocks. Keep them in
  // the evaluation matrix, but do not duplicate them as availability blocks.
  // Explicit slots and cross-tenant bookings remain visible.
  return {
    slots: slots.filter((slot) => slot.source !== 'booking'
      || String(slot.createdInTenantId ?? slot.tenant_id) !== String(tenantId)),
  }
}

// Per-member availability for a single date — the span rules applied to a span
// of one. Linked members' entries come from the same redacted union as
// listRange, so a reason the viewer may not see never reaches this shape.
export async function listOnDate(db, tenantId, date, viewer = null) {
  const matrix = await loadAvailabilityMatrix(db, tenantId, date, date, viewer)
  const { members, days } = summarizeSpan(matrix, date, date)
  return { members, bandWide: days[0]?.bandWide ?? null }
}

export async function listSpan(db, tenantId, query, viewer = null) {
  const range = parseDateRange(query, MAX_RANGE_DAYS)
  if (!range) return badRequest(INVALID_BOUNDED_RANGE)

  const matrix = await loadAvailabilityMatrix(db, tenantId, range.from, range.to, viewer)
  return summarizeSpan(matrix, range.from, range.to)
}

const EVENT_TYPES = new Set(['gig', 'rehearsal', 'band_event'])

export async function evaluateEvent(db, tenantId, body, viewer = null) {
  const type = body?.event_type
  if (!EVENT_TYPES.has(type)) return badRequest('event_type must be gig, rehearsal, or band_event')
  const start = body?.start_date
  const end = body?.end_date || start
  const range = parseDateRange({ from: start, to: end }, MAX_RANGE_DAYS)
  if (!range) {
    return badRequest(
      `start_date and end_date must be valid ISO dates with start_date <= end_date, at most ${MAX_RANGE_DAYS} days apart`,
    )
  }

  const startTime = body?.start_time || null
  const endTime = body?.end_time || null
  const timeError = validateDailyTimeRange(startTime, endTime)
  if (timeError) return badRequest(timeError)

  const eventId = body?.event_id == null ? null : Number(body.event_id)
  if (eventId !== null) {
    if (!Number.isInteger(eventId) || eventId <= 0) return badRequest('event_id must be a positive integer')
    if (!(await eventExistsInTenant(db, tenantId, type, eventId))) return NOT_FOUND
  }

  let participantIds = null
  if (body?.participant_ids !== undefined) {
    if (!Array.isArray(body.participant_ids)) return badRequest('participant_ids must be an array')
    participantIds = body.participant_ids.map(Number)
    if (participantIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      return badRequest('participant_ids must contain positive integers')
    }
  }

  const matrix = await loadAvailabilityMatrix(db, tenantId, range.from, range.to, viewer)
  const memberIds = new Set(matrix.members.map((member) => member.id))
  const selected = participantIds === null
    ? new Set(matrix.members.filter((member) => member.position === 'lead').map((member) => member.id))
    : new Set(participantIds)
  if ([...selected].some((id) => !memberIds.has(id))) return NOT_FOUND

  const filtered = withMembers(
    prepareMatrix(matrix),
    matrix.members.filter((member) => selected.has(member.id)),
  )
  return summarizeSpan(filtered, range.from, range.to, {
    start_date: range.from,
    end_date: range.to,
    start_time: startTime,
    end_time: endTime,
    ...(eventId === null ? {} : { exclude: { type, id: eventId } }),
  })
}

// A write for a member who is LINKED to a user goes to that user's own
// calendar, not to this band's table — that is the whole point of the feature,
// and it is why the self-or-delegated rule is enforced first. Members without
// an account keep their band-local slots.
export async function createSlot(db, tenantId, body, actor = null) {
  const { band_member_id, start_date, end_date, status, reason } = body
  if (!start_date || !end_date || !status) {
    return badRequest('start_date, end_date and status are required')
  }
  const err = validateSlot({ start_date, end_date, status })
  if (err) return badRequest(err)

  if (band_member_id != null && !(await bandMemberExistsInTenant(db, band_member_id, tenantId))) {
    return badRequest('band_member_id not found')
  }

  const targetUserId = band_member_id == null
    ? null
    : await bandMemberUserId(db, band_member_id, tenantId)
  if (targetUserId !== null && actor) {
    const denied = await assertMayWriteFor(db, {
      targetUserId, actorUserId: actor.userId, tenantId, canPlanningWrite: actor.canPlanningWrite,
    })
    if (denied) return denied
    return createMyAvailability(db, targetUserId, body, {
      actorUserId: actor.userId, tenantId,
    })
  }

  // Band-local: a band-wide slot, or one for a member with no account. Neither
  // is anybody's "own" availability, so the ordinary planning permission
  // applies — the self permission must not become a way in.
  if (actor && !actor.canPlanningWrite) return PLANNING_WRITE_REQUIRED

  const slot = await insertSlot(db, tenantId, {
    bandMemberId: band_member_id ?? null,
    startDate: start_date,
    endDate: end_date,
    status,
    reason: reason ?? null,
  })
  return { slot }
}

// A slot id belongs to exactly one of the two tables. User-level ids are tried
// first and, when they hit, run through the same self-or-delegated rule as a
// create; band-local ids keep the plain planning.write path.
export async function patchSlot(db, tenantId, slotId, body, actor = null) {
  const err = validateSlot(body)
  if (err) return badRequest(err)

  if (actor) {
    const ownerUserId = await loadSlotOwner(db, slotId)
    if (ownerUserId !== null) {
      const denied = await assertMayWriteFor(db, {
        targetUserId: ownerUserId, actorUserId: actor.userId, tenantId,
        canPlanningWrite: actor.canPlanningWrite,
      })
      if (denied) return denied
      return patchMyAvailability(db, ownerUserId, slotId, body)
    }
    if (!actor.canPlanningWrite) return PLANNING_WRITE_REQUIRED
  }

  if (body.band_member_id != null && !(await bandMemberExistsInTenant(db, body.band_member_id, tenantId))) {
    return badRequest('band_member_id not found')
  }

  const built = buildSlotUpdateFields(body)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const slot = await updateSlotFields(db, tenantId, slotId, built.fields, built.values)
  if (!slot) return NOT_FOUND
  return { slot }
}

export async function deleteSlot(db, tenantId, slotId, actor = null) {
  if (actor) {
    const ownerUserId = await loadSlotOwner(db, slotId)
    if (ownerUserId !== null) {
      const denied = await assertMayWriteFor(db, {
        targetUserId: ownerUserId, actorUserId: actor.userId, tenantId,
        canPlanningWrite: actor.canPlanningWrite,
      })
      if (denied) return denied
      return deleteMyAvailability(db, ownerUserId, slotId)
    }
    if (!actor.canPlanningWrite) return PLANNING_WRITE_REQUIRED
  }
  const deleted = await deleteSlotRow(db, slotId, tenantId)
  return deleted ? {} : NOT_FOUND
}
