import { describe, it, expect, beforeAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import { metricsMiddleware, metricsHandler } from '../../../server/metrics.js'

// Minimal app that mirrors how server/index.js mounts the metrics plumbing:
// top-level middleware, /metrics before any catch-all, and a parameterized
// route under a mount prefix to exercise the route-template label.
function makeApp() {
  const app = express()
  app.use(metricsMiddleware)
  app.get('/metrics', metricsHandler)

  const things = express.Router()
  things.get('/:id', (_req, res) => res.json({ ok: true }))
  app.use('/things', things)

  // Catch-all, like the SPA fallback — produces `unmatched`.
  app.use((_req, res) => res.status(404).end())
  return app
}

describe('GET /metrics', () => {
  let app
  beforeAll(() => {
    app = makeApp()
  })

  it('exposes Node/process default metrics', async () => {
    const res = await request(app).get('/metrics')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    // A default-metrics series that prom-client always collects.
    expect(res.text).toMatch(/process_cpu_seconds_total/)
    expect(res.text).toMatch(/nodejs_eventloop_lag_seconds/)
  })

  it('labels requests with a bounded, normalized route template (never the raw id)', async () => {
    await request(app).get('/things/12345')
    const res = await request(app).get('/metrics')

    // Route is the template, not the concrete id.
    expect(res.text).toMatch(/http_requests_total\{[^}]*route="\/things\/:id"[^}]*\}/)
    expect(res.text).toMatch(/http_requests_total\{[^}]*method="GET"[^}]*\}/)
    expect(res.text).toMatch(/http_requests_total\{[^}]*status="200"[^}]*\}/)
    // The raw id must never leak into a label.
    expect(res.text).not.toMatch(/12345/)
  })

  it('labels an unmatched path as "unmatched"', async () => {
    await request(app).get('/no/such/route')
    const res = await request(app).get('/metrics')
    expect(res.text).toMatch(/http_requests_total\{[^}]*route="unmatched"[^}]*\}/)
  })

  it('does not record telemetry for scrapes of /metrics itself', async () => {
    // Hammer the scrape endpoint, then confirm no series was attributed to it.
    await request(app).get('/metrics')
    await request(app).get('/metrics')
    const res = await request(app).get('/metrics')

    expect(res.text).not.toMatch(/http_requests_total\{[^}]*route="\/metrics"[^}]*\}/)
    // In-flight gauge nets back to zero once requests complete.
    expect(res.text).toMatch(/^http_requests_in_flight 0$/m)
  })
})
