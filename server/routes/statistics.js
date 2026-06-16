import { Router } from 'express'
import {
  getTenantStatistics,
  getAllTenantStatistics,
  refreshTenantStorage,
  refreshAllTenantStorage,
} from '../services/statisticsService.js'

// Tenant-admin view: usage for the active tenant only.
// Mounted at /api/statistics behind the tenant.manage gate (see routes/index.js).
export const tenantRouter = Router()

tenantRouter.get('/storage', async (req, res, next) => {
  try {
    const stats = await getTenantStatistics(req.tenantId)
    if (!stats) return res.status(404).json({ error: 'Tenant not found' })
    res.json(stats)
  } catch (err) {
    next(err)
  }
})

// Recompute usage for the active tenant on demand and return the fresh row.
tenantRouter.post('/storage/refresh', async (req, res, next) => {
  try {
    await refreshTenantStorage(req.tenantId)
    res.json(await getTenantStatistics(req.tenantId))
  } catch (err) {
    next(err)
  }
})

// Super-admin view: usage for every tenant, plus an on-demand recompute used to
// backfill tenants whose files predate this feature.
// Mounted at /api/admin/statistics behind [requireApproved, requireSuperAdmin].
export const adminRouter = Router()

adminRouter.get('/storage', async (_req, res, next) => {
  try {
    res.json(await getAllTenantStatistics())
  } catch (err) {
    next(err)
  }
})

adminRouter.post('/storage/refresh', async (_req, res, next) => {
  try {
    await refreshAllTenantStorage()
    res.json(await getAllTenantStatistics())
  } catch (err) {
    next(err)
  }
})
