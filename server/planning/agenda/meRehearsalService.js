import {
  findRehearsalTenantForMember,
  listNextPlannedRehearsalForMemberTenants,
  listPastRehearsalsForMemberTenants,
  listRehearsalsInRangeForMemberTenants,
  listUpcomingRehearsalsForMemberTenants,
  loadParticipants,
} from '../rehearsals/rehearsalRepository.js'
import { getBandMemberIdForUser } from '../../people/roster/bandMemberRepository.js'
import { getRehearsal, setParticipantVote } from '../rehearsals/rehearsalService.js'
import { limitedCollection, limitedCollectionWithCursor } from '../../platform/collections/limitedCollectionService.js'
import { badRequest, notFound } from '../../platform/http/serviceErrors.js'
import {
  INVALID_CURSOR,
  INVALID_TODAY,
  parseListCursor,
  parseLocalDate,
} from '../../platform/http/requestValidators.js'
import { enrichPerTenant } from './mePlanningEnrichment.js'

const NOT_FOUND = notFound('Not found')

const attachParticipants = (db, userId, rows) =>
  enrichPerTenant(rows, async (tenantId, rehearsals) => {
    const [byId, viewerBandMemberId] = await Promise.all([
      loadParticipants(db, rehearsals.map((rehearsal) => rehearsal.id), tenantId),
      getBandMemberIdForUser(db, userId, tenantId),
    ])
    return rehearsals.map((rehearsal) => ({
      ...rehearsal,
      participants: byId.get(rehearsal.id) ?? [],
      viewerBandMemberId,
    }))
  })

export function listMyRehearsalsInRange(db, userId, scope, from, to) {
  return listRehearsalsInRangeForMemberTenants(db, userId, scope.ids, from, to)
}

export async function getMyNextRehearsal(db, userId, scope) {
  const rehearsal = await listNextPlannedRehearsalForMemberTenants(db, userId, scope.ids)
  return { rehearsal: rehearsal ? scope.label(rehearsal) : null }
}

export async function listMyUpcomingRehearsals(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const result = await limitedCollection(query.limit, (limit) =>
    listUpcomingRehearsalsForMemberTenants(db, userId, scope.ids, today, limit))
  if (result.error) return result
  return { ...result, items: (await attachParticipants(db, userId, result.items)).map(scope.label) }
}

export async function listMyPastRehearsals(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)
  const result = await limitedCollectionWithCursor(query.limit, (limit) =>
    listPastRehearsalsForMemberTenants(db, userId, scope.ids, today, limit, parsedCursor.cursor),
  (rehearsal) => rehearsal.proposed_date)
  if (result.error) return result
  return { ...result, items: (await attachParticipants(db, userId, result.items)).map(scope.label) }
}

export async function getMyRehearsal(db, userId, scope, rehearsalId) {
  const tenantId = await findRehearsalTenantForMember(db, userId, scope.ids, rehearsalId)
  if (tenantId == null) return NOT_FOUND
  const result = await getRehearsal(db, tenantId, rehearsalId)
  if (result.error) return NOT_FOUND
  const viewerBandMemberId = await getBandMemberIdForUser(db, userId, tenantId)
  return { rehearsal: scope.label({ ...result.rehearsal, viewerBandMemberId }) }
}

export async function setMyRehearsalVote(db, userId, scope, rehearsalId, body = {}) {
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'vote')) {
    return badRequest('Only vote may be updated')
  }
  const tenantId = await findRehearsalTenantForMember(db, userId, scope.ids, rehearsalId)
  if (tenantId == null) return NOT_FOUND
  const memberId = await getBandMemberIdForUser(db, userId, tenantId)
  if (memberId == null) return NOT_FOUND
  const result = await setParticipantVote(
    db, tenantId, userId, rehearsalId, memberId, body, { role: 'reader', isSuperAdmin: false },
  )
  if (result.error) return result.error.status === 403 ? NOT_FOUND : result
  return { rehearsal: scope.label({ ...result.rehearsal, viewerBandMemberId: memberId }) }
}
