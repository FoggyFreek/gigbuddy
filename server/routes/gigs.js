import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { parseId } from '../validators/gigValidators.js'
import {
  listGigs,
  searchGigs,
  getGig,
  gigMerchSummary,
  importGigs,
  createGig,
  patchGig,
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
  listGigContacts,
  addGigContact,
  setGigContactPrimary,
  removeGigContact,
  notifyGigCreated,
  notifyGigConfirmed,
  notifyGigsImported,
} from '../services/gigService.js'

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

function requireParam(req, res, name, label = name) {
  const id = parseId(req.params[name])
  if (id === null) {
    res.status(400).json({ error: `Invalid ${label}` })
    return null
  }
  return id
}

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

// List all gigs with open task count and member availability
router.get('/', async (req, res) => {
  res.json(await listGigs(pool, req.tenantId))
})

// Global search (min 3 chars): event name, or linked venue/festival name or city
router.get('/search', async (req, res) => {
  res.json(await searchGigs(pool, req.tenantId, req.query))
})

// Get single gig with tasks, participants, and attachments
router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getGig(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.gig)
})

// Merch-sold totals for this gig. Finance-ish: gated on planning.write so
// readers (the only role without it on this page) get 403 — the same boundary
// the UI mirrors by hiding the card.
router.get('/:id/merch-summary', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
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
