import {
  findGigTenantForMember,
  listGigMapDataForMemberTenants,
  listGigsInRangeForMemberTenants,
  listPastGigsForMemberTenants,
  listUpcomingGigsForMemberTenants,
  searchGigsForMemberTenants,
} from '../gigs/gigRepository.js'
import { getBandMemberIdForUser } from '../../people/roster/bandMemberRepository.js'
import { enrichGigsWithAvailability, getGig } from '../gigs/gigService.js'
import {
  limitedCollectionWithCursor,
  limitedCollectionWithTotal,
  windowedCollection,
} from '../../platform/collections/limitedCollectionService.js'
import { badRequest, notFound } from '../../platform/http/serviceErrors.js'
import {
  INVALID_CURSOR,
  INVALID_TODAY,
  parseListCursor,
  parseLocalDate,
  parseSearchLimit,
} from '../../validators/common.js'
import { enrichPerTenant, loadFeedUserAvailability } from './mePlanningEnrichment.js'

const NOT_FOUND = notFound('Not found')

// Files are authorized against the active tenant, which the hub deliberately
// does not set. Never return a banner path that the caller cannot fetch.
const withoutBanner = ({ banner_path: _bannerPath, ...gig }) => gig

async function attachAvailability(db, userId, rows) {
  const shared = await loadFeedUserAvailability(db, rows, (gig) => gig.event_date)
  return enrichPerTenant(rows, (tenantId, gigs) =>
    enrichGigsWithAvailability(db, tenantId, gigs, { userId, tenantId }, shared))
}

export function listMyGigsInRange(db, userId, scope, from, to) {
  return listGigsInRangeForMemberTenants(db, userId, scope.ids, from, to)
}

export async function listMyUpcomingGigs(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)

  const result = await limitedCollectionWithTotal(query.limit, (limit) =>
    listUpcomingGigsForMemberTenants(db, userId, scope.ids, today, limit))
  if (result.error) return result
  const items = await attachAvailability(db, userId, result.items)
  return { ...result, items: items.map((gig) => scope.label(withoutBanner(gig))) }
}

export async function listMyPastGigs(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)

  const result = await limitedCollectionWithCursor(query.limit, (limit) =>
    listPastGigsForMemberTenants(db, userId, scope.ids, today, limit, parsedCursor.cursor),
  (gig) => gig.event_date)
  if (result.error) return result
  const items = await attachAvailability(db, userId, result.items)
  return { ...result, items: items.map((gig) => scope.label(withoutBanner(gig))) }
}

export async function searchMyGigs(db, userId, scope, query = {}) {
  const q = String(query.q ?? '').trim()
  if (q.length < 3) return []
  const rows = await searchGigsForMemberTenants(db, userId, scope.ids, {
    like: `%${q}%`, limit: parseSearchLimit(query.limit),
  })
  return rows.map((gig) => scope.label(withoutBanner(gig)))
}

export async function getMyGig(db, userId, scope, gigId) {
  const tenantId = await findGigTenantForMember(db, userId, scope.ids, gigId)
  if (tenantId == null) return NOT_FOUND
  const result = await getGig(db, tenantId, gigId)
  if (result.error) return NOT_FOUND
  if (scope.byId.get(tenantId)?.kind === 'personal') {
    return { gig: scope.label(result.gig) }
  }
  const memberId = await getBandMemberIdForUser(db, userId, tenantId)
  const attachments = (result.gig.attachments ?? [])
    .map(({ object_key: _objectKey, ...attachment }) => attachment)
  const tasks = (result.gig.tasks ?? []).filter((task) => task.assigned_to === memberId)
  const { participants: _participants, ...withoutParticipants } = result.gig
  return {
    gig: scope.label({
      ...withoutBanner(withoutParticipants), attachments, tasks, viewerBandMemberId: memberId,
    }),
  }
}

export async function listMyGigMapData(db, userId, scope, query = {}) {
  return windowedCollection(query, async (range) =>
    (await listGigMapDataForMemberTenants(db, userId, scope.ids, range.from, range.to)).map(scope.label))
}
