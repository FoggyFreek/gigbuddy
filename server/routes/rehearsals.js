import { Router } from 'express'
import pool from '../db/index.js'
import { parseId } from '../validators/rehearsalValidators.js'
import {
  listRehearsals,
  getRehearsal,
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
} from '../services/rehearsalService.js'

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

// List all rehearsals with participants
router.get('/', async (req, res) => {
  res.json(await listRehearsals(pool, req.tenantId))
})

// Get single rehearsal
router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getRehearsal(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.rehearsal)
})

// Create rehearsal
router.post('/', async (req, res) => {
  const result = await createRehearsal(req.tenantId, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.rehearsal)
  notifyRehearsalCreated(req.tenantId, result.rehearsal)
})

// Update rehearsal (partial)
router.patch('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchRehearsal(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.rehearsal)
  if (result.confirmed) notifyRehearsalConfirmed(req.tenantId, result.rehearsal)
})

// Delete rehearsal
router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteRehearsal(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Add participant
router.post('/:id/participants', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const memberId = parseId(req.body.band_member_id)
  if (memberId === null) return res.status(400).json({ error: 'Invalid band_member_id' })
  const result = await addParticipant(pool, req.tenantId, req.user.id, id, memberId)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.rehearsal)
})

// Remove participant
router.delete('/:id/participants/:bandMemberId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const memberId = requireParam(req, res, 'bandMemberId'); if (memberId === null) return
  const result = await removeParticipant(pool, req.tenantId, id, memberId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Update vote
router.patch('/:id/participants/:bandMemberId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const memberId = requireParam(req, res, 'bandMemberId'); if (memberId === null) return
  const result = await setParticipantVote(pool, req.tenantId, req.user.id, id, memberId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.rehearsal)
})

// Link song
router.post('/:id/songs', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const songId = parseId(req.body.song_id)
  if (songId === null) return res.status(400).json({ error: 'Invalid song_id' })
  const result = await linkSong(pool, req.tenantId, id, songId)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.rehearsal)
})

// Unlink song
router.delete('/:id/songs/:songId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const songId = requireParam(req, res, 'songId'); if (songId === null) return
  const result = await unlinkSong(pool, req.tenantId, id, songId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
