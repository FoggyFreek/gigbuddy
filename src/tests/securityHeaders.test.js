// @vitest-environment node
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { securityHeaders } from '../../server/middleware/securityHeaders.js'

function makeApp({ isProd }) {
  const app = express()
  app.use(securityHeaders({ isProd }))
  app.get('/_t', (_req, res) => res.send('ok'))
  return app
}

function parseCsp(header) {
  return Object.fromEntries(
    header
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...rest] = d.split(/\s+/)
        return [name, rest]
      }),
  )
}

describe('securityHeaders middleware (production mode)', () => {
  const app = makeApp({ isProd: true })

  it('emits the expected baseline headers', async () => {
    const res = await request(app).get('/_t')
    expect(res.status).toBe(200)
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(res.headers['x-permitted-cross-domain-policies']).toBe('none')
    expect(res.headers['x-dns-prefetch-control']).toBe('off')
    expect(res.headers['x-download-options']).toBe('noopen')
    expect(res.headers['x-xss-protection']).toBe('0')
    expect(res.headers['origin-agent-cluster']).toBe('?1')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('emits HSTS with the expected max-age, subdomains, and preload', async () => {
    const res = await request(app).get('/_t')
    expect(res.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains; preload',
    )
  })

  it('emits a CSP that locks down the dangerous directives', async () => {
    const res = await request(app).get('/_t')
    const csp = parseCsp(res.headers['content-security-policy'])
    expect(csp['default-src']).toEqual(["'self'"])
    expect(csp['script-src']).toEqual(["'self'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['frame-ancestors']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'self'"])
    expect(csp['form-action']).toEqual(["'self'"])
    expect(csp['connect-src']).toEqual(["'self'"])
    expect(csp).toHaveProperty('upgrade-insecure-requests')
  })

  it('allows Google Fonts CDN in style-src and font-src', async () => {
    const res = await request(app).get('/_t')
    const csp = parseCsp(res.headers['content-security-policy'])
    expect(csp['style-src']).toContain("'self'")
    expect(csp['style-src']).toContain("'unsafe-inline'")
    expect(csp['style-src']).toContain('https://fonts.googleapis.com')
    expect(csp['font-src']).toContain("'self'")
    expect(csp['font-src']).toContain('https://fonts.gstatic.com')
    expect(csp['font-src']).toContain('data:')
  })

  it('allows https:, data:, and blob: images', async () => {
    const res = await request(app).get('/_t')
    const csp = parseCsp(res.headers['content-security-policy'])
    expect(csp['img-src']).toContain("'self'")
    expect(csp['img-src']).toContain('data:')
    expect(csp['img-src']).toContain('https:')
    expect(csp['img-src']).toContain('blob:')
  })

  it('allows blob: workers for image compression', async () => {
    const res = await request(app).get('/_t')
    const csp = parseCsp(res.headers['content-security-policy'])
    expect(csp['worker-src']).toContain('blob:')
  })

  it('does not allow unsafe-inline or unsafe-eval in script-src', async () => {
    const res = await request(app).get('/_t')
    const csp = parseCsp(res.headers['content-security-policy'])
    expect(csp['script-src']).not.toContain("'unsafe-inline'")
    expect(csp['script-src']).not.toContain("'unsafe-eval'")
  })
})

describe('securityHeaders middleware (development mode)', () => {
  const app = makeApp({ isProd: false })

  it('does not emit HSTS in development', async () => {
    const res = await request(app).get('/_t')
    expect(res.headers['strict-transport-security']).toBeUndefined()
  })

  it('omits upgrade-insecure-requests so Safari does not upgrade http://localhost', async () => {
    const res = await request(app).get('/_t')
    const csp = parseCsp(res.headers['content-security-policy'])
    expect(csp).not.toHaveProperty('upgrade-insecure-requests')
  })

  it('still emits the non-HTTPS-related hardening headers', async () => {
    const res = await request(app).get('/_t')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(res.headers['content-security-policy']).toBeDefined()
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})
