import './_envSetup.js'
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { Readable } from 'node:stream'

// Exercise the public HTTP contract without depending on the object store.
vi.mock('../../../server/platform/files/storageService.js', () => ({
  statObject: async () => ({ size: 3, metaData: { 'content-type': 'image/webp' } }),
  getObject: async () => Readable.from(Buffer.from('abc')),
}))

let app
let signPayload

beforeAll(async () => {
  process.env.LINKPAGE_SECRET = 'image-header-test-secret'
  const routerMod = await import('../../../server/promotion/linkpage/publicLinkpage.js')
  ;({ signPayload } = await import('../../../server/promotion/linkpage/linkpageTokens.js'))
  app = express()
  app.use('/api/public/linkpage', routerMod.default)
})

describe('LinkBuddy public image endpoint', () => {
  it('returns the same 404 for absent, invalid, expired, and non-tenant tokens', async () => {
    const expired = signPayload({ t: 'img', k: 'tenants/1/logo/x.webp', exp: 1 })
    const nonTenant = signPayload({
      t: 'img', k: 'internal/backup.sql', exp: Math.floor(Date.now() / 1000) + 60,
    })

    for (const url of [
      '/api/public/linkpage/image',
      '/api/public/linkpage/image?t=abc.def',
      `/api/public/linkpage/image?t=${encodeURIComponent(expired)}`,
      `/api/public/linkpage/image?t=${encodeURIComponent(nonTenant)}`,
    ]) {
      expect((await request(app).get(url)).status).toBe(404)
    }
  })

  it('streams signed tenant images for the sibling link subdomain', async () => {
    const token = signPayload({
      t: 'img', k: 'tenants/1/logo/x.webp', exp: Math.floor(Date.now() / 1000) + 60,
    })
    const res = await request(app).get(`/api/public/linkpage/image?t=${encodeURIComponent(token)}`)

    expect(res.status).toBe(200)
    // The link page is served from a sibling subdomain, so Helmet's default
    // same-origin policy would prevent its <img> elements from rendering.
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site')
    expect(res.headers['content-type']).toBe('image/webp')
    expect(res.headers['content-security-policy']).toBe("default-src 'none'")
  })
})
