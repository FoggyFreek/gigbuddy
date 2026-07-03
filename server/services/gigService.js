// Gig domain logic. Route handlers stay thin and delegate here. Functions that
// can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload (see each function).
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import pool from '../db/index.js'
import { computePurchaseLineTotals } from '../../shared/purchaseTotals.js'
import { uploadObject, removeObject, safeRemove, gigBannerKey, gigAttachmentKey } from './storageService.js'
import { IMAGE_PROCESSING_PRESETS, validateAndReencodeImage, extensionForImageMime } from '../utils/imageProcess.js'
import { verifyDocumentContent } from '../utils/verifyFileContent.js'
import { dispatchNotification } from './notificationService.js'
import { logger } from '../utils/logger.js'
import { createTask as createTaskService, patchTask as patchTaskService, removeTask as removeTaskService } from './taskService.js'
import {
  parseSearchLimit,
  toDateStr,
  venueDisplay,
  VALID_STATUSES,
  VALID_VOTES,
  normalizeGigVenueRefs,
  normalizeImportRow,
  buildGigUpdateFields,
} from '../validators/gigValidators.js'
import {
  assertVenueInTenant,
  memberExistsInTenant,
  gigExistsInTenant,
  summarizeGigMerchSalesByVatRate,
  searchGigs as searchGigRows,
  fetchGigWithRelations,
  loadParticipants,
  listGigsWithTaskCounts,
  listBandMembers,
  listAvailabilitySlotsOverlapping,
  listGigTasks,
  listGigAttachments,
  getLeadMemberIds,
  insertGigForImport,
  insertGigWithRelations,
  insertGigParticipant,
  deleteGigParticipant,
  updateParticipantVote,
  touchGig,
  deleteGig as deleteGigRow,
  getGigBannerRow,
  setGigBannerPath,
  clearGigBannerPath,
  insertGigAttachment,
  deleteGigAttachment as deleteGigAttachmentRow,
  getContactInTenant,
  listGigContacts as listGigContactRows,
  insertGigContact,
  lockGigContacts,
  clearPrimaryGigContact,
  setGigContactPrimary as setGigContactPrimaryRow,
  deleteGigContact,
  updateGigFields,
} from '../repositories/gigRepository.js'
import { getTaskById } from '../repositories/taskRepository.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'Not found' } } }

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

// Lists all gigs with open task counts and per-member availability derived from
// availability_slots (a band-wide slot wins over a member-specific one).
export async function listGigs(db, tenantId) {
  const gigs = await listGigsWithTaskCounts(db, tenantId)
  if (!gigs.length) return []

  const members = await listBandMembers(db, tenantId)

  const dates = gigs.map((g) => toDateStr(g.event_date)).filter(Boolean)
  const minDate = dates.reduce((a, b) => (a < b ? a : b))
  const maxDate = dates.reduce((a, b) => (a > b ? a : b))

  const slots = await listAvailabilitySlotsOverlapping(db, tenantId, minDate, maxDate)

  return gigs.map((gig) => {
    const dateStr = toDateStr(gig.event_date)
    if (!dateStr) return { ...gig, members_availability: [] }

    const gigSlots = slots.filter(
      (s) => toDateStr(s.start_date) <= dateStr && toDateStr(s.end_date) >= dateStr,
    )
    const bandWide = gigSlots.findLast((s) => s.band_member_id === null) ?? null

    const membersAvail = members.map((m) => {
      const memberSlot = gigSlots.findLast((s) => s.band_member_id === m.id)
      const winner = bandWide ?? memberSlot
      return {
        member_id: m.id,
        name: m.name,
        color: m.color,
        position: m.position,
        status: winner ? winner.status : 'default',
        reason: winner?.reason ?? null,
      }
    })

    return { ...gig, members_availability: membersAvail }
  })
}

// Global-search read: matches gigs on event name, venue/festival name or city.
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

export async function getGig(db, tenantId, gigId) {
  const gig = await fetchGigWithRelations(db, gigId, tenantId)
  if (!gig) return NOT_FOUND

  const tasks = await listGigTasks(db, gigId, tenantId)
  const attachments = await listGigAttachments(db, gigId, tenantId)
  const byGig = await loadParticipants(db, [gigId], tenantId)
  return { gig: { ...gig, tasks, participants: byGig.get(gigId) || [], attachments } }
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

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const leadIds = await getLeadMemberIds(client, tenantId)

    let created = 0
    let skipped = 0

    for (const item of body) {
      const parsed = normalizeImportRow(item)
      if (parsed.error) {
        await client.query('ROLLBACK')
        return { error: { status: 400, body: { error: parsed.error } } }
      }
      if (parsed.skip) { skipped++; continue }
      const row = parsed.data

      const venueCheck = await validateVenueAndFestivalForTenant(
        client, { venue_id: row.venueId, festival_id: row.festivalId }, tenantId,
      )
      if (venueCheck.error) {
        await client.query('ROLLBACK')
        return { error: { status: 400, body: { error: venueCheck.error } } }
      }

      const gigId = await insertGigForImport(client, tenantId, row)
      for (const memberId of leadIds) {
        await insertGigParticipant(client, tenantId, gigId, memberId, userId)
      }
      created++
    }

    await client.query('COMMIT')
    return { created, skipped }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Creates a gig plus its initial lead-member participants in one transaction.
// The caller fires the created notification. Returns { error } | { gig }.
export async function createGig(tenantId, userId, body) {
  const {
    event_date, event_description, start_time, end_time, status,
    has_pa_system, has_drumkit, has_stage_lights,
  } = body
  if (!event_date || !event_description) {
    return { error: { status: 400, body: { error: 'event_date and event_description are required' } } }
  }
  const refs = normalizeGigVenueRefs(body)
  if (refs.error) return { error: { status: 400, body: { error: refs.error } } }
  const venueId = refs.body.venue_id ?? null
  const festivalId = refs.body.festival_id ?? null
  const finalStatus = VALID_STATUSES.includes(status) ? status : 'option'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const venueCheck = await validateVenueAndFestivalForTenant(
      client, { venue_id: venueId, festival_id: festivalId }, tenantId,
    )
    if (venueCheck.error) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: venueCheck.error } } }
    }

    const gig = await insertGigWithRelations(client, tenantId, {
      event_date, event_description, venueId, festivalId,
      start_time: start_time || null, end_time: end_time || null, status: finalStatus,
      has_pa_system: !!has_pa_system, has_drumkit: !!has_drumkit, has_stage_lights: !!has_stage_lights,
    })

    const leadIds = await getLeadMemberIds(client, tenantId)
    for (const memberId of leadIds) {
      await insertGigParticipant(client, tenantId, gig.id, memberId, userId)
    }

    await client.query('COMMIT')
    return { gig }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Validates and applies a gig PATCH. Returns { error } or { gig, confirmed } —
// `confirmed` is true when this PATCH set the status to confirmed; the caller
// fires the confirmed notification.
export async function patchGig(db, tenantId, gigId, body) {
  const refs = normalizeGigVenueRefs(body)
  if (refs.error) return { error: { status: 400, body: { error: refs.error } } }
  const normalizedBody = refs.body

  const venueCheck = await validateVenueAndFestivalForTenant(db, normalizedBody, tenantId)
  if (venueCheck.error) return { error: { status: venueCheck.status, body: { error: venueCheck.error } } }

  const built = buildGigUpdateFields(normalizedBody)
  if (built.error) return { error: { status: 400, body: { error: built.error } } }
  if (!built.fields.length) return { error: { status: 400, body: { error: 'No valid fields to update' } } }

  const gig = await updateGigFields(db, tenantId, gigId, built.fields, built.values)
  if (!gig) return NOT_FOUND
  return { gig, confirmed: body.status === 'confirmed' }
}

// Deletes the gig and removes its banner object from storage.
export async function deleteGig(db, tenantId, gigId) {
  const row = await getGigBannerRow(db, gigId, tenantId)
  if (!row) return NOT_FOUND

  const deleted = await deleteGigRow(db, gigId, tenantId)
  if (!deleted) return NOT_FOUND

  safeRemove(row.banner_path, 'Failed to delete gig banner object:')
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
  if (!(await memberExistsInTenant(db, memberId, tenantId))) {
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
  const removed = await deleteGigParticipant(db, gigId, memberId, tenantId)
  if (!removed) return NOT_FOUND
  await touchGig(db, gigId, tenantId)
  return {}
}

export async function setParticipantVote(db, tenantId, userId, gigId, memberId, body) {
  if (!('vote' in body)) return { error: { status: 400, body: { error: 'vote is required' } } }
  const vote = body.vote
  if (vote !== null && !VALID_VOTES.includes(vote)) {
    return { error: { status: 400, body: { error: 'Invalid vote value' } } }
  }

  const participant = await updateParticipantVote(db, tenantId, gigId, memberId, vote, userId)
  if (!participant) return NOT_FOUND

  await touchGig(db, gigId, tenantId)
  const gig = await fetchGigWithRelations(db, gigId, tenantId)
  return { gig: await withTasksAndParticipants(db, tenantId, gigId, gig) }
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

  await uploadObject(objectKey, image.buffer, image.size, image.mimetype)

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

  await uploadObject(objectKey, file.buffer, file.size, file.mimetype)

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
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const linkedIds = await lockGigContacts(client, gigId, tenantId)
    if (!linkedIds.includes(contactId)) {
      await client.query('ROLLBACK')
      return NOT_FOUND
    }

    if (makePrimary) {
      await clearPrimaryGigContact(client, gigId, tenantId)
    }

    const link = await setGigContactPrimaryRow(client, gigId, contactId, makePrimary, tenantId)
    await client.query('COMMIT')
    return { link }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'Another contact is already primary' } } }
    }
    throw err
  } finally {
    client.release()
  }
}

export async function removeGigContact(db, tenantId, gigId, contactId) {
  const removed = await deleteGigContact(db, gigId, contactId, tenantId)
  return removed ? {} : NOT_FOUND
}
