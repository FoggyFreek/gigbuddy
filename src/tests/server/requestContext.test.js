// @vitest-environment node
import { EventEmitter } from 'node:events'
import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requestContext, requestLogger } from '../../../server/middleware/requestContext.js'
import { logger } from '../../../server/utils/logger.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function buildApp() {
  const app = express()
  app.use(requestContext)
  app.use(requestLogger)
  app.get('/ok', (_req, res) => res.status(200).json({ ok: true }))
  app.get('/missing', (_req, res) => res.status(404).json({ error: 'not found' }))
  app.get('/boom', () => { throw new Error('boom') })
  app.get('/async', async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await Promise.resolve().then(() => logger.info('async.checkpoint', {}))
    res.status(200).json({ ok: true })
  })
  app.use((_err, _req, res, _next) => {
    res.status(500).json({ error: 'Internal error' })
  })
  return app
}

function parsedLines(spy) {
  return spy.mock.calls.map(([raw]) => JSON.parse(raw))
}

describe('requestContext + requestLogger (integration)', () => {
  let app
  let logSpy
  let errorSpy

  beforeEach(() => {
    app = buildApp()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('sets a UUID-shaped X-Request-Id header, different per request', async () => {
    const first = await request(app).get('/ok')
    const second = await request(app).get('/ok')
    expect(first.headers['x-request-id']).toMatch(UUID_PATTERN)
    expect(second.headers['x-request-id']).toMatch(UUID_PATTERN)
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id'])
  })

  it('logs an http.request line at info for a 2xx response', async () => {
    const res = await request(app).get('/ok')
    const line = parsedLines(logSpy).find((l) => l.event === 'http.request')
    expect(line).toMatchObject({ level: 'info', method: 'GET', path: '/ok', status: 200 })
    expect(typeof line.durationMs).toBe('number')
    expect(line.requestId).toBe(res.headers['x-request-id'])
  })

  it('logs an http.request line at warn for a 4xx response', async () => {
    await request(app).get('/missing')
    const line = parsedLines(errorSpy).find((l) => l.event === 'http.request')
    expect(line).toMatchObject({ level: 'warn', status: 404 })
  })

  it('logs an http.request line at error for a 5xx response', async () => {
    await request(app).get('/boom')
    const line = parsedLines(errorSpy).find((l) => l.event === 'http.request')
    expect(line).toMatchObject({ level: 'error', status: 500 })
  })

  it('strips the query string from the logged path', async () => {
    await request(app).get('/ok?secret=1')
    const line = parsedLines(logSpy).find((l) => l.event === 'http.request')
    expect(line.path).toBe('/ok')
  })

  it('keeps the AsyncLocalStorage requestId correct across an await boundary', async () => {
    const res = await request(app).get('/async')
    const checkpoint = parsedLines(logSpy).find((l) => l.event === 'async.checkpoint')
    expect(checkpoint.requestId).toBe(res.headers['x-request-id'])
  })
})

describe('requestLogger finish/close handling', () => {
  let logSpy
  let errorSpy

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  function fakeReqRes() {
    const req = { method: 'GET', originalUrl: '/widgets?x=1' }
    const res = Object.assign(new EventEmitter(), { statusCode: 200 })
    return { req, res }
  }

  it('logs exactly once on normal completion, even though close fires after finish', () => {
    const { req, res } = fakeReqRes()
    requestLogger(req, res, () => {})
    res.emit('finish')
    res.emit('close')
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).not.toHaveBeenCalled()
    const line = JSON.parse(logSpy.mock.calls[0][0])
    expect(line).not.toHaveProperty('aborted')
  })

  it('logs the abort path exactly once at warn when close fires without finish', () => {
    const { req, res } = fakeReqRes()
    requestLogger(req, res, () => {})
    res.emit('close')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).not.toHaveBeenCalled()
    const line = JSON.parse(errorSpy.mock.calls[0][0])
    expect(line).toMatchObject({ level: 'warn', aborted: true, status: 200 })
  })
})
