// Availability domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import { validateSlot, buildSlotUpdateFields } from '../validators/availabilityValidators.js'
import {
  listSlotsInRange,
  listSlotsOnDate,
  listBandMembers,
  bandMemberExists,
  insertSlot,
  updateSlotFields,
  deleteSlot as deleteSlotRow,
} from '../repositories/availabilityRepository.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'Not found' } } }

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

export async function listRange(db, tenantId, query) {
  const { from, to } = query
  if (!from || !to) return badRequest('from and to are required')
  return { slots: await listSlotsInRange(db, tenantId, from, to) }
}

// Per-member availability for a single date: a band-wide slot wins over a
// member-specific slot, which wins over the default.
export async function listOnDate(db, tenantId, date) {
  const [members, slots] = await Promise.all([
    listBandMembers(db, tenantId),
    listSlotsOnDate(db, tenantId, date),
  ])

  const bandWide = slots.findLast((s) => s.band_member_id === null) ?? null

  const result = members.map((m) => {
    const memberSlot = slots.findLast((s) => s.band_member_id === m.id)
    const winner = bandWide ?? memberSlot
    return {
      member_id: m.id,
      name: m.name,
      color: m.color,
      role: m.role,
      position: m.position,
      status: winner ? winner.status : 'default',
      reason: winner?.reason ?? null,
      source: bandWide ? 'band' : memberSlot ? 'member' : 'default',
    }
  })

  return { members: result, bandWide }
}

export async function createSlot(db, tenantId, body) {
  const { band_member_id, start_date, end_date, status, reason } = body
  if (!start_date || !end_date || !status) {
    return badRequest('start_date, end_date and status are required')
  }
  const err = validateSlot({ start_date, end_date, status })
  if (err) return badRequest(err)

  if (band_member_id != null && !(await bandMemberExists(db, band_member_id, tenantId))) {
    return badRequest('band_member_id not found')
  }

  const slot = await insertSlot(db, tenantId, {
    bandMemberId: band_member_id ?? null,
    startDate: start_date,
    endDate: end_date,
    status,
    reason: reason ?? null,
  })
  return { slot }
}

export async function patchSlot(db, tenantId, slotId, body) {
  const err = validateSlot(body)
  if (err) return badRequest(err)

  if (body.band_member_id != null && !(await bandMemberExists(db, body.band_member_id, tenantId))) {
    return badRequest('band_member_id not found')
  }

  const built = buildSlotUpdateFields(body)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const slot = await updateSlotFields(db, tenantId, slotId, built.fields, built.values)
  if (!slot) return NOT_FOUND
  return { slot }
}

export async function deleteSlot(db, tenantId, slotId) {
  const deleted = await deleteSlotRow(db, slotId, tenantId)
  return deleted ? {} : NOT_FOUND
}
