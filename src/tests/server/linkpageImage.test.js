import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { Readable } from 'node:stream'

// Storage is mocked so the successful image path runs without RustFS/MinIO;
// this test is about the response headers on a served image, not storage.
vi.mock('../../../server/services/storageService.js', () => ({
  statObject: async () => ({ size: 3, metaData: { 'content-type': 'image/webp' } }),
  getObject: async () => Readable.from(Buffer.from('abc')),
}))

let app
let signPayload

beforeAll(async () => {
  process.env.LINKPAGE_SECRET = 'image-header-test-secret'
  const routerMod = await import('../../../server/routes/publicLinkpage.js')
  ;({ signPayload } = await import('../../../server/security/linkpageTokens.js'))
  app = express()
  app.use('/api/public/linkpage', routerMod.default)
})

describe('public linkpage image headers', () => {
  it('serves the image with Cross-Origin-Resource-Policy: same-site so link.<domain> can embed it', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60
    const token = signPayload({ t: 'img', k: 'tenants/1/logo/x.webp', exp })

    const res = await request(app).get(`/api/public/linkpage/image?t=${encodeURIComponent(token)}`)

    expect(res.status).toBe(200)
    // The load-bearing header: Helmet's global default is CORP same-origin,
    // which would block the cross-subdomain <img> on the link-page app.
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site')
    expect(res.headers['content-type']).toBe('image/webp')
    expect(res.headers['content-security-policy']).toBe("default-src 'none'")
  })
})
