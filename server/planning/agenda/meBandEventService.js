import {
  findBandEventTenantForMember,
  listBandEventsInRangeForMemberTenants,
  listPastBandEventsForMemberTenants,
  listUpcomingBandEventsForMemberTenants,
} from '../events/bandEventRepository.js'
import { enrichEventsWithAvailability, getEvent } from '../events/bandEventService.js'
import { limitedCollection, limitedCollectionWithCursor } from '../../platform/collections/limitedCollectionService.js'
import { badRequest, notFound } from '../../platform/http/serviceErrors.js'
import {
  INVALID_CURSOR,
  INVALID_TODAY,
  parseListCursor,
  parseLocalDate,
} from '../../validators/common.js'
import { enrichPerTenant, loadFeedUserAvailability } from './mePlanningEnrichment.js'

const NOT_FOUND = notFound('Not found')

async function attachAvailability(db, userId, scope, rows, withDays = false) {
  const shared = await loadFeedUserAvailability(
    db, rows, (event) => event.start_date, (event) => event.end_date,
  )
  return enrichPerTenant(rows, (tenantId, events) => enrichEventsWithAvailability(db, tenantId, {
    tenantKind: scope.byId.get(tenantId)?.kind,
    viewer: { userId, tenantId },
    withDays,
    shared,
  }, events))
}

export function listMyBandEventsInRange(db, userId, scope, from, to) {
  return listBandEventsInRangeForMemberTenants(db, userId, scope.ids, from, to)
}

export async function listMyUpcomingBandEvents(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)

  const result = await limitedCollection(query.limit, (limit) =>
    listUpcomingBandEventsForMemberTenants(db, userId, scope.ids, today, limit))
  if (result.error) return result
  const items = await attachAvailability(db, userId, scope, result.items)
  return { ...result, items: items.map(scope.label) }
}

export async function listMyPastBandEvents(db, userId, scope, query = {}) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)
  const result = await limitedCollectionWithCursor(query.limit, (limit) =>
    listPastBandEventsForMemberTenants(db, userId, scope.ids, today, limit, parsedCursor.cursor),
  (event) => event.end_date)
  if (result.error) return result
  const items = await attachAvailability(db, userId, scope, result.items)
  return { ...result, items: items.map(scope.label) }
}

export async function getMyBandEvent(db, userId, scope, eventId) {
  const tenantId = await findBandEventTenantForMember(db, userId, scope.ids, eventId)
  if (tenantId == null) return NOT_FOUND
  const result = await getEvent(db, tenantId, eventId, {
    tenantKind: scope.byId.get(tenantId)?.kind, viewer: { userId, tenantId },
  })
  if (result.error) return NOT_FOUND
  return { event: scope.label(result.event) }
}
