import { randomUUID } from 'node:crypto'
import { runWithStore } from '../utils/requestContextStore.js'
import { logger } from '../utils/logger.js'

export function requestContext(req, res, next) {
  const requestId = randomUUID()
  res.setHeader('X-Request-Id', requestId)
  runWithStore({ requestId }, next)
}

export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint()
  // Captured now, not read inside the finish/close handlers below: Express
  // temporarily rewrites req.url (and therefore req.path) while dispatching
  // through nested routers, restoring it as each layer unwinds. originalUrl
  // is set once at the start of the request and isn't mutated by that
  // traversal, so it's the only safe thing to read lazily.
  const path = req.originalUrl.split('?')[0]
  let finished = false
  const elapsed = () => Math.round(Number(process.hrtime.bigint() - start) / 1e6)

  res.on('finish', () => {
    finished = true
    const status = res.statusCode
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    logger[level]('http.request', { method: req.method, path, status, durationMs: elapsed() })
  })

  // 'close' fires after 'finish' on every normal request too (the socket
  // closes once the response completes), so the `finished` guard prevents a
  // double log line there. A genuinely aborted request (client disconnects
  // mid-response) never fires 'finish' at all — only 'close' — and at that
  // point res.statusCode is whatever was set before the abort (often the
  // default 200), which would misleadingly read as success. So that path is
  // logged separately, always at warn, with an explicit aborted flag.
  res.on('close', () => {
    if (finished) return
    logger.warn('http.request', { method: req.method, path, status: res.statusCode, durationMs: elapsed(), aborted: true })
  })

  next()
}
