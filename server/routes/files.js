import { Router } from 'express'
import pool from '../db/index.js'
import { statObject, getObject, getPartialObject } from '../services/storageService.js'
import { resolveFileAccess, canReadFinanceFile, searchFiles } from '../services/fileService.js'
import { can } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { sanitizeFilename } from '../utils/sanitizeFilename.js'
import { logger } from '../utils/logger.js'

const router = Router()

// Global file search (min 3 chars): matches uploads by filename. Purchase
// receipts are finance-gated, so the caller's finance capabilities are passed
// through (the search includes them only for those allowed to read them).
// Registered before the catch-all below so "/search" isn't read as an object key.
router.get('/search', async (req, res) => {
  res.json(
    await searchFiles(pool, req.tenantId, req.query, {
      canFinanceView: can(req, PERMISSIONS.FINANCE_VIEW),
      canPurchaseCreate: can(req, PERMISSIONS.PURCHASE_CREATE),
      userId: req.user.id,
    }),
  )
})

router.get('/*objectKey', async (req, res) => {
  const segments = req.params.objectKey
  const objectKey = Array.isArray(segments) ? segments.join('/') : segments

  if (!objectKey) return res.status(400).json({ error: 'Missing object key' })

  const { allowed, originalFilename } = await resolveFileAccess(pool, req.tenantId, objectKey)
  if (!allowed) return res.status(404).json({ error: 'Not found' })

  // Financial documents (invoice PDFs, purchase receipts) require finance.view;
  // a contributor may read a receipt only on a purchase they created.
  const financeOk = await canReadFinanceFile(pool, req.tenantId, objectKey, {
    canFinanceView: can(req, PERMISSIONS.FINANCE_VIEW),
    canPurchaseCreate: can(req, PERMISSIONS.PURCHASE_CREATE),
    userId: req.user.id,
  })
  if (!financeOk) return res.status(404).json({ error: 'Not found' })

  try {
    const stat = await statObject(objectKey)
    const size = Number(stat.size)
    res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream')
    // Without this a browser cannot seek an <audio>/<video> src: it re-requests
    // from byte 0 and playback restarts, re-downloading the whole object.
    res.setHeader('Accept-Ranges', 'bytes')

    // An object key embeds a fresh UUID per upload, so a key's bytes never
    // change and a revalidation can always answer 304 — the browser only
    // re-fetches what it dropped. `private` is load-bearing: the body is
    // tenant-gated, so no shared cache may ever store it. max-age is the window
    // in which a revoked member could still replay a cached file, so it stays
    // short rather than the year `immutable` content would otherwise allow.
    const etag = stat.etag ? `"${String(stat.etag).replaceAll('"', '')}"` : null
    if (etag) res.setHeader('ETag', etag)
    if (stat.lastModified) {
      res.setHeader('Last-Modified', new Date(stat.lastModified).toUTCString())
    }
    res.setHeader('Cache-Control', 'private, max-age=3600, immutable')

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
    // Reached only after the tenant and finance checks above, so a stale
    // validator can never confirm a file the caller may not read.
    if (req.fresh) return res.status(304).end()

    // If-Range asks for the range only while the validator still matches. A
    // date-form If-Range won't match our entity tag and falls back to the full
    // body — the conservative direction, and moot for immutable keys.
    const ifRange = req.headers['if-range']
    const rangeUsable = !ifRange || (etag !== null && ifRange === etag)

    // req.range() (range-parser) validates the untrusted header for us: it
    // clamps end to size-1 and discards inverted, negative or non-numeric
    // specs, reporting -1 once nothing usable is left.
    const parsed = rangeUsable ? req.range(size) : undefined
    if (parsed === -1) {
      res.setHeader('Content-Range', `bytes */${size}`)
      return res.status(416).end()
    }
    // A unit-less header (-2), a unit other than bytes, and multi-range requests
    // fall through to the full 200 body, which RFC 9110 allows for any Range the
    // server declines to honour.
    const range = Array.isArray(parsed) && parsed.type === 'bytes' && parsed.length === 1
      ? parsed[0]
      : null
    const length = range ? range.end - range.start + 1 : size
    res.setHeader('Content-Length', length)
    if (range) {
      res.status(206).setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    }

    const stream = range
      ? await getPartialObject(objectKey, range.start, length)
      : await getObject(objectKey)
    // Handle stream errors that occur after headers are sent; pipe() won't
    // propagate these to Express's error handler (OWASP A10).
    stream.on('error', (streamErr) => {
      logger.error('storage.stream_error', { err: streamErr })
      if (!res.headersSent) {
        res.status(502).json({ error: 'Storage error' })
      } else {
        res.destroy()
      }
    })
    // A browser aborts mid-response constantly here: preload=metadata reads a
    // header and disconnects, and every seek abandons the in-flight body.
    // pipe() only unpipes on client disconnect, leaving the upstream storage
    // response open until it times out; destroy it so the connection closes.
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  } catch (err) {
    if (err.code === 'NoSuchKey' || err.message?.includes('Not Found')) {
      return res.status(404).json({ error: 'Not found' })
    }
    throw err
  }
})

export default router
