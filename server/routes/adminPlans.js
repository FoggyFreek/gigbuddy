// Super-admin CRUD for the subscription plan catalog. Mounted at
// /api/admin/plans behind the superAdmin gate (see routes/index.js).
import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { listPlans, createPlan, updatePlan, deletePlan } from '../services/planService.js'
import { requireParam, sendError } from './routeHelpers.js'

const router = Router()

router.get('/', async (_req, res) => {
  res.json(await listPlans(pool))
})

router.post('/', async (req, res) => {
  const result = await createPlan(pool, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'admin.plan.create', { planId: result.plan.id, planSlug: result.plan.slug })
  res.status(201).json(result.plan)
})

router.patch('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await updatePlan(pool, id, req.body ?? {})
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'admin.plan.update', { planId: result.plan.id, planSlug: result.plan.slug })
  res.json(result.plan)
})

router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deletePlan(pool, id)
  if (result.error) return sendError(res, result.error)
  auditLog(req, 'admin.plan.delete', { planId: id, planSlug: result.slug })
  res.status(204).end()
})

export default router
