import { Router } from 'express'
import multer from 'multer'
import pool from '../../db/index.js'
import { requirePermission } from '../../middleware/permissions.js'
import { PERMISSIONS } from '../../auth/permissions.js'
import { parseId, parseOrderedTimetableIds } from './gigValidators.js'
import { requireParam, sendError, viewerOf } from '../../platform/http/routeHelpers.js'
import { normalizeDocumentLng } from '../../utils/documentI18n.js'
import {
  listGigs,
  listUpcomingGigs,
  listPastGigs,
  listGigsInRange,
  listGigMapData,
  searchGigs,
  searchGigTags,
  getGig,
  getGigItineraryPdf,
  getGigArtistSettlementPdf,
  getGigContractPdf,
  gigMerchSummary,
  importGigs,
  createGig,
  patchGig,
  setGigTags,
  deleteGig,
  addGigTask,
  patchGigTask,
  deleteGigTask,
  addParticipant,
  removeParticipant,
  setParticipantVote,
  replaceGigBanner,
  deleteGigBanner,
  createGigAttachment,
  deleteGigAttachment,
  listGigCosts,
  addGigCost,
  patchGigCost,
  removeGigCost,
  listGigInfoBlocks,
  addGigInfoBlock,
  patchGigInfoBlock,
  removeGigInfoBlock,
  listGigTimetable,
  addGigTimetableEntry,
  patchGigTimetableEntry,
  removeGigTimetableEntry,
  reorderGigTimetable,
  listGigContacts,
  addGigContact,
  setGigContactPrimary,
  removeGigContact,
  notifyGigCreated,
  notifyGigConfirmed,
  notifyGigsImported,
} from './gigService.js'

const BANNER_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

const ATTACHMENT_ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
])
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
})

const router = Router()

// Every gig with its open task count — the export / duplicate-check / picker
// feed. No member availability: see listGigs.
router.get('/', async (req, res) => {
  res.json(await listGigs(pool, req.tenantId))
})

router.get('/upcoming', async (req, res) => {
  const result = await listUpcomingGigs(pool, req.tenantId, req.query, viewerOf(req))
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Past gigs, most recent first. Bounded + keyset-paginated (?cursorDate=&cursorId=)
// for "load more" — see listPastGigs in gigService.js.
router.get('/past', async (req, res) => {
  const result = await listPastGigs(pool, req.tenantId, req.query, viewerOf(req))
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Calendar month read: gigs inside the inclusive ?from=&to= day window.
router.get('/range', async (req, res) => {
  const result = await listGigsInRange(pool, req.tenantId, req.query, viewerOf(req))
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Past-gig world map: minimal venue/festival projection in an inclusive date window.
router.get('/map', async (req, res) => {
  const result = await listGigMapData(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Global search (min 3 chars): event, venue/festival, city, or gig tag.
router.get('/search', async (req, res) => {
  res.json(await searchGigs(pool, req.tenantId, req.query))
})

// Registered before /:id so the literal path is not captured as an id.
router.get('/tags', async (req, res) => {
  res.json(await searchGigTags(pool, req.tenantId, req.query))
})

// Get single gig with tasks, participants, and attachments
router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getGig(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.gig)
})

// The itinerary PDF. A plain tenant-scoped read — any approved member may hand
// the band its running order — streamed straight back rather than stored, since
// it is derived from the gig and stale the moment the gig changes.
router.get('/:id/itinerary.pdf', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const lng = normalizeDocumentLng(req.query.lng)
  const result = await getGigItineraryPdf(pool, req.tenantId, id, { lng })
  if (result.error) return sendError(res, result.error)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${result.pdf.filename}"`)
  res.send(result.pdf.buffer)
})

// The artist settlement contains deal finances, so unlike the itinerary it is
// only available to members who may view finance.
router.get('/:id/artist-settlement.pdf', requirePermission(PERMISSIONS.FINANCE_VIEW), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const lng = normalizeDocumentLng(req.query.lng)
  const result = await getGigArtistSettlementPdf(pool, req.tenantId, id, { lng })
  if (result.error) return sendError(res, result.error)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${result.pdf.filename}"`)
  res.send(result.pdf.buffer)
})

// The contract contains the same deal finances and is likewise generated live
// for finance viewers instead of being persisted as a versioned document.
router.get('/:id/contract.pdf', requirePermission(PERMISSIONS.FINANCE_VIEW), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const lng = normalizeDocumentLng(req.query.lng)
  const result = await getGigContractPdf(pool, req.tenantId, id, { lng })
  if (result.error) return sendError(res, result.error)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${result.pdf.filename}"`)
  res.send(result.pdf.buffer)
})

// Merch-sold totals are part of the finance-only Terms section.
router.get('/:id/merch-summary', requirePermission(PERMISSIONS.FINANCE_VIEW), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await gigMerchSummary(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.summary)
})

// Bulk import gigs from Bandsintown CSV export
router.post('/import', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await importGigs(req.tenantId, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json({ created: result.created, skipped: result.skipped })
  if (result.created > 0) await notifyGigsImported(req.tenantId, result.created)
})

// Create gig
router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createGig(req.tenantId, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.gig)
  await notifyGigCreated(req.tenantId, result.gig)
})

// Update gig (partial)
router.patch('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchGig(pool, req.tenantId, id, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.json(result.gig)
  if (result.confirmed) await notifyGigConfirmed(req.tenantId, result.gig)
})

// Delete gig
router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteGig(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// --- Banner ---

// Upload / replace gig banner
router.post('/:id/banner', requirePermission(PERMISSIONS.PLANNING_WRITE), bannerUpload.single('banner'), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!BANNER_ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }

  const result = await replaceGigBanner(pool, req.tenantId, id, req.file)
  if (result.error) return sendError(res, result.error)
  res.json({ banner_path: result.bannerPath })
})

// Delete gig banner
router.delete('/:id/banner', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteGigBanner(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// --- Attachments ---

router.post('/:id/attachments', requirePermission(PERMISSIONS.PLANNING_WRITE), attachmentUpload.single('file'), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!ATTACHMENT_ALLOWED_TYPES.has(req.file.mimetype))
    return res.status(400).json({ error: 'File type not allowed' })

  const result = await createGigAttachment(pool, req.tenantId, id, req.file)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.attachment)
})

router.delete('/:id/attachments/:attachmentId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const attachmentId = requireParam(req, res, 'attachmentId'); if (attachmentId === null) return
  const result = await deleteGigAttachment(pool, req.tenantId, id, attachmentId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// --- Tasks ---

// Add task to gig
router.post('/:id/tasks', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const gigId = requireParam(req, res, 'id'); if (gigId === null) return
  const result = await addGigTask(pool, req.tenantId, gigId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.task)
})

// Update task. Readers may toggle `done` on their own assigned task; the
// self-scope is enforced in the service via the caller context below.
router.patch('/:id/tasks/:taskId', requirePermission(PERMISSIONS.TASK_COMPLETE_SELF), async (req, res) => {
  const gigId = requireParam(req, res, 'id'); if (gigId === null) return
  const taskId = requireParam(req, res, 'taskId'); if (taskId === null) return
  const caller = { role: req.membership?.role, isSuperAdmin: !!req.user?.is_super_admin, userId: req.user.id }
  const result = await patchGigTask(pool, req.tenantId, gigId, taskId, req.body || {}, caller)
  if (result.error) return sendError(res, result.error)
  res.json(result.task)
})

// Delete task
router.delete('/:id/tasks/:taskId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const gigId = requireParam(req, res, 'id'); if (gigId === null) return
  const taskId = requireParam(req, res, 'taskId'); if (taskId === null) return
  const result = await deleteGigTask(pool, req.tenantId, gigId, taskId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// --- Participants ---

// Add participant
router.post('/:id/participants', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const gigId = requireParam(req, res, 'id'); if (gigId === null) return
  const memberId = parseId(req.body.band_member_id)
  if (memberId === null) return res.status(400).json({ error: 'Invalid band_member_id' })

  const result = await addParticipant(pool, req.tenantId, req.user.id, gigId, memberId)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.gig)
})

// Remove participant
router.delete('/:id/participants/:bandMemberId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const gigId = requireParam(req, res, 'id'); if (gigId === null) return
  const memberId = requireParam(req, res, 'bandMemberId'); if (memberId === null) return
  const result = await removeParticipant(pool, req.tenantId, gigId, memberId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Update participant vote (gig availability) — a planning write.
router.patch('/:id/participants/:bandMemberId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const gigId = requireParam(req, res, 'id'); if (gigId === null) return
  const memberId = requireParam(req, res, 'bandMemberId'); if (memberId === null) return
  const result = await setParticipantVote(pool, req.tenantId, req.user.id, gigId, memberId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.gig)
})

router.put('/:id/tags', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await setGigTags(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.tags)
})

// --- Gig costs (the artist's own costs; summed into the artist statement) ---

router.get('/:id/costs', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await listGigCosts(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.costs)
})

router.post('/:id/costs', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await addGigCost(pool, req.tenantId, id, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.cost)
})

router.patch('/:id/costs/:costId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const costId = requireParam(req, res, 'costId'); if (costId === null) return
  const result = await patchGigCost(pool, req.tenantId, id, costId, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.json(result.cost)
})

router.delete('/:id/costs/:costId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const costId = requireParam(req, res, 'costId'); if (costId === null) return
  const result = await removeGigCost(pool, req.tenantId, id, costId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// --- Gig info blocks ("Additional information" on the Tasks tab) ---

router.get('/:id/info-blocks', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await listGigInfoBlocks(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.infoBlocks)
})

router.post('/:id/info-blocks', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await addGigInfoBlock(pool, req.tenantId, id, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.infoBlock)
})

router.patch('/:id/info-blocks/:blockId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const blockId = requireParam(req, res, 'blockId'); if (blockId === null) return
  const result = await patchGigInfoBlock(pool, req.tenantId, id, blockId, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.json(result.infoBlock)
})

router.delete('/:id/info-blocks/:blockId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const blockId = requireParam(req, res, 'blockId'); if (blockId === null) return
  const result = await removeGigInfoBlock(pool, req.tenantId, id, blockId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// --- Gig timetable (the gig day's running order, on the Tasks tab) ---

router.get('/:id/timetable', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await listGigTimetable(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.timetable)
})

router.post('/:id/timetable', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await addGigTimetableEntry(pool, req.tenantId, id, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.entry)
})

// Registered before '/:id/timetable/:entryId' so 'reorder' isn't taken as an id.
router.patch('/:id/timetable/reorder', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const parsed = parseOrderedTimetableIds(req.body || {})
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  const result = await reorderGigTimetable(pool, req.tenantId, id, parsed.orderedEntryIds)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

router.patch('/:id/timetable/:entryId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const entryId = requireParam(req, res, 'entryId'); if (entryId === null) return
  const result = await patchGigTimetableEntry(pool, req.tenantId, id, entryId, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.json(result.entry)
})

router.delete('/:id/timetable/:entryId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const entryId = requireParam(req, res, 'entryId'); if (entryId === null) return
  const result = await removeGigTimetableEntry(pool, req.tenantId, id, entryId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// --- Gig contacts (mirrors venue_contacts; links are informational) ---

router.get('/:id/contacts', async (req, res) => {
  const gigId = requireParam(req, res, 'id'); if (gigId === null) return
  const result = await listGigContacts(pool, req.tenantId, gigId)
  if (result.error) return sendError(res, result.error)
  res.json(result.contacts)
})

router.post('/:id/contacts', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const gigId = requireParam(req, res, 'id'); if (gigId === null) return
  const contactId = parseId(req.body.contact_id)
  if (contactId === null) return res.status(400).json({ error: 'contact_id is required' })

  const result = await addGigContact(pool, req.tenantId, gigId, contactId)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.contact)
})

router.patch('/:id/contacts/:contactId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const gigId = requireParam(req, res, 'id'); if (gigId === null) return
  const contactId = requireParam(req, res, 'contactId'); if (contactId === null) return

  if (typeof req.body.is_primary !== 'boolean') {
    return res.status(400).json({ error: 'is_primary (boolean) is required' })
  }

  const result = await setGigContactPrimary(req.tenantId, gigId, contactId, req.body.is_primary)
  if (result.error) return sendError(res, result.error)
  res.json(result.link)
})

router.delete('/:id/contacts/:contactId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const gigId = requireParam(req, res, 'id'); if (gigId === null) return
  const contactId = requireParam(req, res, 'contactId'); if (contactId === null) return
  const result = await removeGigContact(pool, req.tenantId, gigId, contactId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
