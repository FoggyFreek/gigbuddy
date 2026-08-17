import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, afterEach, expect, vi } from 'vitest'
import request from 'supertest'
import { verifyPayload, isValidSyncBearer } from '../../../server/promotion/linkpage/linkpageTokens.js'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let clearEntitlementCaches
let billing
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
  const entMod = await import('../../../server/entitlements/entitlementResolver.js')
  clearEntitlementCaches = entMod.clearEntitlementCaches
  billing = await import('./_billing.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  clearEntitlementCaches()
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

async function createPersonalWorkspace(userId, slug = 'solo') {
  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (slug, band_name, display_name, kind, created_by_user_id, owner_user_id)
     VALUES ($1, 'Solo Artist', 'Solo Artist', 'personal', $2, $2) RETURNING *`,
    [slug, userId],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), 'owner')`,
    [userId, tenant.id],
  )
  return tenant
}

async function seedLinkpageContent() {
  const a = seed.tenantA.id
  const b = seed.tenantB.id
  await pool.query(
    `UPDATE tenants
        SET band_name = 'Alpha Band', bio = 'Alpha full bio', short_bio = 'Alpha short bio',
            logo_path = $2, logo_dark_path = $3, avatar_path = $4, banner_path = $5
      WHERE id = $1`,
    [
      a,
      `tenants/${a}/logo/logo.webp`,
      `tenants/${a}/logo/logo-dark.webp`,
      `tenants/${a}/avatar/avatar.webp`,
      `tenants/${a}/profile-banner/banner.webp`,
    ],
  )
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
    `INSERT INTO gigs (tenant_id, event_date, event_description, status, event_link)
     VALUES ($1, CURRENT_DATE + 5, 'Alpha announced gig', 'announced', 'https://alpha.example/events/announced'),
            ($1, CURRENT_DATE + 6, 'Alpha option gig', 'option', NULL),
            ($1, CURRENT_DATE - 5, 'Alpha past gig', 'announced', NULL)`,
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

describe('isValidSyncBearer', () => {
  it('accepts the secret however the delimiter is padded', () => {
    expect(isValidSyncBearer(`Bearer ${SECRET}`)).toBe(true)
    expect(isValidSyncBearer(`Bearer    ${SECRET}`)).toBe(true)
    expect(isValidSyncBearer(`Bearer\t${SECRET}`)).toBe(true)
  })

  it('rejects a missing, empty or whitespace-only credential', () => {
    expect(isValidSyncBearer(undefined)).toBe(false)
    expect(isValidSyncBearer('Bearer')).toBe(false)
    expect(isValidSyncBearer('Bearer   ')).toBe(false)
    expect(isValidSyncBearer(`Basic ${SECRET}`)).toBe(false)
    expect(isValidSyncBearer('Bearer nope')).toBe(false)
  })

  // The credential pattern must stay unambiguous: a greedy `\s+` followed by a
  // `.+` that can also match spaces backtracks quadratically on a value the
  // dot cannot span (a trailing newline). Node's header parser rejects such a
  // value today, so this is defence in depth for any non-HTTP caller.
  it('scans a pathological value in linear time', () => {
    const started = Date.now()
    expect(isValidSyncBearer(`Bearer${' '.repeat(50_000)}\n`)).toBe(false)
    expect(Date.now() - started).toBeLessThan(100)
  })
})

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

  it('404s for a personal workspace slug — link pages are a band surface', async () => {
    await createPersonalWorkspace(seed.userA.id)
    const res = await request(app)
      .get('/api/public/linkpage/export/solo')
      .set('Authorization', `Bearer ${SECRET}`)
    expect(res.status).toBe(404)
  })

  it('exports only the requested tenant, announced future gigs, and linked songs', async () => {
    await seedLinkpageContent()
    const res = await request(app)
      .get('/api/public/linkpage/export/alpha')
      .set('Authorization', `Bearer ${SECRET}`)
    expect(res.status).toBe(200)

    // The `bio` key on the wire carries the 150-char short bio, not the long-form one.
    expect(res.body.band).toMatchObject({ slug: 'alpha', name: 'Alpha Band', bio: 'Alpha short bio' })
    // Light logo, dark logo, profile picture and band banner are exposed as signed image URLs.
    for (const key of ['logoUrl', 'logoDarkUrl', 'avatarUrl', 'bannerUrl']) {
      expect(res.body.band[key]).toContain('https://app.test.local/api/public/linkpage/image?t=')
    }
    const imageUrls = ['logoUrl', 'logoDarkUrl', 'avatarUrl', 'bannerUrl'].map((k) => res.body.band[k])
    expect(new Set(imageUrls).size).toBe(4)

    // Songs: only those with links; links ordered.
    expect(res.body.songs).toHaveLength(1)
    expect(res.body.songs[0]).toMatchObject({ title: 'Alpha Anthem', artist: 'Alpha Band' })
    expect(res.body.songs[0].links.map((l) => l.label)).toEqual(['Spotify', 'YouTube'])

    // Gigs: announced + future only.
    expect(res.body.gigs.map((g) => g.title)).toEqual(['Alpha announced gig'])
    expect(res.body.gigs[0].eventUrl).toBe('https://alpha.example/events/announced')

    expect(res.body.products).toEqual([expect.objectContaining({ name: 'Alpha CD', priceCents: 999 })])
    expect(res.body.links).toEqual([expect.objectContaining({ label: 'Website', url: 'https://alpha.example' })])

    // Ownerless tenant: enforcement skipped → most permissive entitlements.
    expect(res.body.entitlements).toEqual({ enabled: true, maxReleasePages: null, statsRetentionDays: 90 })

    // Tenant isolation: nothing of tenant B may appear anywhere.
    const flat = JSON.stringify(res.body)
    expect(flat).not.toContain('Beta')
    // The long-form bio stays in the app and is never shipped to the linkpage app.
    expect(flat).not.toContain('Alpha full bio')
  })

  it('ships plan-derived entitlements: silver 3 pages/30d, gold 30 pages/90d, lapsed disabled', async () => {
    const exportEntitlements = async () => {
      clearEntitlementCaches()
      const res = await request(app)
        .get('/api/public/linkpage/export/alpha')
        .set('Authorization', `Bearer ${SECRET}`)
      expect(res.status).toBe(200)
      return res.body.entitlements
    }

    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    // Owner without a subscription → bronze fallback → feature off.
    expect(await exportEntitlements()).toEqual({
      enabled: false,
      maxReleasePages: 0,
      statsRetentionDays: 30,
    })

    const sub = await billing.createSubscription({ userId: seed.userA.id, planSlug: 'silver' })
    expect(await exportEntitlements()).toEqual({
      enabled: true,
      maxReleasePages: 3,
      statsRetentionDays: 30,
    })

    // The plan lives on the module row, not the subscription: alpha is a band
    // tenant, so it is the BAND module that moves up to gold.
    await pool.query(
      `UPDATE subscription_modules SET plan_id = (SELECT id FROM subscription_plans WHERE slug = 'gold')
        WHERE subscription_id = $1 AND audience = 'band'`,
      [sub.id],
    )
    expect(await exportEntitlements()).toEqual({
      enabled: true,
      maxReleasePages: 30,
      statsRetentionDays: 90,
    })
  })
})

describe('public linkpage image', () => {
  it('404s on missing, tampered, or expired tokens', async () => {
    const missing = await request(app).get('/api/public/linkpage/image')
    expect(missing.status).toBe(404)

    const tampered = await request(app).get('/api/public/linkpage/image?t=abc.def')
    expect(tampered.status).toBe(404)

    // Signed but expired token.
    const { signPayload } = await import('../../../server/promotion/linkpage/linkpageTokens.js')
    const expired = signPayload({ t: 'img', k: `tenants/${seed.tenantA.id}/logo/x.webp`, exp: 1 })
    const res = await request(app).get(`/api/public/linkpage/image?t=${encodeURIComponent(expired)}`)
    expect(res.status).toBe(404)
  })

  it('404s on valid signatures over non-tenant object keys', async () => {
    const { signPayload } = await import('../../../server/promotion/linkpage/linkpageTokens.js')
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

  it('is reserved to tenant admins — a contributor is denied', async () => {
    const { rows: [contributor] } = await pool.query(
      `INSERT INTO users (google_sub, email, name, status) VALUES ('sub-c', 'c@test.local', 'Contrib', 'approved') RETURNING id`,
    )
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source) VALUES ($1, $2, 'contributor', 'approved', NOW(), 'admin')`,
      [contributor.id, seed.tenantA.id],
    )
    const asContributor = (req) =>
      req.set('x-test-user-id', String(contributor.id)).set('x-test-tenant-id', String(seed.tenantA.id))
    expect((await asContributor(request(app).post('/api/linkpage/handoff'))).status).toBe(403)
    expect((await asContributor(request(app).get('/api/linkpage/status'))).status).toBe(403)
    expect((await asContributor(request(app).get('/api/linkpage/stats'))).status).toBe(403)
  })

  it('is refused in a personal workspace — the owner is admin, the kind gate denies', async () => {
    const workspace = await createPersonalWorkspace(seed.userA.id)
    const asOwner = (req) =>
      req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(workspace.id))

    const handoff = await asOwner(request(app).post('/api/linkpage/handoff'))
    expect(handoff.status).toBe(403)
    expect(handoff.body.code).toBe('tenant_kind_not_supported')

    const status = await asOwner(request(app).get('/api/linkpage/status'))
    expect(status.status).toBe(403)
    expect(status.body.code).toBe('tenant_kind_not_supported')

    const stats = await asOwner(request(app).get('/api/linkpage/stats'))
    expect(stats.status).toBe(403)
    expect(stats.body.code).toBe('tenant_kind_not_supported')
  })

  it('is gated on the linkpage entitlement (bronze fallback is denied)', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    clearEntitlementCaches()
    const res = await asUserA(request(app).post('/api/linkpage/handoff'))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('entitlement_required')
    expect(res.body.feature).toBe('linkpage')

    const stats = await asUserA(request(app).get('/api/linkpage/stats'))
    expect(stats.status).toBe(403)
    expect(stats.body.feature).toBe('linkpage')
  })

  it('mints a verifiable short-lived token bound to the active tenant', async () => {
    const res = await asUserA(request(app).post('/api/linkpage/handoff'))
    expect(res.status).toBe(200)
    expect(res.body.url).toMatch(/^https:\/\/link\.test\.local\/edit#gbtoken=/)

    const token = decodeURIComponent(res.body.url.split('#gbtoken=')[1])
    const payload = verifyPayload(token)
    expect(payload).toMatchObject({
      t: 'handoff', slug: 'alpha', slugRevision: 0, tenantId: seed.tenantA.id,
    })
    expect(payload.exp * 1000).toBeGreaterThan(Date.now())
  })

  it('reports status with the public page URL', async () => {
    const res = await asUserA(request(app).get('/api/linkpage/status'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      configured: true,
      publicUrl: 'https://link.test.local/alpha',
      linkpageSync: 'synced',
    })
  })

  it('reports a pending namespace migration until the outbox operation completes', async () => {
    await pool.query(
      `INSERT INTO linkpage_slug_sync_operations
         (tenant_id, old_slug, new_slug, slug_revision)
       VALUES ($1, 'alpha-old', 'alpha', 1)`,
      [seed.tenantA.id],
    )

    const res = await asUserA(request(app).get('/api/linkpage/status'))
    expect(res.status).toBe(200)
    expect(res.body.linkpageSync).toBe('pending')
  })
})

describe('linkpage stats', () => {
  const payload = {
    hasPage: true,
    pageId: 8,
    slug: 'the-band',
    days: 7,
    retentionDays: 30,
    enabled: true,
    totalViews: 200,
    uniqueVisits: 120,
    totalClicks: 50,
    clickThroughRate: 25,
    byDay: [{ day: '2026-08-01', views: 12, clicks: { platform: 3, shop: 1 } }],
  }

  const upstream = (status, body) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requires an authenticated tenant member', async () => {
    const fetchSpy = upstream(200, payload)
    const res = await request(app).get('/api/linkpage/stats')
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('proxies the aggregate summary for the active tenant', async () => {
    const fetchSpy = upstream(200, payload)
    const res = await asUserA(request(app).get('/api/linkpage/stats?days=7'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual(payload)
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://link.test.local/api/integrations/gigbuddy/tenants/${seed.tenantA.id}/stats?days=7`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${SECRET}` }) }),
    )
  })

  it('defaults to the 30-day window', async () => {
    const fetchSpy = upstream(200, { ...payload, days: 30 })
    const res = await asUserA(request(app).get('/api/linkpage/stats'))
    expect(res.status).toBe(200)
    expect(fetchSpy.mock.calls[0][0]).toContain('?days=30')
  })

  // Isolation: the tenant on the wire is the session's active tenant, never a
  // client-supplied id, so a member of alpha can only ever pull alpha's page.
  it('reads the tenant from the session, ignoring any id the caller supplies', async () => {
    const fetchSpy = upstream(200, payload)
    const res = await asUserA(
      request(app).get(`/api/linkpage/stats?days=7&tenantId=${seed.tenantB.id}&tenant_id=${seed.tenantB.id}`),
    )
    expect(res.status).toBe(200)
    expect(fetchSpy.mock.calls[0][0]).toContain(`/tenants/${seed.tenantA.id}/stats`)
    expect(fetchSpy.mock.calls[0][0]).not.toContain(`/tenants/${seed.tenantB.id}/`)
  })

  it('403s a member asking for a tenant they do not belong to', async () => {
    const fetchSpy = upstream(200, payload)
    const res = await request(app)
      .get('/api/linkpage/stats')
      .set('x-test-user-id', String(seed.userB.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('forwards the selected page to the link page app', async () => {
    const fetchSpy = upstream(200, { ...payload, pageId: 9, slug: 'the-band/single' })
    const res = await asUserA(request(app).get('/api/linkpage/stats?days=7&pageId=9'))
    expect(res.status).toBe(200)
    expect(res.body.pageId).toBe(9)
    expect(fetchSpy.mock.calls[0][0]).toContain('&pageId=9')
  })

  it('omits pageId entirely when none is selected, so the main page answers', async () => {
    const fetchSpy = upstream(200, payload)
    await asUserA(request(app).get('/api/linkpage/stats?days=7'))
    expect(fetchSpy.mock.calls[0][0]).not.toContain('pageId')
  })

  it.each(['0', '-2', '1.5', 'nine'])('refuses the malformed page id %s', async (pageId) => {
    const fetchSpy = upstream(200, payload)
    const res = await asUserA(request(app).get(`/api/linkpage/stats?days=7&pageId=${pageId}`))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_page')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // A page id from another tenant is unknown to the link page app's
  // tenant-scoped lookup, so it comes back 404 — never another band's numbers.
  it('reports a page the link page app cannot resolve as 404, not an outage', async () => {
    upstream(404, { code: 'page_not_found' })
    const res = await asUserA(request(app).get('/api/linkpage/stats?days=7&pageId=999999'))
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('linkpage_page_not_found')
  })

  it.each(['1', '90', '7.5', 'week', ''])('refuses the unsupported window %s', async (days) => {
    const fetchSpy = upstream(200, payload)
    const res = await asUserA(request(app).get(`/api/linkpage/stats?days=${days}`))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_window')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('passes the "no page yet" outcome through unchanged', async () => {
    upstream(200, { hasPage: false })
    const res = await asUserA(request(app).get('/api/linkpage/stats?days=7'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ hasPage: false })
  })

  it.each([
    [500, {}],
    [401, {}],
    [200, { hasPage: true, totalViews: 'many' }],
  ])('turns an unusable upstream reply (%s) into 502 without leaking its detail', async (status, body) => {
    upstream(status, body)
    const res = await asUserA(request(app).get('/api/linkpage/stats?days=30'))
    expect(res.status).toBe(502)
    expect(res.body.code).toBe('linkpage_stats_unavailable')
    expect(JSON.stringify(res.body)).not.toContain(SECRET)
  })

  it('turns a transport failure into 502 rather than a crash', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const res = await asUserA(request(app).get('/api/linkpage/stats?days=30'))
    expect(res.status).toBe(502)
  })
})

describe('linkpage page list', () => {
  const upstreamPages = [
    { id: 8, slug: 'alpha', pageType: 'main', release: null, publishedAt: '2026-07-01T10:00:00.000Z' },
    { id: 9, slug: 'alpha/single', pageType: 'release', release: { title: 'New Single' }, publishedAt: null },
  ]

  const upstream = (status, body) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requires an authenticated tenant member', async () => {
    const fetchSpy = upstream(200, { pages: upstreamPages })
    expect((await request(app).get('/api/linkpage/pages')).status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lists the active tenant pages, reduced to what a picker needs', async () => {
    const fetchSpy = upstream(200, { pages: upstreamPages })
    const res = await asUserA(request(app).get('/api/linkpage/pages'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      pages: [
        { id: 8, slug: 'alpha', pageType: 'main', title: null, published: true },
        { id: 9, slug: 'alpha/single', pageType: 'release', title: 'New Single', published: false },
      ],
    })
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `https://link.test.local/api/integrations/gigbuddy/tenants/${seed.tenantA.id}/pages`,
    )
  })

  it('reads the tenant from the session, never from the request', async () => {
    const fetchSpy = upstream(200, { pages: [] })
    await asUserA(request(app).get(`/api/linkpage/pages?tenantId=${seed.tenantB.id}`))
    expect(fetchSpy.mock.calls[0][0]).toContain(`/tenants/${seed.tenantA.id}/pages`)
  })

  it('turns an unusable upstream reply into 502', async () => {
    upstream(200, { pages: 'nope' })
    const res = await asUserA(request(app).get('/api/linkpage/pages'))
    expect(res.status).toBe(502)
    expect(res.body.code).toBe('linkpage_stats_unavailable')
  })
})

// The link page app authorizes by tenant id alone (the shared secret speaks for
// GigBuddy as a whole), so the id GigBuddy puts on the wire is the entire
// isolation boundary. It must come from the session's active tenant and from
// nowhere else.
describe('linkpage statistics tenant isolation', () => {
  const statsFor = (tenantId, pageId) => ({
    hasPage: true,
    pageId,
    slug: `tenant-${tenantId}`,
    days: 30,
    retentionDays: 30,
    enabled: true,
    totalViews: tenantId,
    uniqueVisits: tenantId,
    totalClicks: 1,
    clickThroughRate: 1,
    byDay: [],
  })

  // Answers whichever tenant the URL names, so a mixed-up id shows up as the
  // wrong tenant's numbers rather than as a failure.
  function upstreamByTenant() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const tenantId = Number(/\/tenants\/(\d+)\//.exec(String(url))[1])
      const body = String(url).includes('/pages')
        ? { pages: [{ id: tenantId * 10, slug: `tenant-${tenantId}`, pageType: 'main', release: null, publishedAt: null }] }
        : statsFor(tenantId, tenantId * 10)
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })
  }

  const asSuperUserIn = (req, tenantId) => req
    .set('x-test-user-id', String(seed.superUser.id))
    .set('x-test-tenant-id', String(tenantId))

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // The super user is an approved admin of both tenants — the case where the
  // caller's identity cannot decide which band's numbers are meant.
  it('follows the active tenant for a member of two tenants', async () => {
    upstreamByTenant()

    const inA = await asSuperUserIn(request(app).get('/api/linkpage/stats?days=30'), seed.tenantA.id)
    expect(inA.status).toBe(200)
    expect(inA.body.totalViews).toBe(seed.tenantA.id)
    expect(inA.body.slug).toBe(`tenant-${seed.tenantA.id}`)

    const inB = await asSuperUserIn(request(app).get('/api/linkpage/stats?days=30'), seed.tenantB.id)
    expect(inB.status).toBe(200)
    expect(inB.body.totalViews).toBe(seed.tenantB.id)
    expect(inB.body.slug).toBe(`tenant-${seed.tenantB.id}`)
  })

  it('scopes the page list to the active tenant for the same member', async () => {
    upstreamByTenant()

    const inA = await asSuperUserIn(request(app).get('/api/linkpage/pages'), seed.tenantA.id)
    expect(inA.body.pages).toEqual([
      { id: seed.tenantA.id * 10, slug: `tenant-${seed.tenantA.id}`, pageType: 'main', title: null, published: false },
    ])

    const inB = await asSuperUserIn(request(app).get('/api/linkpage/pages'), seed.tenantB.id)
    expect(inB.body.pages[0].slug).toBe(`tenant-${seed.tenantB.id}`)
  })

  // Every shape a caller could use to name a different tenant. None of them is
  // read: req.tenantId comes from the session, so the wire always says alpha.
  it.each([
    ['query tenantId', `?days=30&tenantId=${'B'}`],
    ['query tenant_id', `?days=30&tenant_id=${'B'}`],
    ['repeated days', '?days=30&days=7'],
  ])('ignores %s when naming the upstream tenant', async (_label, suffix) => {
    const fetchSpy = upstreamByTenant()
    const query = suffix.replace(/B/g, String(seed.tenantB.id))
    const res = await asUserA(request(app).get(`/api/linkpage/stats${query}`))

    expect([200, 400]).toContain(res.status)
    for (const [url] of fetchSpy.mock.calls) {
      expect(String(url)).toContain(`/tenants/${seed.tenantA.id}/`)
      expect(String(url)).not.toContain(`/tenants/${seed.tenantB.id}/`)
    }
  })

  it('ignores a tenant id supplied as a header', async () => {
    const fetchSpy = upstreamByTenant()
    const res = await asUserA(
      request(app).get('/api/linkpage/stats?days=30').set('x-tenant-id', String(seed.tenantB.id)),
    )
    expect(res.status).toBe(200)
    expect(res.body.totalViews).toBe(seed.tenantA.id)
    expect(String(fetchSpy.mock.calls[0][0])).toContain(`/tenants/${seed.tenantA.id}/`)
  })

  // A page id is NOT an authorization token. GigBuddy forwards it unchanged
  // under the caller's own tenant, so the link page app's tenant-scoped lookup
  // is what refuses it — and it comes back as a plain 404.
  it('forwards a foreign page id under the caller tenant, so it resolves to nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'page_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const res = await asUserA(request(app).get('/api/linkpage/stats?days=30&pageId=987654'))

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('linkpage_page_not_found')
    expect(res.body.totalViews).toBeUndefined()
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      `https://link.test.local/api/integrations/gigbuddy/tenants/${seed.tenantA.id}/stats?days=30&pageId=987654`,
    )
  })

  it('refuses a non-member before any call leaves the server', async () => {
    const fetchSpy = upstreamByTenant()
    const asOutsider = (req) => req
      .set('x-test-user-id', String(seed.userB.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))

    expect((await asOutsider(request(app).get('/api/linkpage/stats?days=30'))).status).toBe(403)
    expect((await asOutsider(request(app).get('/api/linkpage/pages'))).status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a member whose session has no active tenant', async () => {
    const fetchSpy = upstreamByTenant()
    const res = await request(app)
      .get('/api/linkpage/stats?days=30')
      .set('x-test-user-id', String(seed.userA.id))
    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
