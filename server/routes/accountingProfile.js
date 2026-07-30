import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { auditLog } from '../utils/auditLog.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  getAccountingProfile,
  patchAccountingProfile,
  markProfileReviewed,
} from '../services/accountingProfileService.js'
import {
  listEnrolments,
  startEnrolment,
  updateEnrolment,
  voidEnrolment,
  deleteEnrolment,
} from '../services/taxSchemeEnrolmentService.js'
import { parseId } from '../validators/taxSchemeEnrolmentValidators.js'

const router = Router()

// Emit any audit event the service produced, then translate the result.
function logAudit(req, audit) {
  if (audit) auditLog(req, audit.action, audit.details)
}

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

// ---------- /api/accounting-profile/schemes ----------
// The tenant's VAT scheme enrolment history. Part of the accounting-profile
// surface rather than its own resource: "which scheme, since when" is the same
// settings concept as the regime it qualifies.

router.get('/schemes', async (req, res, next) => {
  try {
    const result = await listEnrolments(pool, req.tenantId)
    if (result.error) return sendError(res, result.error)
    res.json(result.enrolments)
  } catch (err) {
    next(err)
  }
})

router.post('/schemes', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  try {
    const result = await startEnrolment(pool, req.tenantId, req.body || {}, req.session.userId)
    if (result.error) return sendError(res, result.error)
    res.status(201).json(result.enrolment)
  } catch (err) {
    next(err)
  }
})

router.patch('/schemes/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  const id = requireParam(req, res, 'id', { parse: parseId, label: 'enrolment id' })
  if (id === null) return
  try {
    const result = await updateEnrolment(pool, req.tenantId, id, req.body || {})
    if (result.error) return sendError(res, result.error)
    res.json(result.enrolment)
  } catch (err) {
    next(err)
  }
})

// Voiding, not deleting, is how a wrong enrolment is retracted — corrections are
// forward-only, and the row explains the snapshots of documents issued under it.
router.post('/schemes/:id/void', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  const id = requireParam(req, res, 'id', { parse: parseId, label: 'enrolment id' })
  if (id === null) return
  try {
    const result = await voidEnrolment(pool, req.tenantId, id, req.body || {}, req.session.userId)
    if (result.error) return sendError(res, result.error)
    logAudit(req, result.audit)
    res.json(result.enrolment)
  } catch (err) {
    next(err)
  }
})

// Only for a migration-inferred enrolment nothing depends on; the service 409s
// anything else.
router.delete('/schemes/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res, next) => {
  const id = requireParam(req, res, 'id', { parse: parseId, label: 'enrolment id' })
  if (id === null) return
  try {
    const result = await deleteEnrolment(pool, req.tenantId, id)
    if (result.error) return sendError(res, result.error)
    logAudit(req, result.audit)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
