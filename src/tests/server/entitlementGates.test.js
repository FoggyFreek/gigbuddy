import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FEATURE_KEYS } from '../../../shared/entitlements.js'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let clearEntitlementCaches
let billing
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  const entMod = await import('../../../server/services/entitlementService.js')
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

const asUserA = (req) =>
  req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))

// Owner set but no subscription → fallback-locked (bronze: all features off).
async function lockTenantA() {
  await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
}

async function goldTenantA() {
  await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
  return billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
}

function expectEntitlementDenied(res, feature) {
  expect(res.status).toBe(403)
  expect(res.body.code).toBe('entitlement_required')
  expect(res.body.feature).toBe(feature)
}

describe('ownerless tenants bypass every gate', () => {
  it('finance writes, integrations, customization all pass', async () => {
    const finance = await asUserA(request(app).post('/api/accounts').send({}))
    expect(finance.status).not.toBe(403)
    const accent = await asUserA(request(app).patch('/api/profile').send({ accent_color: '#ff0000' }))
    expect(accent.status).toBe(200)
    const feed = await asUserA(request(app).get('/api/calendar-feed'))
    expect(feed.status).not.toBe(403)
    const me = await asUserA(request(app).get('/api/auth/me')).expect(200)
    expect(me.body.entitlements).toBeNull()
  })
})

describe('finance read-only mode (fallback-locked tenant)', () => {
  it('blocks finance writes with entitlement_required', async () => {
    await lockTenantA()
    expectEntitlementDenied(await asUserA(request(app).post('/api/accounts').send({})), 'finance')
    expectEntitlementDenied(await asUserA(request(app).post('/api/purchases').send({})), 'finance')
    expectEntitlementDenied(await asUserA(request(app).post('/api/journal').send({})), 'finance')
  })

  it('keeps finance reads working', async () => {
    await lockTenantA()
    await asUserA(request(app).get('/api/accounts')).expect(200)
    await asUserA(request(app).get('/api/purchases')).expect(200)
  })

  it('allows finance writes again on a plan with finance', async () => {
    await goldTenantA()
    const res = await asUserA(request(app).post('/api/accounts').send({}))
    expect(res.status).not.toBe(403)
  })
})

describe('integrations gates', () => {
  it('blocks the bandsintown router entirely', async () => {
    await lockTenantA()
    expectEntitlementDenied(await asUserA(request(app).get('/api/bandsintown/search')), 'integrations')
  })

  it('blocks setting credentials but keeps status reads and erasure open', async () => {
    await lockTenantA()
    expectEntitlementDenied(
      await asUserA(request(app).put('/api/profile/bandsintown-key').send({ key: 'x' })),
      'integrations',
    )
    expectEntitlementDenied(
      await asUserA(request(app).put('/api/profile/mollie-key').send({ key: `test_${'a'.repeat(25)}` })),
      'integrations',
    )
    // An admin must always be able to see and remove stored secrets.
    await asUserA(request(app).get('/api/profile/mollie-key')).expect(200)
    await asUserA(request(app).delete('/api/profile/mollie-key')).expect(200)
    await asUserA(request(app).delete('/api/profile/shopify-secret')).expect(200)
  })

  it('blocks minting feed tokens but keeps describe and revoke open', async () => {
    await lockTenantA()
    expectEntitlementDenied(await asUserA(request(app).post('/api/calendar-feed/regenerate')), 'integrations')
    await asUserA(request(app).get('/api/calendar-feed')).expect(200)
    await asUserA(request(app).delete('/api/calendar-feed')).expect(204)
  })

  it('blocks Shopify usage and new Mollie payment links behind finance-only access', async () => {
    // finance: true but integrations: false — integration usage must still 403.
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    await billing.createSubscription({
      userId: seed.userA.id,
      planSlug: 'gold',
      entitlement_overrides: { features: { integrations: false } },
    })
    expectEntitlementDenied(await asUserA(request(app).get('/api/merch/shopify/orders')), 'integrations')
    expectEntitlementDenied(
      await asUserA(request(app).post('/api/merch/shopify/import').send({})),
      'integrations',
    )
    expectEntitlementDenied(
      await asUserA(request(app).post('/api/invoices/999999/payment-link').send({})),
      'integrations',
    )
    // Existing links keep settling and can be cleaned up: sync/delete pass the
    // gate (404 here because the invoice doesn't exist).
    const sync = await asUserA(request(app).post('/api/invoices/999999/payment-link/sync'))
    expect(sync.status).toBe(404)
    const remove = await asUserA(request(app).delete('/api/invoices/999999/payment-link'))
    expect(remove.status).toBe(404)
    // Finance itself still works.
    const finance = await asUserA(request(app).post('/api/accounts').send({}))
    expect(finance.status).not.toBe(403)
  })

  it('passes with an active gold subscription', async () => {
    await goldTenantA()
    const feed = await asUserA(request(app).post('/api/calendar-feed/regenerate'))
    expect(feed.status).toBe(200)
    const key = await asUserA(request(app).get('/api/profile/mollie-key'))
    expect(key.status).toBe(200)
    const orders = await asUserA(request(app).get('/api/merch/shopify/orders'))
    expect(orders.status).not.toBe(403) // gate cleared; missing credentials is the next error
  })
})

describe('integration secrets purge (entitlement durably lost)', () => {
  const CREDENTIAL_COLUMNS = [
    'mollie_api_key', 'mollie_api_key_encrypted',
    'bandsintown_app_id', 'bandsintown_app_id_encrypted',
    'shopify_client_secret', 'shopify_client_secret_encrypted',
    'shopify_client_id', 'shopify_shop_domain',
    'bandsintown_artist_name', 'bandsintown_artist_id',
  ]

  it('removes every stored secret, integration config, and feed token', async () => {
    // Seed all credentials while unrestricted (ownerless tenant).
    await asUserA(request(app).put('/api/profile/mollie-key').send({ key: `test_${'a'.repeat(25)}` })).expect(200)
    await asUserA(request(app).put('/api/profile/bandsintown-key').send({ key: 'bit-app-id' })).expect(200)
    await asUserA(request(app).put('/api/profile/shopify-client-id').send({ clientId: 'a'.repeat(32) })).expect(200)
    await asUserA(request(app).put('/api/profile/shopify-secret').send({ secret: `shpss_${'a'.repeat(32)}` })).expect(200)
    await asUserA(request(app).put('/api/profile/shopify-domain').send({ domain: 'band.myshopify.com' })).expect(200)
    await asUserA(request(app).post('/api/calendar-feed/regenerate')).expect(200)
    await pool.query(
      `UPDATE tenants SET bandsintown_artist_name = 'Band', bandsintown_artist_id = '123' WHERE id = $1`,
      [seed.tenantA.id],
    )

    const { purgeIntegrationSecrets } = await import('../../../server/services/entitlementPurgeService.js')
    await purgeIntegrationSecrets(pool, seed.tenantA.id)

    const { rows: [tenant] } = await pool.query(
      `SELECT ${CREDENTIAL_COLUMNS.join(', ')} FROM tenants WHERE id = $1`,
      [seed.tenantA.id],
    )
    for (const column of CREDENTIAL_COLUMNS) expect(tenant[column]).toBeNull()

    const { rows: [tokens] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM ical_feed_tokens WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    expect(tokens.count).toBe(0)
  })

  it('does not touch another tenant', async () => {
    const asUserB = (req) =>
      req
        .set('x-test-user-id', String(seed.userB.id))
        .set('x-test-tenant-id', String(seed.tenantB.id))
    await asUserB(request(app).put('/api/profile/mollie-key').send({ key: `test_${'b'.repeat(25)}` })).expect(200)

    const { purgeIntegrationSecrets } = await import('../../../server/services/entitlementPurgeService.js')
    await purgeIntegrationSecrets(pool, seed.tenantA.id)

    const { rows: [t] } = await pool.query(
      'SELECT mollie_api_key_encrypted FROM tenants WHERE id = $1',
      [seed.tenantB.id],
    )
    expect(t.mollie_api_key_encrypted).not.toBeNull()
  })
})

describe('customization gates', () => {
  it('blocks accent_color but leaves the rest of the profile editable', async () => {
    await lockTenantA()
    expectEntitlementDenied(
      await asUserA(request(app).patch('/api/profile').send({ accent_color: '#ff0000' })),
      'customization',
    )
    await asUserA(request(app).patch('/api/profile').send({ band_name: 'Still Editable' })).expect(200)
  })

  it('blocks banner/avatar uploads but leaves both band logo uploads ungated', async () => {
    await lockTenantA()
    expectEntitlementDenied(await asUserA(request(app).post('/api/profile/banner')), 'customization')
    expectEntitlementDenied(await asUserA(request(app).post('/api/profile/avatar')), 'customization')
    // Band logos (light + dark) are settable on every plan, including the
    // fallback — the gate passes and the missing file is the next error.
    expect((await asUserA(request(app).post('/api/profile/logo'))).status).toBe(400)
    expect((await asUserA(request(app).post('/api/profile/logo-dark'))).status).toBe(400)
  })

  it('passes with gold (gate cleared; missing file is the next error)', async () => {
    await goldTenantA()
    const accent = await asUserA(request(app).patch('/api/profile').send({ accent_color: '#ff0000' }))
    expect(accent.status).toBe(200)
    const logo = await asUserA(request(app).post('/api/profile/logo'))
    expect(logo.status).toBe(400) // gate passed, no file uploaded
  })
})

describe('song files and chordpro gates', () => {
  let songId

  beforeEach(async () => {
    const res = await asUserA(request(app).post('/api/songs').send({ title: 'Test Song' })).expect(201)
    songId = res.body.id
  })

  it('blocks document/recording uploads and chart create/edit when locked', async () => {
    await lockTenantA()
    expectEntitlementDenied(
      await asUserA(request(app).post(`/api/songs/${songId}/documents`)),
      'song_files',
    )
    expectEntitlementDenied(
      await asUserA(request(app).post(`/api/songs/${songId}/recordings`)),
      'song_files',
    )
    expectEntitlementDenied(
      await asUserA(request(app).post(`/api/songs/${songId}/charts`).send({ name: 'Main', source: '{title: X}' })),
      'chordpro',
    )
  })

  it('chart deletes stay open when the feature is lost (data is never trapped)', async () => {
    const sub = await goldTenantA()
    const created = await asUserA(
      request(app).post(`/api/songs/${songId}/charts`).send({ name: 'Main', source: '{title: X}' }),
    ).expect(201)

    // Lose the subscription → chordpro gone, but the chart can still be removed.
    await pool.query('DELETE FROM subscriptions WHERE id = $1', [sub.id])
    clearEntitlementCaches()
    expectEntitlementDenied(
      await asUserA(request(app).post(`/api/songs/${songId}/charts`).send({ name: 'B', source: '{title: Y}' })),
      'chordpro',
    )
    await asUserA(request(app).delete(`/api/songs/${songId}/charts/${created.body.id}`)).expect(204)
  })
})

describe('public calendar feed', () => {
  async function createFeedToken() {
    const token = `test-token-${Date.now()}`
    await pool.query(
      'INSERT INTO ical_feed_tokens (user_id, tenant_id, token) VALUES ($1, $2, $3)',
      [seed.userA.id, seed.tenantA.id, token],
    )
    return token
  }

  it('404s when the tenant lacks the integrations entitlement', async () => {
    await lockTenantA()
    const token = await createFeedToken()
    await request(app).get(`/api/public/calendar/${token}/feed.ics`).expect(404)
  })

  it('serves the feed for entitled and ownerless tenants', async () => {
    const token = await createFeedToken()
    await request(app).get(`/api/public/calendar/${token}/feed.ics`).expect(200)

    await goldTenantA()
    clearEntitlementCaches()
    await request(app).get(`/api/public/calendar/${token}/feed.ics`).expect(200)
  })
})

describe('/auth/me entitlements payload', () => {
  it('null for ownerless tenants', async () => {
    const res = await asUserA(request(app).get('/api/auth/me')).expect(200)
    expect(res.body.entitlements).toBeNull()
  })

  it('bronze fallback-lock shape when the owner has no subscription', async () => {
    await lockTenantA()
    await billing.createFinanceData(seed.tenantA.id)
    clearEntitlementCaches()
    const res = await asUserA(request(app).get('/api/auth/me')).expect(200)
    const ent = res.body.entitlements
    expect(ent.planSlug).toBe('bronze')
    expect(ent.locked).toBe(true)
    expect(ent.subscriptionStatus).toBeNull()
    expect(ent.financeReadOnly).toBe(true)
    for (const key of FEATURE_KEYS) expect(ent.flags[key]).toBe(false)
    expect(ent.limits).toEqual({ storage_mb: 50, members: 5, bands: 1 })
  })

  it('live plan shape, with limits reflecting a pending-downgrade snapshot', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    await billing.createSubscription({
      userId: seed.userA.id,
      planSlug: 'gold',
      pending_limits_snapshot: { storage_mb: 50, members: 5, bands: 1 },
    })
    const res = await asUserA(request(app).get('/api/auth/me')).expect(200)
    const ent = res.body.entitlements
    expect(ent.planSlug).toBe('gold')
    expect(ent.locked).toBe(false)
    expect(ent.subscriptionStatus).toBe('active')
    for (const key of FEATURE_KEYS) expect(ent.flags[key]).toBe(true)
    expect(ent.limits).toEqual({ storage_mb: 50, members: 5, bands: 1 })
  })
})

describe('admin delete-user preflight', () => {
  it('409s with user_owns_tenants while the user owns a tenant', async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    const asSuper = (req) =>
      req
        .set('x-test-user-id', String(seed.superUser.id))
        .set('x-test-tenant-id', String(seed.tenantA.id))
    const res = await asSuper(request(app).delete(`/api/admin/users/${seed.userA.id}`))
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('user_owns_tenants')

    await pool.query('UPDATE tenants SET owner_user_id = NULL WHERE id = $1', [seed.tenantA.id])
    await asSuper(request(app).delete(`/api/admin/users/${seed.userA.id}`)).expect(204)
  })
})
