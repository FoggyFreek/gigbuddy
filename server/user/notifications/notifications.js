// User-scoped notification routes. Mounted with requireApproved only (no
// resolveTenantId): the resource deliberately spans the caller's tenants —
// the bell aggregates all bands. Every operation is scoped to req.user.id.
import { Router } from 'express'
import pool from '../../db/index.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'
import { tenantAvatarHandler } from '../../people/workspaces/tenantAvatar.js'
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  removeNotification,
  getPreferences,
  updatePreferences,
} from './notificationService.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await listNotifications(pool, req.user.id))
})

router.get('/prefs', async (req, res) => {
  res.json(await getPreferences(pool, req.user.id))
})

router.put('/prefs', async (req, res) => {
  const result = await updatePreferences(pool, req.user.id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.prefs)
})

// Legacy alias for the tenant profile picture, which the bell was the first (and
// for a while the only) consumer of. The route now belongs to the tenants stack
// at /api/tenants/:id/avatar; this mount stays so clients loaded before the move
// keep working.
router.get('/tenant-avatar/:tenantId', tenantAvatarHandler('tenantId'))

router.post('/read-all', async (req, res) => {
  await markAllNotificationsRead(pool, req.user.id)
  res.status(204).end()
})

router.post('/:id/read', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await markNotificationRead(pool, req.user.id, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await removeNotification(pool, req.user.id, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

export default router
