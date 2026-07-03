import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import {
  fetchArtistById,
  fetchArtistEvents,
  importEvents,
} from '../services/bandsintownService.js'
import { notifyGigsImported } from '../services/gigService.js'

const router = Router()

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

// Look up a Bandsintown artist by numeric id — name, images and social links.
router.get('/artist/:artistId', async (req, res) => {
  const result = await fetchArtistById(pool, req.tenantId, req.params.artistId)
  if (result.error) return sendError(res, result.error)
  res.json(result.artist)
})

// Upcoming events for the tenant's configured Bandsintown artist, annotated
// with matched venues and duplicate flags for the import review step.
router.get('/events', async (req, res) => {
  const result = await fetchArtistEvents(pool, req.tenantId)
  if (result.error) return sendError(res, result.error)
  res.json({ artist: { id: result.artist.id ?? null, name: result.artist.name }, events: result.events })
})

// Import selected events; creates missing venues/festivals and skips duplicates.
router.post('/import', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await importEvents(req.tenantId, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result)
  if (result.created > 0) await notifyGigsImported(req.tenantId, result.created)
})

export default router
