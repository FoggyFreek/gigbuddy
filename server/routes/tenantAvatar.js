// The tenant profile-picture stream, mounted twice: canonically at
// /api/tenants/:id/avatar, and at the legacy /api/notifications/tenant-avatar/
// :tenantId the notification bell shipped with (kept so already-loaded clients
// keep rendering avatars). Authorization is a membership lookup, not the active
// tenant — the generic /api/files route only serves the active tenant, which
// would 404 every other tenant's picture.
import pool from '../db/index.js'
import { statObject, getObject } from '../services/storageService.js'
import { getMemberTenantAvatar } from '../services/tenantSelfService.js'
import { logger } from '../utils/logger.js'
import { requireParam, sendError } from './routeHelpers.js'

export function tenantAvatarHandler(paramName) {
  return async (req, res) => {
    const tenantId = requireParam(req, res, paramName, { label: 'tenantId' })
    if (tenantId === null) return
    const result = await getMemberTenantAvatar(pool, req.user.id, tenantId)
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
  }
}
