import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { verifyPayload } from '../../../server/security/linkpageTokens.js'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed

const SECRET = 'test-linkpage-secret'

beforeAll(async () => {
  process.env.LINKPAGE_SECRET = SECRET
  process.env.LINKPAGE_URL = 'https://link.test.local'
  process.env.APP_URL = 'https://app.test.local'
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

async function seedLinkpageContent() {
  const a = seed.tenantA.id
  const b = seed.tenantB.id
  await pool.query(`UPDATE tenants SET band_name = 'Alpha Band', bio = 'Alpha bio', logo_path = $2 WHERE id = $1`, [
    a,
    `tenants/${a}/logo/logo.webp`,
  ])
  // Tenant A: one song with two links, one song without links, a product,
  // an announced future gig, an option future gig (must not export), an
  // announced past gig (must not export), and a profile link.
  const { rows: [songA] } = await pool.query(
    `INSERT INTO songs (tenant_id, title, artist) VALUES ($1, 'Alpha Anthem', 'Alpha Band') RETURNING id`,
    [a],
  )
  await pool.query(
    `INSERT INTO song_links (song_id, tenant_id, label, url, sort_order)
     VALUES ($1, $2, 'Spotify', 'https://open.spotify.com/track/alpha', 0),
            ($1, $2, 'YouTube', 'https://youtube.com/watch?v=alpha', 1)`,
    [songA.id, a],
  )
  await pool.query(`INSERT INTO songs (tenant_id, title) VALUES ($1, 'Alpha Unlinked')`, [a])
  await pool.query(
    `INSERT INTO products (tenant_id, name, default_price_incl_cents) VALUES ($1, 'Alpha CD', 999)`,
    [a],
  )
  await pool.query(
    `INSERT INTO gigs (tenant_id, event_date, event_description, status)
     VALUES ($1, CURRENT_DATE + 5, 'Alpha announced gig', 'announced'),
            ($1, CURRENT_DATE + 6, 'Alpha option gig', 'option'),
            ($1, CURRENT_DATE - 5, 'Alpha past gig', 'announced')`,
    [a],
  )
  await pool.query(
    `INSERT INTO profile_links (tenant_id, label, url, sort_order) VALUES ($1, 'Website', 'https://alpha.example', 0)`,
    [a],
  )
  // Tenant B mirror content that must never leak into tenant A's export.
  const { rows: [songB] } = await pool.query(
    `INSERT INTO songs (tenant_id, title) VALUES ($1, 'Beta Ballad') RETURNING id`,
    [b],
  )
  await pool.query(
    `INSERT INTO song_links (song_id, tenant_id, label, url, sort_order)
     VALUES ($1, $2, 'Spotify', 'https://open.spotify.com/track/beta', 0)`,
    [songB.id, b],
  )
  await pool.query(`INSERT INTO products (tenant_id, name, default_price_incl_cents) VALUES ($1, 'Beta Shirt', 1500)`, [b])
  await pool.query(
    `INSERT INTO gigs (tenant_id, event_date, event_description, status)
     VALUES ($1, CURRENT_DATE + 7, 'Beta announced gig', 'announced')`,
    [b],
  )
}

describe('public linkpage export', () => {
  it('rejects requests without the shared-secret bearer', async () => {
    await seedLinkpageContent()
    const bare = await request(app).get('/api/public/linkpage/export/alpha')
    expect(bare.status).toBe(401)
    const wrong = await request(app)
      .get('/api/public/linkpage/export/alpha')
      .set('Authorization', 'Bearer nope')
    expect(wrong.status).toBe(401)
  })

  it('404s for unknown slugs', async () => {
    const res = await request(app)
      .get('/api/public/linkpage/export/does-not-exist')
      .set('Authorization', `Bearer ${SECRET}`)
    expect(res.status).toBe(404)
  })

  it('exports only the requested tenant, announced future gigs, and linked songs', async () => {
    await seedLinkpageContent()
    const res = await request(app)
      .get('/api/public/linkpage/export/alpha')
      .set('Authorization', `Bearer ${SECRET}`)
    expect(res.status).toBe(200)

    expect(res.body.band).toMatchObject({ slug: 'alpha', name: 'Alpha Band', bio: 'Alpha bio' })
    expect(res.body.band.logoUrl).toContain('https://app.test.local/api/public/linkpage/image?t=')

    // Songs: only those with links; links ordered.
    expect(res.body.songs).toHaveLength(1)
    expect(res.body.songs[0]).toMatchObject({ title: 'Alpha Anthem', artist: 'Alpha Band' })
    expect(res.body.songs[0].links.map((l) => l.label)).toEqual(['Spotify', 'YouTube'])

    // Gigs: announced + future only.
    expect(res.body.gigs.map((g) => g.title)).toEqual(['Alpha announced gig'])

    expect(res.body.products).toEqual([expect.objectContaining({ name: 'Alpha CD', priceCents: 999 })])
    expect(res.body.links).toEqual([expect.objectContaining({ label: 'Website', url: 'https://alpha.example' })])

    // Tenant isolation: nothing of tenant B may appear anywhere.
    const flat = JSON.stringify(res.body)
    expect(flat).not.toContain('Beta')
  })
})

describe('public linkpage image', () => {
  it('404s on missing, tampered, or expired tokens', async () => {
    const missing = await request(app).get('/api/public/linkpage/image')
    expect(missing.status).toBe(404)

    const tampered = await request(app).get('/api/public/linkpage/image?t=abc.def')
    expect(tampered.status).toBe(404)

    // Signed but expired token.
    const { signPayload } = await import('../../../server/security/linkpageTokens.js')
    const expired = signPayload({ t: 'img', k: `tenants/${seed.tenantA.id}/logo/x.webp`, exp: 1 })
    const res = await request(app).get(`/api/public/linkpage/image?t=${encodeURIComponent(expired)}`)
    expect(res.status).toBe(404)
  })

  it('404s on valid signatures over non-tenant object keys', async () => {
    const { signPayload } = await import('../../../server/security/linkpageTokens.js')
    const exp = Math.floor(Date.now() / 1000) + 60
    const sneaky = signPayload({ t: 'img', k: 'internal/backup.sql', exp })
    const res = await request(app).get(`/api/public/linkpage/image?t=${encodeURIComponent(sneaky)}`)
    expect(res.status).toBe(404)
  })
})

describe('linkpage handoff', () => {
  it('requires an authenticated tenant member', async () => {
    const res = await request(app).post('/api/linkpage/handoff')
    expect(res.status).toBe(401)
  })

  it('mints a verifiable short-lived token bound to the active tenant', async () => {
    const res = await asUserA(request(app).post('/api/linkpage/handoff'))
    expect(res.status).toBe(200)
    expect(res.body.url).toMatch(/^https:\/\/link\.test\.local\/edit#gbtoken=/)

    const token = decodeURIComponent(res.body.url.split('#gbtoken=')[1])
    const payload = verifyPayload(token)
    expect(payload).toMatchObject({ t: 'handoff', slug: 'alpha', tenantId: seed.tenantA.id })
    expect(payload.exp * 1000).toBeGreaterThan(Date.now())
  })

  it('reports status with the public page URL', async () => {
    const res = await asUserA(request(app).get('/api/linkpage/status'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ configured: true, publicUrl: 'https://link.test.local/alpha' })
  })
})
