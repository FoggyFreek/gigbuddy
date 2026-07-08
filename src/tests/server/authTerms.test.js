import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { TERMS_VERSION } from '../../../shared/termsVersion.js'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed

beforeAll(async () => {
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

const asUserA = (req) => req.set('x-test-user-id', String(seed.userA.id))
// Full band-member identity: user + active tenant, for hitting tenant routes.
const asMemberA = (req) =>
  req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(seed.tenantA.id))

async function setUserTerms(userId, { acceptedAt, version }) {
  await pool.query('UPDATE users SET terms_accepted_at = $2, terms_version = $3 WHERE id = $1', [
    userId,
    acceptedAt,
    version,
  ])
}

// A user with zero memberships — the onboarding audience.
async function createOutsider() {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status)
     VALUES ('outsider-sub', 'outsider@example.com', 'Outsider', 'approved')
     RETURNING *`,
  )
  return user
}

async function termsRow(userId) {
  const { rows: [row] } = await pool.query(
    'SELECT terms_accepted_at, terms_version, onboarding_tenant_id FROM users WHERE id = $1',
    [userId],
  )
  return row
}

describe('POST /api/auth/accept-terms', () => {
  it('401s without a session', async () => {
    await request(app)
      .post('/api/auth/accept-terms')
      .send({ version: TERMS_VERSION })
      .expect(401)
  })

  it('400s for any version except the current one', async () => {
    await asUserA(request(app).post('/api/auth/accept-terms').send({ version: 'bogus' })).expect(400)
    await asUserA(request(app).post('/api/auth/accept-terms').send({})).expect(400)
    await asUserA(request(app).post('/api/auth/accept-terms').send({ version: '2000-01-01' })).expect(400)
  })

  it('records acceptance and exposes it on /me', async () => {
    await asUserA(request(app).post('/api/auth/accept-terms').send({ version: TERMS_VERSION })).expect(200)

    const row = await termsRow(seed.userA.id)
    expect(row.terms_version).toBe(TERMS_VERSION)
    expect(row.terms_accepted_at).not.toBeNull()

    const me = await asUserA(request(app).get('/api/auth/me')).expect(200)
    expect(me.body.termsVersion).toBe(TERMS_VERSION)
    expect(me.body.termsAcceptedAt).not.toBeNull()
  })

  it('works for a zero-membership user (pre-onboarding)', async () => {
    const outsider = await createOutsider()
    await request(app)
      .post('/api/auth/accept-terms')
      .set('x-test-user-id', String(outsider.id))
      .send({ version: TERMS_VERSION })
      .expect(200)
    const row = await termsRow(outsider.id)
    expect(row.terms_version).toBe(TERMS_VERSION)
  })

  it('re-accepting the same version preserves the original timestamp', async () => {
    await asUserA(request(app).post('/api/auth/accept-terms').send({ version: TERMS_VERSION })).expect(200)
    const first = await termsRow(seed.userA.id)

    await asUserA(request(app).post('/api/auth/accept-terms').send({ version: TERMS_VERSION })).expect(200)
    const second = await termsRow(seed.userA.id)
    expect(second.terms_accepted_at.getTime()).toBe(first.terms_accepted_at.getTime())
    expect(second.terms_version).toBe(TERMS_VERSION)
  })

  it('a version bump replaces both fields atomically', async () => {
    // Seed an acceptance of an older version directly (the API only ever
    // accepts the current TERMS_VERSION; old versions exist from past bumps).
    await pool.query(
      `UPDATE users SET terms_accepted_at = NOW() - INTERVAL '400 days', terms_version = '2020-01-01'
       WHERE id = $1`,
      [seed.userA.id],
    )
    const before = await termsRow(seed.userA.id)

    await asUserA(request(app).post('/api/auth/accept-terms').send({ version: TERMS_VERSION })).expect(200)
    const after = await termsRow(seed.userA.id)
    expect(after.terms_version).toBe(TERMS_VERSION)
    expect(after.terms_accepted_at.getTime()).toBeGreaterThan(before.terms_accepted_at.getTime())
  })

  it('the DB rejects a half-set terms pair', async () => {
    // Start from a cleared pair (the test-harness seed default fills both).
    await setUserTerms(seed.userA.id, { acceptedAt: null, version: null })
    await expect(
      pool.query(`UPDATE users SET terms_version = 'x' WHERE id = $1`, [seed.userA.id]),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('requireCurrentTerms gate on tenant routes', () => {
  it('lets a current-terms member through to a tenant route', async () => {
    // Seed default gives userA the current terms version.
    await asMemberA(request(app).get('/api/gigs')).expect(200)
  })

  it('lets a current-terms user reach GET /notifications (happy path)', async () => {
    // Seed default gives userA the current terms version — the positive
    // counterpart to the blocked-notifications case below.
    await asUserA(request(app).get('/api/notifications')).expect(200)
  })

  it('gates the account-link routes (start + unlink)', async () => {
    await setUserTerms(seed.userA.id, { acceptedAt: null, version: null })

    const start = await asUserA(request(app).get('/api/auth/link/google/start')).expect(403)
    expect(start.body.code).toBe('terms_acceptance_required')

    const unlink = await asUserA(request(app).post('/api/auth/link/google/unlink')).expect(403)
    expect(unlink.body.code).toBe('terms_acceptance_required')
  })

  it('blocks a stale-terms member with a structured 403', async () => {
    await setUserTerms(seed.userA.id, {
      acceptedAt: new Date(Date.now() - 400 * 864e5),
      version: '2020-01-01',
    })
    const res = await asMemberA(request(app).get('/api/gigs')).expect(403)
    expect(res.body.code).toBe('terms_acceptance_required')
    expect(res.body.termsVersion).toBe(TERMS_VERSION)
  })

  it('blocks an invite-approved member who never accepted any terms', async () => {
    await setUserTerms(seed.userA.id, { acceptedAt: null, version: null })
    const res = await asMemberA(request(app).get('/api/gigs')).expect(403)
    expect(res.body.code).toBe('terms_acceptance_required')
  })

  it('never blocks a super admin, even when their terms are stale', async () => {
    await setUserTerms(seed.superUser.id, { acceptedAt: null, version: null })
    await request(app)
      .get('/api/gigs')
      .set('x-test-user-id', String(seed.superUser.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .expect(200)
    await request(app)
      .get('/api/admin/users')
      .set('x-test-user-id', String(seed.superUser.id))
      .expect(200)
  })

  it('blocks stale non-admins from user-scoped APIs outside tenant routes', async () => {
    await setUserTerms(seed.userA.id, { acceptedAt: null, version: null })

    for (const req of [
      asUserA(request(app).get('/api/notifications')),
      asUserA(request(app).post('/api/tenants').send({ band_name: 'Bypass Band' })),
      asUserA(request(app).post('/api/billing/cancel')),
      asUserA(request(app).post('/api/auth/active-tenant').send({ tenantId: seed.tenantA.id })),
    ]) {
      const res = await req.expect(403)
      expect(res.body.code).toBe('terms_acceptance_required')
    }
  })

  it('keeps onboarding bootstrap reads reachable before acceptance', async () => {
    await setUserTerms(seed.userA.id, { acceptedAt: null, version: null })
    await asUserA(request(app).get('/api/tenants/onboarding-status')).expect(200)
    await asUserA(request(app).get('/api/tenants/owned')).expect(200)
    await asUserA(request(app).get('/api/billing')).expect(200)
  })

  it('still lets a stale-terms user reach exempt surfaces (/me)', async () => {
    await setUserTerms(seed.userA.id, { acceptedAt: null, version: null })
    const me = await asMemberA(request(app).get('/api/auth/me')).expect(200)
    expect(me.body.termsVersion).toBeNull()
  })

  it('accept-terms stays reachable while stale, and unblocks tenant routes', async () => {
    await setUserTerms(seed.userA.id, { acceptedAt: null, version: null })
    // Blocked before accepting…
    await asMemberA(request(app).get('/api/gigs')).expect(403)
    // …accept-terms itself is not gated…
    await asMemberA(request(app).post('/api/auth/accept-terms').send({ version: TERMS_VERSION })).expect(200)
    // …and the same request now passes.
    await asMemberA(request(app).get('/api/gigs')).expect(200)
  })
})

describe('POST /api/auth/onboarding-complete', () => {
  it('401s without a session', async () => {
    await request(app).post('/api/auth/onboarding-complete').expect(401)
  })

  it('clears onboarding_tenant_id and is idempotent', async () => {
    await pool.query('UPDATE users SET onboarding_tenant_id = $2 WHERE id = $1', [
      seed.userA.id,
      seed.tenantA.id,
    ])

    await asUserA(request(app).post('/api/auth/onboarding-complete')).expect(204)
    expect((await termsRow(seed.userA.id)).onboarding_tenant_id).toBeNull()

    // Second call: still 204, still null.
    await asUserA(request(app).post('/api/auth/onboarding-complete')).expect(204)
    expect((await termsRow(seed.userA.id)).onboarding_tenant_id).toBeNull()
  })

  it('/me exposes onboardingTenantId', async () => {
    await pool.query('UPDATE users SET onboarding_tenant_id = $2 WHERE id = $1', [
      seed.userA.id,
      seed.tenantA.id,
    ])
    const me = await asUserA(request(app).get('/api/auth/me')).expect(200)
    expect(me.body.onboardingTenantId).toBe(seed.tenantA.id)
  })
})
