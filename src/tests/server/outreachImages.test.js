import './_envSetup.js'
// @vitest-environment node
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const storage = vi.hoisted(() => ({
  objects: new Map(),
  getObject: vi.fn(),
  statObject: vi.fn(),
}))

vi.mock('../../../server/platform/files/storageService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getObject: storage.getObject,
  statObject: storage.statObject,
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed

beforeAll(async () => {
  const db = await import('./_db.js')
  const appModule = await import('./_app.js')
  ;({ pool, runMigrations, truncateAll, seedTwoTenants } = db)
  app = appModule.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  process.env.APP_URL = 'https://app.test'
  storage.objects.clear()
  storage.getObject.mockImplementation(async (key) => {
    const object = storage.objects.get(key)
    if (!object) throw new Error('missing')
    return Readable.from([object.buffer])
  })
  storage.statObject.mockImplementation(async (key) => {
    const object = storage.objects.get(key)
    if (!object) throw new Error('missing')
    return {
      size: object.buffer.length,
      etag: object.etag,
      lastModified: new Date('2026-08-21T10:00:00Z'),
      metaData: { 'content-type': object.contentType },
    }
  })
})

afterAll(async () => {
  delete process.env.APP_URL
  await pool.end()
})

const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))

describe('outreach image library', () => {
  it('returns only current-tenant availability and stable URLs without object keys', async () => {
    await pool.query(
      `UPDATE tenants
          SET logo_path = $2, avatar_path = $3, instagram_handle = 'alpha-band'
        WHERE id = $1`,
      [seed.tenantA.id, `tenants/${seed.tenantA.id}/logo/light.png`, `tenants/${seed.tenantA.id}/avatar/avatar.webp`],
    )
    await pool.query(
      `INSERT INTO tenant_integrations (tenant_id, bandsintown_artist_id)
       VALUES ($1, '15556138')`,
      [seed.tenantA.id],
    )
    await pool.query(
      `UPDATE tenants SET logo_path = $2, facebook_handle = 'private-band' WHERE id = $1`,
      [seed.tenantB.id, `tenants/${seed.tenantB.id}/logo/private.png`],
    )

    const response = await asUserA(request(app).get('/api/outreach/images')).expect(200)

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'logo-light', available: true }),
      expect.objectContaining({ key: 'logo-dark', available: false }),
      expect.objectContaining({ key: 'instagram', available: true }),
      expect.objectContaining({ key: 'facebook', available: false }),
      expect.objectContaining({ key: 'bandsintown', available: true }),
    ]))
    expect(JSON.stringify(response.body)).not.toContain(`tenants/${seed.tenantA.id}/`)
    expect(JSON.stringify(response.body)).not.toContain(`tenants/${seed.tenantB.id}/`)
    const token = new URL(response.body.find((item) => item.key === 'avatar').src).searchParams.get('t')
    const { rows } = await pool.query('SELECT tenant_id FROM outreach_image_tokens WHERE token = $1', [token])
    expect(rows).toEqual([{ tenant_id: seed.tenantA.id }])
  })

  it('serves a circular avatar through the same URL after replacement', async () => {
    const firstKey = `tenants/${seed.tenantA.id}/avatar/first.webp`
    const secondKey = `tenants/${seed.tenantA.id}/avatar/second.webp`
    storage.objects.set(firstKey, {
      buffer: await sharp({ create: { width: 20, height: 20, channels: 3, background: '#cc1122' } }).webp().toBuffer(),
      contentType: 'image/webp', etag: 'first',
    })
    storage.objects.set(secondKey, {
      buffer: await sharp({ create: { width: 20, height: 20, channels: 3, background: '#1133cc' } }).webp().toBuffer(),
      contentType: 'image/webp', etag: 'second',
    })
    await pool.query('UPDATE tenants SET avatar_path = $2 WHERE id = $1', [seed.tenantA.id, firstKey])
    const catalog = await asUserA(request(app).get('/api/outreach/images')).expect(200)
    const avatarUrl = new URL(catalog.body.find((item) => item.key === 'avatar').src)

    const first = await request(app).get(`${avatarUrl.pathname}${avatarUrl.search}`).expect(200)
    expect(first.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'public, no-cache',
      'cross-origin-resource-policy': 'cross-origin',
    })
    expect(first.body).toBeInstanceOf(Buffer)

    await pool.query('UPDATE tenants SET avatar_path = $2 WHERE id = $1', [seed.tenantA.id, secondKey])
    const second = await request(app).get(`${avatarUrl.pathname}${avatarUrl.search}`).expect(200)
    expect(second.body.equals(first.body)).toBe(false)
    await request(app).get('/api/public/outreach/image/avatar?t=invalid').expect(404)
  })
})

