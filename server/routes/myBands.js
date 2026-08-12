// Mounted at /api/my-bands on the tenant tier with the MY_BANDS capability, so
// only a personal workspace reaches it. The collection is tenant-owned even
// though the profiles it points at are global.
import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listBands,
  addBand,
  getRemovalPreview,
  removeBand,
} from '../services/myBandService.js'

const router = Router()

router.get('/', async (req, res) => {
  const result = await listBands(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// Idempotent: 201 for a fresh row, 200 when the band is already in the
// collection. Accepts either an existing profile id or a whole new profile,
// which it creates in the same transaction.
router.post('/', async (req, res) => {
  const result = await addBand(pool, req.user, req.tenantId, req.body)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.status(result.created ? 201 : 200).json(result.myBand)
})

router.get('/:id/removal-preview', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getRemovalPreview(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.counts)
})

router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await removeBand(pool, req.tenantId, id, req.query)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.json(result.removal)
})

export default router
