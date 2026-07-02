// User-scoped notification routes. Mounted with requireApproved only (no
// resolveTenantId): the resource deliberately spans the caller's tenants —
// the bell aggregates all bands. Every operation is scoped to req.user.id.
import { Router } from 'express'
import pool from '../db/index.js'
import { statObject, getObject } from '../services/storageService.js'
import { logger } from '../utils/logger.js'
import { parseId } from '../validators/notificationValidators.js'
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  removeNotification,
  getPreferences,
  updatePreferences,
  getTenantAvatar,
} from '../services/notificationService.js'

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

// Streams a tenant profile picture for any tenant the caller holds an approved membership
// in. The generic /api/files route only authorizes against the active tenant,
// which would 404 the other bands' profile pictures shown in the bell.
router.get('/tenant-avatar/:tenantId', async (req, res) => {
  const tenantId = requireParam(req, res, 'tenantId'); if (tenantId === null) return
  const result = await getTenantAvatar(pool, req.user.id, tenantId)
  if (result.error) return sendError(res, result.error)

  try {
    const stat = await statObject(result.avatarPath)
    res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream')
    res.setHeader('Content-Length', stat.size)
    const stream = await getObject(result.avatarPath)
    // Stream errors after headers are sent don't reach Express's error
    // handler via pipe(); mirror the handling in routes/files.js.
    stream.on('error', (streamErr) => {
      logger.error('storage.stream_error', { err: streamErr })
      if (!res.headersSent) {
        res.status(502).json({ error: 'Storage error' })
      } else {
        res.destroy()
      }
    })
    stream.pipe(res)
  } catch (err) {
    if (err.code === 'NoSuchKey' || err.message?.includes('Not Found')) {
      return res.status(404).json({ error: 'Not found' })
    }
    throw err
  }
})

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
