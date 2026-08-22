import { Router } from 'express'
import pool from '../../db/index.js'
import { loadPublicOutreachImage } from './imageService.js'
import { sendError } from '../../platform/http/routeHelpers.js'
import { logger } from '../../utils/logger.js'

const router = Router()

router.get('/image/:slot', async (req, res) => {
  const result = await loadPublicOutreachImage(pool, req.query.t, req.params.slot)
  if (result.error) return sendError(res, result.error)

  if (req.get('if-none-match') === result.etag) {
    res.status(304).end()
    return
  }
  res.setHeader('Content-Type', result.contentType)
  res.setHeader('Content-Length', result.contentLength)
  res.setHeader('Cache-Control', 'public, no-cache')
  res.setHeader('ETag', result.etag)
  if (result.lastModified) res.setHeader('Last-Modified', result.lastModified.toUTCString())
  res.setHeader('Content-Security-Policy', "default-src 'none'")
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  if (result.buffer) {
    res.send(result.buffer)
    return
  }
  result.stream.on('error', (err) => {
    logger.error('outreach.image_stream_error', { err })
    res.destroy()
  })
  result.stream.pipe(res)
})

export default router

