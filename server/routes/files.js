import { Router } from 'express'
import pool from '../db/index.js'
import { statObject, getObject } from '../services/storageService.js'
import { resolveFileAccess } from '../services/fileService.js'
import { sanitizeFilename } from '../utils/sanitizeFilename.js'

const router = Router()

router.get('/*objectKey', async (req, res) => {
  const segments = req.params.objectKey
  const objectKey = Array.isArray(segments) ? segments.join('/') : segments

  if (!objectKey) return res.status(400).json({ error: 'Missing object key' })

  const { allowed, originalFilename } = await resolveFileAccess(pool, req.tenantId, objectKey)
  if (!allowed) return res.status(404).json({ error: 'Not found' })

  try {
    const stat = await statObject(objectKey)
    res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream')
    res.setHeader('Content-Length', stat.size)
    if (originalFilename) {
      // Sanitize before embedding in header to prevent response splitting (OWASP A05).
      const safeName = sanitizeFilename(originalFilename)
      // ?inline=1 lets the SPA preview the file (e.g. a PDF in an <iframe>)
      // instead of forcing a download; the filename still applies on save.
      const inline = req.query.inline === '1'
      const disposition = inline ? 'inline' : 'attachment'
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`)
      if (inline) {
        // The global helmet config forbids all framing (frame-ancestors 'none'
        // + X-Frame-Options DENY), which blocks our own preview iframe. Relax
        // to same-origin for inline previews only; everything else keeps the
        // full lockdown. default-src 'none' keeps any active content in the
        // served file (e.g. scripts inside a PDF/SVG) from loading resources.
        res.setHeader('X-Frame-Options', 'SAMEORIGIN')
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'")
      }
    }
    const stream = await getObject(objectKey)
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
