import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { parseId } from '../validators/rehearsalValidators.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listRehearsals,
  getRehearsal,
  getNextRehearsal,
  listUpcomingRehearsals,
  listRehearsalsInRange,
  createRehearsal,
  patchRehearsal,
  deleteRehearsal,
  addParticipant,
  removeParticipant,
  setParticipantVote,
  linkSong,
  unlinkSong,
  notifyRehearsalCreated,
  notifyRehearsalConfirmed,
  notifyRehearsalOptionUnavailable,
  notifyRehearsalOptionResponsesComplete,
} from '../services/rehearsalService.js'

const router = Router()

// List all rehearsals with participants
router.get('/', async (req, res) => {
  res.json(await listRehearsals(pool, req.tenantId))
})

// get the next rehearsal with participant
router.get('/next', async (req, res) => {
  const result = await getNextRehearsal(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json(result.rehearsal)
})

router.get('/upcoming', async (req, res) => {
  const result = await listUpcomingRehearsals(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Calendar month read: rehearsals inside the inclusive ?from=&to= day window.
router.get('/range', async (req, res) => {
  const result = await listRehearsalsInRange(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Get single rehearsal
router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getRehearsal(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.rehearsal)
})

// Create rehearsal
router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createRehearsal(req.tenantId, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.rehearsal)
  await notifyRehearsalCreated(req.tenantId, result.rehearsal)
})

// Update rehearsal (partial)
router.patch('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchRehearsal(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.rehearsal)
  if (result.confirmed) await notifyRehearsalConfirmed(req.tenantId, result.rehearsal)
})

// Delete rehearsal
router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteRehearsal(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Add participant
router.post('/:id/participants', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const memberId = parseId(req.body.band_member_id)
  if (memberId === null) return res.status(400).json({ error: 'Invalid band_member_id' })
  const result = await addParticipant(pool, req.tenantId, req.user.id, id, memberId)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.rehearsal)
})

// Remove participant
router.delete('/:id/participants/:bandMemberId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const memberId = requireParam(req, res, 'bandMemberId'); if (memberId === null) return
  const result = await removeParticipant(pool, req.tenantId, id, memberId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Update vote. Readers may set their own participation vote; the self-scope is
// enforced in the service via the caller context below.
router.patch('/:id/participants/:bandMemberId', requirePermission(PERMISSIONS.REHEARSAL_RESPOND_SELF), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const memberId = requireParam(req, res, 'bandMemberId'); if (memberId === null) return
  const caller = { role: req.membership?.role, isSuperAdmin: !!req.user?.is_super_admin }
  const result = await setParticipantVote(pool, req.tenantId, req.user.id, id, memberId, req.body, caller)
  if (result.error) return sendError(res, result.error)
  if (result.notifications.firstUnavailable) {
    await notifyRehearsalOptionUnavailable(req.tenantId, result.rehearsal)
  }
  if (result.notifications.allResponded) {
    await notifyRehearsalOptionResponsesComplete(req.tenantId, result.rehearsal)
  }
  res.json(result.rehearsal)
})

// Link song
router.post('/:id/songs', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const songId = parseId(req.body.song_id)
  if (songId === null) return res.status(400).json({ error: 'Invalid song_id' })
  const result = await linkSong(pool, req.tenantId, id, songId)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.rehearsal)
})

// Unlink song
router.delete('/:id/songs/:songId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const songId = requireParam(req, res, 'songId'); if (songId === null) return
  const result = await unlinkSong(pool, req.tenantId, id, songId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
