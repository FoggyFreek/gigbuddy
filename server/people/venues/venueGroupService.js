import { abortTransaction, withTransaction } from '../../db/withTransaction.js'
import { limitedCollection } from '../../platform/collections/limitedCollectionService.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'
import { normalizeGroupName, parseVenueIds } from './venueGroupValidators.js'
import {
  deleteVenueGroup as deleteVenueGroupRow,
  deleteVenueGroupMemberships,
  fetchVenueGroup,
  insertVenueGroup,
  insertVenueGroupMemberships,
  listVenueGroups as listVenueGroupRows,
  lockVenueIdsInTenant,
  updateVenueGroupName,
} from './venueGroupRepository.js'

const NOT_FOUND = notFound('Not found')
const GROUP_EXISTS = conflict('A venue group with that name already exists', {
  code: 'venue_group_exists',
})

function parseMembershipBody(body) {
  const venueIds = parseVenueIds(body?.venue_ids)
  return venueIds ?? badRequest('venue_ids must be a non-empty array of positive ids')
}

async function assertVenuesInTenant(client, venueIds, tenantId) {
  const existing = await lockVenueIdsInTenant(client, venueIds, tenantId)
  if (existing.length !== venueIds.length) abortTransaction(NOT_FOUND)
}

export async function listVenueGroups(db, tenantId, query = {}) {
  const q = String(query.q ?? '').trim()
  const search = q ? `%${q}%` : null
  return limitedCollection(query.limit, (limit) =>
    listVenueGroupRows(db, tenantId, search, limit))
}

export async function createVenueGroup(db, tenantId, body = {}) {
  const name = normalizeGroupName(body.name)
  if (!name) return badRequest('name is required')
  const parsed = parseMembershipBody(body)
  if (parsed.error) return parsed
  const venueIds = parsed

  return withTransaction(async (client) => {
    await assertVenuesInTenant(client, venueIds, tenantId)
    const group = await insertVenueGroup(client, tenantId, name)
    const added = await insertVenueGroupMemberships(client, group.id, tenantId, venueIds)
    return { group, added_count: added.length, already_present_count: 0 }
  }, {
    db,
    mapError: (err) => (err.code === '23505' ? GROUP_EXISTS : null),
  })
}

export async function renameVenueGroup(db, tenantId, groupId, body = {}) {
  const name = normalizeGroupName(body.name)
  if (!name) return badRequest('name is required')
  try {
    const group = await updateVenueGroupName(db, groupId, tenantId, name)
    return group ? { group } : NOT_FOUND
  } catch (err) {
    if (err.code === '23505') return GROUP_EXISTS
    throw err
  }
}

export async function deleteVenueGroup(db, tenantId, groupId) {
  return (await deleteVenueGroupRow(db, groupId, tenantId)) ? {} : NOT_FOUND
}

export async function addVenueGroupMembers(db, tenantId, groupId, body = {}) {
  const parsed = parseMembershipBody(body)
  if (parsed.error) return parsed
  const venueIds = parsed

  return withTransaction(async (client) => {
    if (!(await fetchVenueGroup(client, groupId, tenantId, { lock: true }))) {
      abortTransaction(NOT_FOUND)
    }
    await assertVenuesInTenant(client, venueIds, tenantId)
    const added = await insertVenueGroupMemberships(client, groupId, tenantId, venueIds)
    return {
      added_count: added.length,
      already_present_count: venueIds.length - added.length,
    }
  }, { db })
}

export async function removeVenueGroupMembers(db, tenantId, groupId, body = {}) {
  const parsed = parseMembershipBody(body)
  if (parsed.error) return parsed
  const venueIds = parsed

  return withTransaction(async (client) => {
    if (!(await fetchVenueGroup(client, groupId, tenantId, { lock: true }))) {
      abortTransaction(NOT_FOUND)
    }
    await assertVenuesInTenant(client, venueIds, tenantId)
    const removed = await deleteVenueGroupMemberships(client, groupId, tenantId, venueIds)
    return { removed_count: removed }
  }, { db })
}
