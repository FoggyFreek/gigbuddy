import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { sendError } from './routeHelpers.js'
import {
  getAccountingProfile,
  patchAccountingProfile,
  markProfileReviewed,
} from '../services/accountingProfileService.js'

const router = Router()

// ---------- GET /api/accounting-profile ----------
router.get('/', async (req, res, next) => {
  try {
    const result = await getAccountingProfile(pool, req.tenantId)
    if (result.error) return sendError(res, result.error)
    res.json(result.profile)
  } catch (err) {
    next(err)
  }
})

// ---------- PATCH /api/accounting-profile ----------
router.patch('/', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  try {
    const result = await patchAccountingProfile(pool, req.tenantId, req.body || {})
    if (result.error) return sendError(res, result.error)
    res.json(result.profile)
  } catch (err) {
    next(err)
  }
})

// ---------- POST /api/accounting-profile/review ----------
// Records that a human confirmed the profile's values (see profile_source:
// backfilled values were inherited, not chosen).
router.post('/review', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  try {
    const result = await markProfileReviewed(pool, req.tenantId, req.session.userId)
    if (result.error) return sendError(res, result.error)
    res.json(result.profile)
  } catch (err) {
    next(err)
  }
})

export default router
