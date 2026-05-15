import { Router } from 'express'
import pool from '../db/index.js'
import { storageClient, BUCKET } from '../utils/storage.js'
import { sanitizeFilename } from '../utils/sanitizeFilename.js'

const router = Router()

async function objectKeyBelongsToTenant(objectKey, tenantId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM tenants WHERE id = $1 AND logo_path = $2
     UNION ALL
     SELECT 1 FROM gigs WHERE tenant_id = $1 AND banner_path = $2
     UNION ALL
     SELECT 1 FROM share_photos WHERE tenant_id = $1 AND object_key = $2
     UNION ALL
     SELECT 1 FROM gig_attachments WHERE tenant_id = $1 AND object_key = $2
     LIMIT 1`,
    [tenantId, objectKey],
  )
  return rows.length > 0
}

router.get('/*objectKey', async (req, res) => {
  const segments = req.params.objectKey
  const objectKey = Array.isArray(segments) ? segments.join('/') : segments

  if (!objectKey) return res.status(400).json({ error: 'Missing object key' })

  const allowed = await objectKeyBelongsToTenant(objectKey, req.tenantId)
  if (!allowed) return res.status(404).json({ error: 'Not found' })

  const { rows: meta } = await pool.query(
    'SELECT original_filename FROM gig_attachments WHERE object_key = $1 AND tenant_id = $2',
    [objectKey, req.tenantId],
  )

  try {
    const stat = await storageClient.statObject(BUCKET, objectKey)
    res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream')
    res.setHeader('Content-Length', stat.size)
    if (meta.length) {
      // Sanitize before embedding in header to prevent response splitting (OWASP A05).
      const safeName = sanitizeFilename(meta[0].original_filename)
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`)
    }
    const stream = await storageClient.getObject(BUCKET, objectKey)
    // Handle stream errors that occur after headers are sent; pipe() won't
    // propagate these to Express's error handler (OWASP A10).
    stream.on('error', (streamErr) => {
      console.error('[files] storage stream error:', streamErr)
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

export default router
