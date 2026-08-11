// The musician's own availability calendar, and the privacy/delegation
// settings that decide what each band sees of it.
//
// Two rules this file exists to protect:
//
//   1. Availability belongs to the USER, never to a tenant. A band reads a
//      projection of it (availabilityProjection.js), never the rows.
//   2. Nobody but the musician may change the privacy flags or the per-band
//      delegation — not a band admin, not a super admin. They are edited only
//      from the user's own settings and never appear on a band-side screen.
//
// Delegated writes (a bandmate maintaining someone's calendar) are deliberately
// NOT band-local: they change the musician's real calendar, which is the point.
// `created_by_user_id` / `created_in_tenant_id` record who wrote what from
// where so the musician can review and revert it.
import { withTransaction } from '../db/withTransaction.js'
import {
  validateUserSlot,
  buildUserSlotUpdateFields,
  buildVisibilityUpdate,
} from '../validators/userAvailabilityValidators.js'
import {
  listUserSlotsInRange,
  fetchUserSlot,
  insertUserSlot,
  updateUserSlotFields,
  deleteUserSlot,
  fetchAvailabilitySettings,
  updateAvailabilitySettings,
  listDelegations,
  setDelegation,
  isManagedByBand,
} from '../repositories/userAvailabilityRepository.js'
import { INVALID_BOUNDED_RANGE, MAX_RANGE_DAYS, parseDateRange } from '../validators/common.js'
import { badRequest, forbidden, notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Availability slot not found')

export async function listMyAvailability(db, userId, query) {
  const range = parseDateRange(query, MAX_RANGE_DAYS)
  if (range === null) return badRequest(INVALID_BOUNDED_RANGE)
  const slots = await listUserSlotsInRange(db, userId, range.from, range.to)
  return { items: slots.map(present), meta: { ...range, returned: slots.length } }
}

export async function createMyAvailability(db, userId, body, context = {}) {
  const { start_date, end_date, status } = body ?? {}
  if (!start_date || !end_date || !status) {
    return badRequest('start_date, end_date and status are required')
  }
  const err = validateUserSlot(body)
  if (err) return badRequest(err)

  const slot = await insertUserSlot(db, userId, {
    startDate: start_date,
    endDate: end_date,
    status,
    reason: body.reason || null,
    // Who wrote it, and from which band's screen. Self-writes record the
    // musician themselves, so the provenance line reads the same either way.
    createdByUserId: context.actorUserId ?? userId,
    createdInTenantId: context.tenantId ?? null,
  })
  return { slot: present(slot) }
}

export async function patchMyAvailability(db, userId, slotId, body) {
  const err = validateUserSlot(body ?? {})
  if (err) return badRequest(err)

  const built = buildUserSlotUpdateFields(body ?? {})
  if (!built.fields.length) return badRequest('No valid fields to update')

  // The owner is bound in the WHERE, so a slot belonging to someone else is a
  // 404 rather than a silent cross-user write.
  const slot = await updateUserSlotFields(db, slotId, userId, built.fields, built.values)
  if (!slot) return NOT_FOUND
  return { slot: present(slot) }
}

export async function deleteMyAvailability(db, userId, slotId) {
  return (await deleteUserSlot(db, slotId, userId)) ? {} : NOT_FOUND
}

// ---------- privacy and delegation ----------

export async function getAvailabilitySettings(db, userId) {
  const [flags, delegations] = await Promise.all([
    fetchAvailabilitySettings(db, userId),
    listDelegations(db, userId),
  ])
  return {
    availabilityDetailVisible: flags?.availability_detail_visible ?? false,
    crossBandGigDetailVisible: flags?.cross_band_gig_detail_visible ?? false,
    travelMarginHours: flags?.availability_travel_margin_hours ?? 2,
    delegations: delegations.map((d) => ({
      tenantId: d.tenant_id,
      displayName: d.display_name,
      managedByBand: d.availability_managed_by_band,
    })),
  }
}

// Both the flags and the delegation toggles are edited here and nowhere else.
export async function patchAvailabilitySettings(db, userId, body) {
  const visibility = buildVisibilityUpdate(body)
  if (visibility.error) return badRequest(visibility.error)

  const delegation = parseDelegationPatch(body)
  if (delegation.error) return badRequest(delegation.error)

  if (!visibility.fields.length && delegation.entries.length === 0) {
    return badRequest('No valid fields to update')
  }

  return withTransaction(async (client) => {
    if (visibility.fields.length) {
      await updateAvailabilitySettings(client, userId, visibility.fields, visibility.values)
    }
    for (const entry of delegation.entries) {
      // A tenant the caller isn't an approved member of updates nothing — the
      // repository binds user_id, so there is no cross-user write to make.
      await setDelegation(client, userId, entry.tenantId, entry.managedByBand)
    }
    return { settings: await getAvailabilitySettings(client, userId) }
  }, { db })
}

function parseDelegationPatch(body) {
  const raw = body?.delegations
  if (raw === undefined) return { entries: [] }
  if (!Array.isArray(raw)) return { error: 'delegations must be an array' }

  const entries = []
  for (const item of raw) {
    const tenantId = Number(item?.tenantId)
    if (!Number.isInteger(tenantId) || tenantId <= 0) return { error: 'Invalid delegations.tenantId' }
    if (typeof item?.managedByBand !== 'boolean') {
      return { error: 'delegations.managedByBand must be a boolean' }
    }
    entries.push({ tenantId, managedByBand: item.managedByBand })
  }
  return { entries }
}

// ---------- the band-side write rule ----------

// Who may write a linked musician's availability from a band's screen:
//   - the musician themselves, always;
//   - another member, ONLY when the target set availability_managed_by_band for
//     this band AND the writer holds planning.write here.
// Both conditions are checked against the TARGET's membership row.
//
// A denial is 403, not 404: the member row plainly exists in this tenant, so
// there is nothing to conceal.
export async function assertMayWriteFor(db, { targetUserId, actorUserId, tenantId, canPlanningWrite }) {
  if (targetUserId === actorUserId) return null
  if (!canPlanningWrite) return forbidden('You may not edit another member\'s availability')
  if (!(await isManagedByBand(db, targetUserId, tenantId))) {
    return forbidden('This member has not let this band manage their availability')
  }
  return null
}

export async function loadSlotOwner(db, slotId) {
  const slot = await fetchUserSlot(db, slotId)
  return slot?.user_id ?? null
}

function present(slot) {
  return {
    id: slot.id,
    start_date: slot.start_date,
    end_date: slot.end_date,
    status: slot.status,
    reason: slot.reason ?? null,
    created_by_user_id: slot.created_by_user_id ?? null,
    created_in_tenant_id: slot.created_in_tenant_id ?? null,
  }
}
