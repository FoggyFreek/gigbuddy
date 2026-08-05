// Availability domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import { validateSlot, buildSlotUpdateFields } from '../validators/availabilityValidators.js'
import {
  listSlotsInRange,
  listBandMembers,
  insertSlot,
  updateSlotFields,
  deleteSlot as deleteSlotRow,
} from '../repositories/availabilityRepository.js'
import { bandMemberExistsInTenant } from '../repositories/bandMemberRepository.js'
import {
  listSlotsForUsersInRange,
  listBookingsForUsersInRange,
  fetchVisibilityForUsers,
} from '../repositories/userAvailabilityRepository.js'
import { projectSlot, projectBooking } from './availabilityProjection.js'
import { summarizeSpan } from '../domain/availabilitySpan.js'
import {
  assertMayWriteFor,
  loadSlotOwner,
  createMyAvailability,
  patchMyAvailability,
  deleteMyAvailability,
} from './userAvailabilityService.js'
import { bandMemberUserId } from '../repositories/bandMemberRepository.js'
import { badRequest, forbidden, notFound } from './serviceErrors.js'
import { parseDateRange } from '../validators/common.js'

const NOT_FOUND = notFound('Not found')

// Band-wide slots and slots for members without an account belong to the band,
// not to a person, so they stay behind planning.write.
const PLANNING_WRITE_REQUIRED = forbidden('Forbidden')

// The band-side read is a UNION of two sources, keyed on band_member_id so the
// grid keeps its current shape:
//   - band-local slots, for members with no linked account (deps, CRM entries);
//   - the linked members' own user-level slots and bookings, redacted per
//     viewer by availabilityProjection.js before they ever leave the service.
//
// This is the single SQL owner of "what does this band see on these days".
// Everything derived from it — the grid, the single-date read, the per-event
// summaries — goes through summarizeSpan (server/domain/availabilitySpan.js).
export async function loadAvailabilityMatrix(db, tenantId, from, to, viewer = null) {
  const [bandLocal, members] = await Promise.all([
    listSlotsInRange(db, tenantId, from, to),
    listBandMembers(db, tenantId),
  ])

  const linked = members.filter((m) => m.user_id !== null)
  if (linked.length === 0) return { members, slots: bandLocal }

  const userIds = [...new Set(linked.map((m) => m.user_id))]
  const [userSlots, bookings, visibility] = await Promise.all([
    listSlotsForUsersInRange(db, userIds, from, to),
    listBookingsForUsersInRange(db, userIds, from, to, tenantId),
    fetchVisibilityForUsers(db, userIds),
  ])

  const owners = new Map(visibility.map((v) => [v.id, {
    userId: v.id,
    availabilityDetailVisible: v.availability_detail_visible,
    crossBandGigDetailVisible: v.cross_band_gig_detail_visible,
  }]))
  const memberIdByUser = new Map(linked.map((m) => [m.user_id, m.id]))
  const seenViewer = viewer ?? { userId: null, tenantId }

  const projected = [
    ...userSlots.map((slot) => ({
      slot, owner: owners.get(slot.user_id), project: projectSlot,
    })),
    ...bookings.map((booking) => ({
      slot: booking, owner: owners.get(booking.user_id), project: projectBooking,
    })),
  ]
    .filter((entry) => entry.owner)
    .map(({ slot, owner, project }) => ({
      ...project(slot, owner, seenViewer),
      band_member_id: memberIdByUser.get(owner.userId) ?? null,
      tenant_id: tenantId,
    }))
    // A projected entry always belongs to a member — never let one fall through
    // as band_member_id null, which the span rules read as band-wide.
    .filter((entry) => entry.band_member_id !== null)

  return { members, slots: [...bandLocal, ...projected] }
}

export async function listRange(db, tenantId, query, viewer = null) {
  const { from, to } = query
  if (!from || !to) return badRequest('from and to are required')

  const { slots } = await loadAvailabilityMatrix(db, tenantId, from, to, viewer)
  return { slots }
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
  const range = parseDateRange(query)
  if (!range) return badRequest('from and to must be valid ISO dates with from <= to')

  const matrix = await loadAvailabilityMatrix(db, tenantId, range.from, range.to, viewer)
  return summarizeSpan(matrix, range.from, range.to)
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
