// Bank-statement import routes. Mounted under the finance-gated group; each
// mutation additionally requires finance.manage. The upload is parsed in memory
// (never written to disk) and staged; commit applies per-line decisions.
import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  parseAndStage,
  getImport,
  cancelImport,
  commitImport,
  setOpeningBalanceFromImport,
} from '../services/bankImportService.js'
import { parseCommitBody } from '../validators/bankImportValidators.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

// Parse + stage an uploaded CAMT.053/MT940 file, returning the staged import
// with per-line reconciliation/supplier suggestions.
router.post('/parse', requirePermission(PERMISSIONS.FINANCE_MANAGE), upload.single('file'), async (req, res) => {
  const result = await parseAndStage(pool, req.tenantId, req.file, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result)
})

router.get('/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getImport(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.delete('/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await cancelImport(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Sets the tenant opening balance from this staged import's opening-balance value.
router.post('/:id/opening-balance', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await setOpeningBalanceFromImport(pool, req.tenantId, id, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.post('/:id/commit', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const parsed = parseCommitBody(req.body)
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  const result = await commitImport(pool, req.tenantId, id, parsed.decisions, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

export default router
