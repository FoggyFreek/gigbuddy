import { Router } from 'express'
import pool from '../db/index.js'
import { buildExport, resolveImageToken } from '../services/linkpageService.js'
import { isValidSyncBearer } from '../security/linkpageTokens.js'
import { statObject, getObject } from '../services/storageService.js'
import { sendError } from './routeHelpers.js'
import { logger } from '../utils/logger.js'

const router = Router()

// Unauthenticated mount (before CSRF/session middleware): the linkpage app is
// a separate process with no session — the shared-secret bearer is the
// credential. Everything here is read-only.

// Full content snapshot for one band, pulled server-to-server by the linkpage
// app. 401 without the bearer; unknown slugs 404 without existence leaks.
router.get('/export/:slug', async (req, res) => {
  if (!isValidSyncBearer(req.get('authorization'))) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const result = await buildExport(pool, req.params.slug)
  if (result.error) return sendError(res, result.error)
  res.set('Cache-Control', 'private, no-store')
  res.json(result.export)
})

// Streams a tenant image (band logo, song cover) for public link pages. The
// HMAC token in `t` is the credential; it only ever wraps image object keys
// minted by the export above.
router.get('/image', async (req, res) => {
  const resolved = resolveImageToken(req.query.t)
  if (resolved.error) return sendError(res, resolved.error)

  try {
    const stat = await statObject(resolved.objectKey)
    res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream')
    res.setHeader('Content-Length', stat.size)
    // Immutable-ish content (uploads get fresh keys); let browsers/CDNs cache.
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.setHeader('Content-Security-Policy', "default-src 'none'")
    // The link-page app is served from a sibling subdomain (e.g. link.<domain>
    // vs this app's app.<domain>), so its pages embed these images cross-origin.
    // Helmet's global default is CORP: same-origin, which would block that
    // <img>. Relax to same-site (both subdomains share the registrable domain)
    // so logos/covers render, without opening the endpoint to the whole web.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
    const stream = await getObject(resolved.objectKey)
    stream.on('error', (streamErr) => {
      logger.error('linkpage.image_stream_error', { err: streamErr })
      res.destroy()
    })
    stream.pipe(res)
  } catch {
    // Missing object → same 404 as a bad token; no storage detail leaks.
    res.status(404).json({ error: 'Not found' })
  }
})

export default router
