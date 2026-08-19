// Gig domain logic. Route handlers stay thin and delegate here. Functions that
// can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload (see each function).
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { PERMISSIONS } from '../../auth/permissions.js'
import { computePurchaseLineTotals } from '../../../shared/purchaseTotals.js'
import { MAX_GIG_INFO_BLOCKS } from '../../../shared/gigInfoLabels.js'
import { uploadObjectWithQuota, removeObject, safeRemove, gigBannerKey, gigAttachmentKey } from '../../platform/files/storageService.js'
import { IMAGE_PROCESSING_PRESETS, validateAndReencodeImage, extensionForImageMime } from '../../utils/imageProcess.js'
import { verifyDocumentContent } from '../../utils/verifyFileContent.js'
import { dispatchNotification } from '../../user/notifications/notificationService.js'
import { logger } from '../../utils/logger.js'
import { renderGigItineraryPdf } from '../../utils/renderGigItineraryPdf.js'
import { loadTenantLogoBuffer } from '../../utils/tenantLogo.js'
import { sanitizeFilename } from '../../utils/sanitizeFilename.js'
import { createTask as createTaskService, patchTask as patchTaskService, removeTask as removeTaskService } from '../tasks/taskService.js'
import { loadAvailabilityMatrix } from '../availability/availabilityService.js'
import { prepareMatrix, summarizeSpan, withMembers } from '../../domain/availabilitySpan.js'
import {
  parseSearchLimit,
  toDateStr,
  venueDisplay,
  VALID_STATUSES,
  VALID_VOTES,
  normalizeGigVenueRefs,
  normalizeImportRow,
  buildGigUpdateFields,
  normalizeGigTagNames,
  normalizeGigCost,
  normalizeGigInfoBlock,
  normalizeGigInfoBlockPatch,
  normalizeGigTimetableEntry,
  normalizeGigTimetableEntryPatch,
  MAX_GIG_TAGS,
  MAX_GIG_TAG_LENGTH,
  MAX_GIG_COSTS,
  MAX_GIG_TIMETABLE_ENTRIES,
} from './gigValidators.js'
import {
  assertVenueInTenant,
  gigExistsInTenant,
  summarizeGigMerchSalesByVatRate,
  searchGigs as searchGigRows,
  fetchGigWithRelations,
  loadParticipants,
  listGigsWithTaskCounts,
  listUpcomingGigs as listUpcomingGigRows,
  listPastGigs as listPastGigRows,
  listGigsInRange as listGigsInRangeRows,
  listGigMapData as listGigMapRows,
  listGigTasks,
  listGigTasksWithAssignees,
  listGigAttachments,
  insertGigForImport,
  insertGigWithRelations,
  insertGigParticipant,
  deleteGigParticipant,
  lockGig,
  getGigParticipantRemovalState,
  updateParticipantVote,
  lockGigOptionResponseState,
  getGigParticipantResponseState,
  markGigFirstUnavailableNotified,
  touchGig,
  deleteGig as deleteGigRow,
  getGigBannerRow,
  listGigStorageKeys,
  setGigBannerPath,
  clearGigBannerPath,
  insertGigAttachment,
  deleteGigAttachment as deleteGigAttachmentRow,
  listGigCosts as listGigCostRows,
  countGigCosts,
  insertGigCost,
  updateGigCost,
  deleteGigCost as deleteGigCostRow,
  listGigInfoBlocks as listGigInfoBlockRows,
  countGigInfoBlocks,
  insertGigInfoBlock,
  updateGigInfoBlock,
  deleteGigInfoBlock as deleteGigInfoBlockRow,
  listGigTimetable as listGigTimetableRows,
  countGigTimetableEntries,
  listGigTimetableIds,
  insertGigTimetableEntry,
  updateGigTimetableEntry,
  moveGigTimetableEntry,
  deleteGigTimetableEntry as deleteGigTimetableEntryRow,
  getContactInTenant,
  listGigContacts as listGigContactRows,
  insertGigContact,
  lockGigContacts,
  clearPrimaryGigContact,
  setGigContactPrimary as setGigContactPrimaryRow,
  deleteGigContact,
  updateGigFields,
  searchGigTags as searchGigTagRows,
  loadGigTags,
  upsertGigTag,
  deleteGigTagLinks,
  insertGigTagLink,
} from './gigRepository.js'
import {
  bandMemberExistsInTenant,
  listLeadMemberIds,
} from '../../people/roster/bandMemberRepository.js'
import { getTaskById } from '../tasks/taskRepository.js'
import { fetchTenant } from '../../people/workspaces/tenantRepository.js'
import { listVenueContacts as listVenueContactRows } from '../../people/venues/venueRepository.js'
import { INVALID_CURSOR, INVALID_TODAY, MAX_RANGE_DAYS, parseLocalDate, parseListCursor } from '../../platform/http/requestValidators.js'
import { badRequest, notFound } from '../../platform/http/serviceErrors.js'
import { assertMyBandWritable } from '../../people/my-bands/myBandService.js'
import { LAST_PARTICIPANT } from '../shared/participantErrors.js'
import { normalizeSingleDayEventTiming } from '../shared/eventTiming.js'
import {
  limitedCollectionWithCursor,
  limitedCollectionWithTotal,
  windowedCollection,
} from '../../platform/collections/limitedCollectionService.js'

const NOT_FOUND = notFound('Not found')

// ---------- notifications ----------

function gigPushSummary(gig) {
  return [venueDisplay(gig.festival ?? gig.venue), toDateStr(gig.event_date)].filter(Boolean).join(' · ')
}

// Each notify* returns the dispatch promise so callers can await persistence
// (the in-app rows) without a failure ever reaching the HTTP response.
export function notifyGigCreated(tenantId, gig) {
  return dispatchNotification({
    tenantId,
    type: 'gig-new',
    title: 'New gig option',
    body: gigPushSummary(gig),
    url: '/gigs',
    sourceType: 'gig',
    sourceId: gig.id,
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))
}

export function notifyGigConfirmed(tenantId, gig) {
  return dispatchNotification({
    tenantId,
    type: 'gig-confirmed',
    title: 'Gig confirmed!',
    body: gigPushSummary(gig),
    url: '/gigs',
    sourceType: 'gig',
    sourceId: gig.id,
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))
}

export function notifyGigsImported(tenantId, count) {
  return dispatchNotification({
    tenantId,
    type: 'gig-import',
    title: `${count} gig${count === 1 ? '' : 's'} imported`,
    body: 'Your Bandsintown import is complete.',
    url: '/gigs',
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))
}

export function notifyGigOptionUnavailable(tenantId, gig) {
  return dispatchNotification({
    tenantId,
    type: 'option-member-unavailable',
    title: `One or more band members aren't available for option ${gig.event_description}`,
    body: gigPushSummary(gig),
    url: `/gigs/${gig.id}`,
    sourceType: 'gig',
    sourceId: gig.id,
    requiredPermission: PERMISSIONS.PLANNING_WRITE,
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))
}

export function notifyGigOptionResponsesComplete(tenantId, gig) {
  return dispatchNotification({
    tenantId,
    type: 'option-all-responded',
    title: `All required band members have responded for option ${gig.event_description}`,
    body: gigPushSummary(gig),
    url: `/gigs/${gig.id}`,
    sourceType: 'gig',
    sourceId: gig.id,
    requiredPermission: PERMISSIONS.PLANNING_WRITE,
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))
}

// ---------- internals ----------

// Validates venue_id/festival_id (when present in body) belong to the tenant and
// match the expected category. Returns { error, status } or {}.
async function validateVenueAndFestivalForTenant(db, body, tenantId) {
  try {
    if ('venue_id' in body) await assertVenueInTenant(db, body.venue_id, tenantId, 'venue')
    if ('festival_id' in body) await assertVenueInTenant(db, body.festival_id, tenantId, 'festival')
    return {}
  } catch (err) {
    if (err.status === 400) return { error: err.message, status: 400 }
    throw err
  }
}

// Composes the single-gig response shape shared by participant mutations.
async function withTasksAndParticipants(db, tenantId, gigId, gig) {
  const tasks = await listGigTasks(db, gigId, tenantId)
  const byGig = await loadParticipants(db, [gigId], tenantId)
  return { ...gig, tasks, participants: byGig.get(gigId) || [] }
}

// ---------- reads ----------

// Every gig with its open task count, for export, duplicate checks and gig
// pickers. Deliberately NOT availability-enriched: this feed is unbounded, so
// its window spans the tenant's whole history — the most expensive matrix the
// endpoint could build, for a verdict none of its callers render. The bounded
// feeds below (upcoming/past/range) are the ones that show the column.
export async function listGigs(db, tenantId) {
  return listGigsWithTaskCounts(db, tenantId)
}

// Attaches members_availability to gig rows. A gig is a single day, so this is
// the span rules (server/domain/availabilitySpan.js) applied to a span of one,
// over the same redacted matrix the availability grid reads — a linked member
// busy in another band shows up here too. One query for the whole batch.
// `shared` is the user-level half of the matrix, pre-fetched once when a caller
// enriches several bands at a time (the cross-tenant hub). Omitted, each call
// loads its own.
export async function enrichGigsWithAvailability(db, tenantId, gigs, viewer = null, shared = null) {
  if (!gigs.length) return []

  const dates = gigs.flatMap((gig) => [
    toDateStr(gig.event_date),
    toDateStr(gig.end_date) ?? toDateStr(gig.event_date),
  ]).filter(Boolean)
  if (!dates.length) return gigs.map((gig) => ({ ...gig, members_availability: [] }))
  const minDate = dates.reduce((a, b) => (a < b ? a : b))
  const maxDate = dates.reduce((a, b) => (a > b ? a : b))

  const [matrix, participantsByGig] = await Promise.all([
    loadAvailabilityMatrix(db, tenantId, minDate, maxDate, viewer, shared),
    loadParticipants(db, gigs.map((gig) => gig.id), tenantId),
  ])
  // Normalized and indexed once for the whole batch; each gig only evaluates
  // its own participants against it.
  const prepared = prepareMatrix(matrix)

  return gigs.map((gig) => {
    const dateStr = toDateStr(gig.event_date)
    if (!dateStr) return { ...gig, members_availability: [] }
    const endDateStr = toDateStr(gig.end_date) ?? dateStr
    const selected = new Set((participantsByGig.get(gig.id) ?? []).map((participant) => participant.band_member_id))
    const participants = matrix.members.filter((member) => selected.has(member.id))
    const { members } = summarizeSpan(withMembers(prepared, participants), dateStr, endDateStr, {
      start_date: dateStr,
      end_date: endDateStr,
      start_time: gig.start_time,
      end_time: gig.end_time,
      exclude: { type: 'gig', id: gig.id },
    })
    return { ...gig, members_availability: members }
  })
}

export async function listUpcomingGigs(db, tenantId, query = {}, viewer = null) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const result = await limitedCollectionWithTotal(query.limit, (limit) => listUpcomingGigRows(db, tenantId, today, limit))
  if (result.error) return result
  return { ...result, items: await enrichGigsWithAvailability(db, tenantId, result.items, viewer) }
}

// Past gigs, most recent first, capped and keyset-paginated via
// ?cursorDate=&cursorId= (never offset/page params) so "load more" can walk
// arbitrarily deep history without re-scanning already-seen rows.
export async function listPastGigs(db, tenantId, query = {}, viewer = null) {
  const today = parseLocalDate(query.today)
  if (today === null) return badRequest(INVALID_TODAY)
  const parsedCursor = parseListCursor(query)
  if (parsedCursor === null) return badRequest(INVALID_CURSOR)

  const result = await limitedCollectionWithCursor(query.limit, (limit) =>
    listPastGigRows(db, tenantId, today, limit, parsedCursor.cursor), (gig) => gig.event_date)
  if (result.error) return result

  return { ...result, items: await enrichGigsWithAvailability(db, tenantId, result.items, viewer) }
}

// Availability-enriched, so the window is capped — unlike the map read below,
// which is a single lean projection and spans all history on purpose.
export async function listGigsInRange(db, tenantId, query = {}, viewer = null) {
  return windowedCollection(query, async (range) =>
    enrichGigsWithAvailability(db, tenantId, await listGigsInRangeRows(db, tenantId, range.from, range.to), viewer),
  { maxDays: MAX_RANGE_DAYS })
}

export async function listGigMapData(db, tenantId, query = {}) {
  return windowedCollection(query, (range) =>
    listGigMapRows(db, tenantId, range.from, range.to))
}

// Global-search read: matches gigs on event name, venue/festival name or city,
// and linked gig tags.
// Mirrors searchVenues — short queries (<3 chars) return nothing so we don't
// run a wildcard scan on every keystroke.
export async function searchGigs(db, tenantId, query) {
  const q = String(query.q ?? '').trim()
  if (q.length < 3) return []
  return searchGigRows(db, tenantId, {
    like: `%${q}%`,
    limit: parseSearchLimit(query.limit),
  })
}

export async function searchGigTags(db, tenantId, query) {
  const q = String(query.q ?? '').trim()
  return searchGigTagRows(db, tenantId, q ? `%${q}%` : null)
}

export async function getGig(db, tenantId, gigId) {
  const gig = await fetchGigWithRelations(db, gigId, tenantId)
  if (!gig) return NOT_FOUND

  const tasks = await listGigTasks(db, gigId, tenantId)
  const attachments = await listGigAttachments(db, gigId, tenantId)
  const costs = await listGigCostRows(db, gigId, tenantId)
  const infoBlocks = await listGigInfoBlockRows(db, gigId, tenantId)
  const timetable = await listGigTimetableRows(db, gigId, tenantId)
  const byGig = await loadParticipants(db, [gigId], tenantId)
  return {
    gig: {
      ...gig, tasks, participants: byGig.get(gigId) || [], attachments, costs,
      info_blocks: infoBlocks, timetable,
    },
  }
}

// The itinerary PDF a band sends round before the show. Read-only and
// tenant-scoped like every other gig read, so a cross-tenant id 404s here
// rather than leaking that the gig exists.
//
// Contacts are NOT part of the gig detail payload (they have their own
// endpoint) and come from three places — see mergeItineraryContacts. Tasks are
// re-read with their assignee names resolved, because a server-rendered
// document has no roster to look them up in.
export async function getGigItineraryPdf(db, tenantId, gigId, { lng = 'en' } = {}) {
  const gig = await fetchGigWithRelations(db, gigId, tenantId)
  if (!gig) return NOT_FOUND

  const [gigContacts, venueContacts, festivalContacts, tasks, timetable, infoBlocks, tenant] =
    await Promise.all([
      listGigContactRows(db, gigId, tenantId),
      gig.venue_id ? listVenueContactRows(db, gig.venue_id, tenantId) : [],
      gig.festival_id ? listVenueContactRows(db, gig.festival_id, tenantId) : [],
      listGigTasksWithAssignees(db, gigId, tenantId),
      listGigTimetableRows(db, gigId, tenantId),
      listGigInfoBlockRows(db, gigId, tenantId),
      fetchTenant(db, tenantId),
    ])
  const contacts = mergeItineraryContacts({ gigContacts, venueContacts, festivalContacts })
  // The page is white, so this takes the ordinary light-background logo —
  // logo_dark_path is the variant for dark surfaces and would disappear here.
  const logoBuffer = await loadTenantLogoBuffer(tenant)

  const buffer = await renderGigItineraryPdf({
    gig, contacts, tasks, timetable, infoBlocks, logoBuffer, lng,
    // Signs the header when the tenant has no logo. display_name is the
    // kind-neutral name, so a personal workspace signs with its own.
    bandName: tenant?.display_name || tenant?.band_name || '',
  })
  return { pdf: { buffer, filename: itineraryFilename(gig) } }
}

// The Contacts tab reads three sources — the gig's own linked contacts plus the
// ones inherited from its venue and its festival — so the itinerary carries the
// same three, in the same order. Each contact appears once: a person linked
// both to the gig and to its venue is kept under the gig link, which is the one
// carrying the gig's own primary flag. `source` is null for those, matching the
// tab, where only inherited rows are tagged with where they came from.
function mergeItineraryContacts({ gigContacts, venueContacts, festivalContacts }) {
  const seen = new Set(gigContacts.map((contact) => contact.id))
  const inherited = (rows, source) => rows.flatMap((contact) => {
    if (seen.has(contact.id)) return []
    seen.add(contact.id)
    return [{ ...contact, source, is_primary: false }]
  })
  return [
    ...inherited(venueContacts, 'venue'),
    ...inherited(festivalContacts, 'festival'),
    ...gigContacts.map((contact) => ({ ...contact, source: null })),
  ]
}

// "itinerary-paradiso-night-09122026.pdf". sanitizeFilename is the
// Content-Disposition backstop; the slugging here is what keeps the name
// readable. Either half may be missing — an unnamed gig or one without a date
// still gets a valid name.
function itineraryFilename(gig) {
  const slug = String(gig.event_description || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
  // MMddYYYY, read off the 'YYYY-MM-DD' a DATE column returns.
  const date = toDateStr(gig.event_date)
  const stamp = date ? `${date.slice(5, 7)}${date.slice(8, 10)}${date.slice(0, 4)}` : null
  const parts = ['itinerary', slug, stamp].filter(Boolean)
  return sanitizeFilename(`${parts.join('-')}.pdf`)
}

// Total merch sold *at this gig*: units and the net (Excl. VAT) amount. Sales
// are stored gross (Incl. VAT) per row with a per-row rate, so net is derived
// per VAT-rate group and summed (HALF_UP via computePurchaseLineTotals). Returns
// 404 for a missing/cross-tenant gig so existence isn't leaked.
export async function gigMerchSummary(db, tenantId, gigId) {
  if (!(await gigExistsInTenant(db, gigId, tenantId))) return NOT_FOUND

  const groups = await summarizeGigMerchSalesByVatRate(db, tenantId, gigId)
  let unitsSold = 0
  let netCents = 0
  let grossCents = 0
  for (const g of groups) {
    unitsSold += g.qty
    grossCents += g.gross_cents
    netCents += computePurchaseLineTotals({ amount_incl_cents: g.gross_cents, tax_rate: g.vat_rate }).netCents
  }
  return { summary: { unitsSold, netCents, grossCents } }
}

// ---------- writes ----------

// Bulk import of normalized Bandsintown rows in one transaction; lead members
// are added as participants of every created gig. The caller fires the
// imported notification. Returns { error } | { created, skipped }.
export async function importGigs(tenantId, userId, body) {
  if (!Array.isArray(body) || body.length === 0) {
    return { error: { status: 400, body: { error: 'Expected non-empty array' } } }
  }
  if (body.length > 200) {
    return { error: { status: 400, body: { error: 'Maximum 200 gigs per import' } } }
  }

  return withTransaction(async (client) => {
    const leadIds = await listLeadMemberIds(client, tenantId)

    let created = 0
    let skipped = 0

    for (const item of body) {
      const parsed = normalizeImportRow(item)
      if (parsed.error) {
        abortTransaction({ error: { status: 400, body: { error: parsed.error } } })
      }
      if (parsed.skip) { skipped++; continue }
      const row = parsed.data

      const venueCheck = await validateVenueAndFestivalForTenant(
        client, { venue_id: row.venueId, festival_id: row.festivalId }, tenantId,
      )
      if (venueCheck.error) {
        abortTransaction({ error: { status: 400, body: { error: venueCheck.error } } })
      }

      const gigId = await insertGigForImport(client, tenantId, row)
      for (const memberId of leadIds) {
        await insertGigParticipant(client, tenantId, gigId, memberId, userId)
      }
      created++
    }

    return { created, skipped }
  })
}

// Creates a gig plus its initial lead-member participants in one transaction.
// The caller fires the created notification. Returns { error } | { gig }.
export async function createGig(tenantId, userId, body) {
  const { event_date, event_description } = body
  if (!event_date || !event_description) {
    return { error: { status: 400, body: { error: 'event_date and event_description are required' } } }
  }
  const timing = normalizeSingleDayEventTiming(body, null, 'event_date')
  if (timing.error) return badRequest(timing.error)
  const refs = normalizeGigVenueRefs(timing.body)
  if (refs.error) return { error: { status: 400, body: { error: refs.error } } }
  const normalizedBody = refs.body
  const { start_time, end_time, status } = normalizedBody
  const venueId = refs.body.venue_id ?? null
  const festivalId = refs.body.festival_id ?? null
  const finalStatus = VALID_STATUSES.includes(status) ? status : 'option'

  return withTransaction(async (client) => {
    const venueCheck = await validateVenueAndFestivalForTenant(
      client, { venue_id: venueId, festival_id: festivalId }, tenantId,
    )
    if (venueCheck.error) {
      abortTransaction({ error: { status: 400, body: { error: venueCheck.error } } })
    }
    // Holds the My Bands row for the rest of this transaction, so a concurrent
    // removal cannot turn this insert into a foreign-key violation.
    const bandCheck = await assertMyBandWritable(client, tenantId, normalizedBody.my_band_id)
    if (bandCheck) abortTransaction(bandCheck)

    const gig = await insertGigWithRelations(client, tenantId, {
      event_date, end_date: normalizedBody.end_date, event_description, venueId, festivalId,
      start_time: start_time || null, end_time: end_time || null, status: finalStatus,
      myBandId: normalizedBody.my_band_id ?? null,
    })

    const leadIds = await listLeadMemberIds(client, tenantId)
    for (const memberId of leadIds) {
      await insertGigParticipant(client, tenantId, gig.id, memberId, userId)
    }

    return { gig }
  })
}

// Validates and applies a gig PATCH. Returns { error } or { gig, confirmed } —
// `confirmed` is true when this PATCH set the status to confirmed; the caller
// fires the confirmed notification.
export async function patchGig(db, tenantId, gigId, body) {
  const refs = normalizeGigVenueRefs(body)
  if (refs.error) return { error: { status: 400, body: { error: refs.error } } }
  let normalizedBody = refs.body

  if (['event_date', 'end_date', 'start_time', 'end_time'].some((field) => field in normalizedBody)) {
    const current = await fetchGigWithRelations(db, gigId, tenantId)
    if (!current) return NOT_FOUND
    const timing = normalizeSingleDayEventTiming(normalizedBody, current, 'event_date')
    if (timing.error) return badRequest(timing.error)
    normalizedBody = timing.body
  }

  const venueCheck = await validateVenueAndFestivalForTenant(db, normalizedBody, tenantId)
  if (venueCheck.error) return { error: { status: venueCheck.status, body: { error: venueCheck.error } } }

  const built = buildGigUpdateFields(normalizedBody)
  if (built.error) return { error: { status: 400, body: { error: built.error } } }
  if (!built.fields.length) return { error: { status: 400, body: { error: 'No valid fields to update' } } }

  // In a transaction so the My Bands row stays locked from validation through
  // the write; the check is a no-op when the body doesn't mention the link.
  const result = await withTransaction(async (client) => {
    const bandCheck = await assertMyBandWritable(client, tenantId, normalizedBody.my_band_id)
    if (bandCheck) abortTransaction(bandCheck)

    const gig = await updateGigFields(client, tenantId, gigId, built.fields, built.values)
    if (!gig) abortTransaction(NOT_FOUND)
    return { gig }
  }, { db })

  if (result.error) return result
  return { gig: result.gig, confirmed: body.status === 'confirmed' }
}

// Replaces a gig's complete tag set. Tag rows remain available as suggestions
// after unlinking, so previously used tour/group names can be reused later.
export async function setGigTags(db, tenantId, gigId, body) {
  if (!Array.isArray(body?.tags)) {
    return { error: { status: 400, body: { error: 'tags must be an array' } } }
  }
  const names = normalizeGigTagNames(body.tags)
  if (names.length > MAX_GIG_TAGS) {
    return { error: { status: 400, body: { error: `Maximum ${MAX_GIG_TAGS} tags per gig` } } }
  }
  if (names.some((name) => name.length > MAX_GIG_TAG_LENGTH)) {
    return { error: { status: 400, body: { error: `Tags may be at most ${MAX_GIG_TAG_LENGTH} characters` } } }
  }

  return withTransaction(async (client) => {
    if (!(await gigExistsInTenant(client, gigId, tenantId))) abortTransaction(NOT_FOUND)

    const tagIds = []
    for (const name of names) tagIds.push(await upsertGigTag(client, tenantId, name))

    await deleteGigTagLinks(client, gigId, tenantId)
    for (const tagId of tagIds) await insertGigTagLink(client, gigId, tagId, tenantId)
    await touchGig(client, gigId, tenantId)
    return { tags: await loadGigTags(client, gigId, tenantId) }
  }, { db })
}

// Deletes the gig and reclaims every object it owns — the banner and each
// attachment, whose rows cascade away with the gig and whose keys are therefore
// unreachable once it is gone.
//
// Rows go in one transaction; objects are removed only after it commits. The
// order matters both ways: reading the keys inside the transaction stops a
// concurrent upload from being missed, and removing the objects outside it
// stops a rollback from leaving a surviving gig pointing at deleted files.
export async function deleteGig(db, tenantId, gigId) {
  const result = await withTransaction(async (client) => {
    const keys = await listGigStorageKeys(client, gigId, tenantId)
    if (keys === null) abortTransaction(NOT_FOUND)

    const deleted = await deleteGigRow(client, gigId, tenantId)
    if (!deleted) abortTransaction(NOT_FOUND)

    return { keys }
  }, { db })

  if (result.error) return result

  for (const key of result.keys) safeRemove(key, 'Failed to delete gig object:')
  return {}
}

// ---------- tasks ----------
//
// The gig-nested task routes delegate to taskService (the single task
// implementation). Each handler first enforces that the task is scoped to the
// gig in the URL — without the `task.gig_id !== gigId` check the unified service
// would let a caller mutate any of the tenant's tasks via an unrelated gig's URL.

export async function addGigTask(db, tenantId, gigId, body) {
  if (!(await gigExistsInTenant(db, gigId, tenantId))) return NOT_FOUND
  return createTaskService(db, tenantId, { ...body, gig_id: gigId })
}

export async function patchGigTask(db, tenantId, gigId, taskId, body, caller = {}) {
  const task = await getTaskById(db, taskId, tenantId)
  if (!task || task.gig_id !== gigId) return NOT_FOUND
  return patchTaskService(db, tenantId, taskId, body, caller)
}

export async function deleteGigTask(db, tenantId, gigId, taskId) {
  const task = await getTaskById(db, taskId, tenantId)
  if (!task || task.gig_id !== gigId) return NOT_FOUND
  return removeTaskService(db, tenantId, taskId)
}

// ---------- participants ----------

export async function addParticipant(db, tenantId, userId, gigId, memberId) {
  if (!(await bandMemberExistsInTenant(db, memberId, tenantId))) {
    return { error: { status: 404, body: { error: 'band_member not found' } } }
  }
  if (!(await gigExistsInTenant(db, gigId, tenantId))) return NOT_FOUND

  try {
    await insertGigParticipant(db, tenantId, gigId, memberId, userId)
  } catch (err) {
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'Already a participant' } } }
    }
    throw err
  }

  await touchGig(db, gigId, tenantId)
  const gig = await fetchGigWithRelations(db, gigId, tenantId)
  return { gig: await withTasksAndParticipants(db, tenantId, gigId, gig) }
}

export async function removeParticipant(db, tenantId, gigId, memberId) {
  return withTransaction(async (client) => {
    if (!(await lockGig(client, gigId, tenantId))) abortTransaction(NOT_FOUND)
    const state = await getGigParticipantRemovalState(client, gigId, memberId, tenantId)
    if (!state.target_exists) abortTransaction(NOT_FOUND)
    if (state.participant_count <= 1) abortTransaction(LAST_PARTICIPANT)
    if (!(await deleteGigParticipant(client, gigId, memberId, tenantId))) abortTransaction(NOT_FOUND)
    await touchGig(client, gigId, tenantId)
    return {}
  }, { db })
}

export async function setParticipantVote(db, tenantId, userId, gigId, memberId, body) {
  if (!('vote' in body)) return { error: { status: 400, body: { error: 'vote is required' } } }
  const vote = body.vote
  if (vote !== null && !VALID_VOTES.includes(vote)) {
    return { error: { status: 400, body: { error: 'Invalid vote value' } } }
  }

  const result = await withTransaction(async (client) => {
    const option = await lockGigOptionResponseState(client, gigId, tenantId)
    if (!option) return NOT_FOUND

    const responseState = await getGigParticipantResponseState(client, gigId, memberId, tenantId)
    if (!responseState) return NOT_FOUND

    const participant = await updateParticipantVote(client, tenantId, gigId, memberId, vote, userId)
    if (!participant) return NOT_FOUND

    const isOption = option.status === 'option'
    const firstUnavailable = isOption
      && vote === 'no'
      && option.first_unavailable_notification_at == null
    const allResponded = isOption
      && responseState.previous_vote == null
      && vote != null
      && responseState.total > 0
      && responseState.pending === 1

    if (firstUnavailable) await markGigFirstUnavailableNotified(client, gigId, tenantId)
    await touchGig(client, gigId, tenantId)
    const gig = await fetchGigWithRelations(client, gigId, tenantId)
    return {
      gig: await withTasksAndParticipants(client, tenantId, gigId, gig),
      notifications: { firstUnavailable, allResponded },
    }
  }, { db })

  if (result.error) return result

  // Dispatched here, after the commit, so no caller can forget to act on them.
  const { gig, notifications } = result
  if (notifications.firstUnavailable) await notifyGigOptionUnavailable(tenantId, gig)
  if (notifications.allResponded) await notifyGigOptionResponsesComplete(tenantId, gig)
  return { gig }
}

// ---------- banner ----------

// Replaces a gig banner: stores the new object, points the row at it, and
// removes the old object on success (or the new object on DB failure).
export async function replaceGigBanner(db, tenantId, gigId, file) {
  const image = await validateAndReencodeImage(file.buffer, file.mimetype, IMAGE_PROCESSING_PRESETS.banner)

  const before = await getGigBannerRow(db, gigId, tenantId)
  if (!before) return NOT_FOUND
  const oldKey = before.banner_path

  const ext = extensionForImageMime(image.mimetype)
  const objectKey = gigBannerKey(tenantId, randomUUID(), ext)

  await uploadObjectWithQuota(objectKey, image.buffer, image.size, image.mimetype)

  let updatedKey
  try {
    updatedKey = await setGigBannerPath(db, gigId, tenantId, objectKey)
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }

  safeRemove(oldKey, 'Failed to delete old gig banner object:')

  return { bannerPath: updatedKey }
}

export async function deleteGigBanner(db, tenantId, gigId) {
  const row = await getGigBannerRow(db, gigId, tenantId)
  if (!row) return NOT_FOUND

  await clearGigBannerPath(db, gigId, tenantId)

  safeRemove(row.banner_path, 'Failed to delete gig banner object:')
  return {}
}

// ---------- attachments ----------

// Verifies file content matches its declared MIME type (OWASP A06), stores the
// object, and records it. Removes the object if the DB insert fails.
export async function createGigAttachment(db, tenantId, gigId, file) {
  if (!(await gigExistsInTenant(db, gigId, tenantId))) return NOT_FOUND

  if (!verifyDocumentContent(file.buffer, file.mimetype)) {
    return { error: { status: 400, body: { error: 'File content does not match declared type' } } }
  }

  const ext = path.extname(file.originalname).toLowerCase()
  const objectKey = gigAttachmentKey(tenantId, randomUUID(), ext)

  await uploadObjectWithQuota(objectKey, file.buffer, file.size, file.mimetype)

  try {
    const attachment = await insertGigAttachment(db, tenantId, gigId, file, objectKey)
    return { attachment }
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }
}

export async function deleteGigAttachment(db, tenantId, gigId, attachmentId) {
  const objectKey = await deleteGigAttachmentRow(db, attachmentId, gigId, tenantId)
  if (objectKey === null) return NOT_FOUND

  safeRemove(objectKey, 'Failed to delete gig attachment object:')
  return {}
}

// ---------- gig contacts (mirrors venue_contacts; links are informational) ----------

// ---------- costs ----------

// The artist's own costs for a gig, itemised. Their sum is the "Costs" row of
// the artist statement; the statement itself is derived on the frontend.

export async function listGigCosts(db, tenantId, gigId) {
  if (!(await gigExistsInTenant(db, gigId, tenantId))) return NOT_FOUND
  return { costs: await listGigCostRows(db, gigId, tenantId) }
}

export async function addGigCost(db, tenantId, gigId, body) {
  const parsed = normalizeGigCost(body)
  if (parsed.error) return badRequest(parsed.error)

  return withTransaction(async (client) => {
    // Locked read-then-insert: two concurrent adds must not both see room for
    // the last line and push the gig one over the cap.
    if (!(await lockGig(client, gigId, tenantId))) abortTransaction(NOT_FOUND)
    if (await countGigCosts(client, gigId, tenantId) >= MAX_GIG_COSTS) {
      abortTransaction(badRequest(`A gig can have at most ${MAX_GIG_COSTS} cost lines`))
    }
    const cost = await insertGigCost(client, gigId, tenantId, parsed.data)
    await touchGig(client, gigId, tenantId)
    return { cost }
  }, { db })
}

export async function patchGigCost(db, tenantId, gigId, costId, body) {
  const parsed = normalizeGigCost(body)
  if (parsed.error) return badRequest(parsed.error)

  const cost = await updateGigCost(db, gigId, costId, tenantId, parsed.data)
  if (!cost) return NOT_FOUND
  await touchGig(db, gigId, tenantId)
  return { cost }
}

export async function removeGigCost(db, tenantId, gigId, costId) {
  if (!(await deleteGigCostRow(db, gigId, costId, tenantId))) return NOT_FOUND
  await touchGig(db, gigId, tenantId)
  return {}
}

// ---------- info blocks ----------

// The gig's "Additional information": labelled multi-line text blocks shown on
// the Tasks tab. The Remarks block every gig starts with is rendered by the
// frontend whether or not a row exists yet, and created on first keystroke.

export async function listGigInfoBlocks(db, tenantId, gigId) {
  if (!(await gigExistsInTenant(db, gigId, tenantId))) return NOT_FOUND
  return { infoBlocks: await listGigInfoBlockRows(db, gigId, tenantId) }
}

export async function addGigInfoBlock(db, tenantId, gigId, body) {
  const parsed = normalizeGigInfoBlock(body)
  if (parsed.error) return badRequest(parsed.error)

  return withTransaction(async (client) => {
    // Locked read-then-insert: two concurrent adds must not both see room for
    // the last block and push the gig one over the cap.
    if (!(await lockGig(client, gigId, tenantId))) abortTransaction(NOT_FOUND)
    if (await countGigInfoBlocks(client, gigId, tenantId) >= MAX_GIG_INFO_BLOCKS) {
      abortTransaction(badRequest(`A gig can have at most ${MAX_GIG_INFO_BLOCKS} information blocks`))
    }
    const infoBlock = await insertGigInfoBlock(client, gigId, tenantId, parsed.data)
    await touchGig(client, gigId, tenantId)
    return { infoBlock }
  }, { db })
}

export async function patchGigInfoBlock(db, tenantId, gigId, blockId, body) {
  const parsed = normalizeGigInfoBlockPatch(body)
  if (parsed.error) return badRequest(parsed.error)

  const infoBlock = await updateGigInfoBlock(db, gigId, blockId, tenantId, parsed.data)
  if (!infoBlock) return NOT_FOUND
  await touchGig(db, gigId, tenantId)
  return { infoBlock }
}

export async function removeGigInfoBlock(db, tenantId, gigId, blockId) {
  if (!(await deleteGigInfoBlockRow(db, gigId, blockId, tenantId))) return NOT_FOUND
  await touchGig(db, gigId, tenantId)
  return {}
}

// ---------- timetable ----------

// The gig day's running order: get-in, soundcheck, doors, stage time, … Each
// line is a row so it can be dragged into place; a blank line is legitimate,
// because the UI persists a line the moment it is added.

export async function listGigTimetable(db, tenantId, gigId) {
  if (!(await gigExistsInTenant(db, gigId, tenantId))) return NOT_FOUND
  return { timetable: await listGigTimetableRows(db, gigId, tenantId) }
}

export async function addGigTimetableEntry(db, tenantId, gigId, body) {
  const parsed = normalizeGigTimetableEntry(body)
  if (parsed.error) return badRequest(parsed.error)

  return withTransaction(async (client) => {
    // Locked read-then-insert: two concurrent adds must not both see room for
    // the last line and push the gig one over the cap.
    if (!(await lockGig(client, gigId, tenantId))) abortTransaction(NOT_FOUND)
    if (await countGigTimetableEntries(client, gigId, tenantId) >= MAX_GIG_TIMETABLE_ENTRIES) {
      abortTransaction(badRequest(`A gig can have at most ${MAX_GIG_TIMETABLE_ENTRIES} timetable lines`))
    }
    const entry = await insertGigTimetableEntry(client, gigId, tenantId, parsed.data)
    await touchGig(client, gigId, tenantId)
    return { entry }
  }, { db })
}

export async function patchGigTimetableEntry(db, tenantId, gigId, entryId, body) {
  const parsed = normalizeGigTimetableEntryPatch(body)
  if (parsed.error) return badRequest(parsed.error)

  const entry = await updateGigTimetableEntry(db, gigId, entryId, tenantId, parsed.data)
  if (!entry) return NOT_FOUND
  await touchGig(db, gigId, tenantId)
  return { entry }
}

export async function removeGigTimetableEntry(db, tenantId, gigId, entryId) {
  if (!(await deleteGigTimetableEntryRow(db, gigId, entryId, tenantId))) return NOT_FOUND
  await touchGig(db, gigId, tenantId)
  return {}
}

// The client sends the whole order it now shows. Anything but an exact
// permutation of the stored lines means it was working from a stale list, so
// the write is refused rather than half-applied.
export async function reorderGigTimetable(db, tenantId, gigId, orderedEntryIds) {
  return withTransaction(async (client) => {
    if (!(await lockGig(client, gigId, tenantId))) abortTransaction(NOT_FOUND)
    const current = await listGigTimetableIds(client, gigId, tenantId)
    const currentIds = new Set(current)
    const unique = new Set(orderedEntryIds)
    if (unique.size !== orderedEntryIds.length
      || currentIds.size !== orderedEntryIds.length
      || orderedEntryIds.some((id) => !currentIds.has(id))) {
      abortTransaction(badRequest('Timetable ids do not match current state'))
    }
    for (let idx = 0; idx < orderedEntryIds.length; idx++) {
      await moveGigTimetableEntry(client, orderedEntryIds[idx], idx, gigId, tenantId)
    }
    await touchGig(client, gigId, tenantId)
    return {}
  }, { db })
}

export async function listGigContacts(db, tenantId, gigId) {
  if (!(await gigExistsInTenant(db, gigId, tenantId))) return NOT_FOUND
  return { contacts: await listGigContactRows(db, gigId, tenantId) }
}

export async function addGigContact(db, tenantId, gigId, contactId) {
  if (!(await gigExistsInTenant(db, gigId, tenantId))) return NOT_FOUND
  const contact = await getContactInTenant(db, contactId, tenantId)
  if (!contact) return NOT_FOUND

  try {
    await insertGigContact(db, gigId, contactId, tenantId)
  } catch (err) {
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'Contact is already linked to this gig' } } }
    }
    throw err
  }
  return { contact: { ...contact, is_primary: false } }
}

// Toggles a contact's primary flag inside a transaction; at most one contact
// per gig can be primary, so making one primary first clears the others.
export async function setGigContactPrimary(tenantId, gigId, contactId, makePrimary) {
  return withTransaction(async (client) => {
    const linkedIds = await lockGigContacts(client, gigId, tenantId)
    if (!linkedIds.includes(contactId)) abortTransaction(NOT_FOUND)

    if (makePrimary) {
      await clearPrimaryGigContact(client, gigId, tenantId)
    }

    return { link: await setGigContactPrimaryRow(client, gigId, contactId, makePrimary, tenantId) }
  }, {
    mapError: (err) => (err.code === '23505'
      ? { error: { status: 409, body: { error: 'Another contact is already primary' } } }
      : null),
  })
}

export async function removeGigContact(db, tenantId, gigId, contactId) {
  const removed = await deleteGigContact(db, gigId, contactId, tenantId)
  return removed ? {} : NOT_FOUND
}
