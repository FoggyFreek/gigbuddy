import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { insertProfile, isolateProfileIds, expectNoInternalFields } from './_bandProfileHelpers.js'

// A band tenant asking to be recognised as the owner of a global profile.
// Verification is offline; these routes only manage the request.

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed, profile

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
  await isolateProfileIds(pool)
  profile = await insertProfile(pool, { name: 'Off Platform' })
})

afterAll(async () => pool.end())

const as = (userId, tenantId) => (req) => req
  .set('x-test-user-id', String(userId))
  .set('x-test-tenant-id', String(tenantId))

const asA = (req) => as(seed.userA.id, seed.tenantA.id)(req)
const asB = (req) => as(seed.userB.id, seed.tenantB.id)(req)

const claim = (body) => request(app).post('/api/band-profile-claims').send(body)
const myClaim = () => request(app).get('/api/band-profile-claims')

async function makePersonalTenant() {
  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (slug, band_name, display_name, kind, owner_user_id)
     VALUES ('solo', 'Solo', 'Solo', 'personal', $1) RETURNING *`,
    [seed.userA.id],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), 'owner')`,
    [seed.userA.id, tenant.id],
  )
  return tenant
}

describe('gating', () => {
  it('is unavailable in a personal workspace', async () => {
    const personal = await makePersonalTenant()

    const res = await as(seed.userA.id, personal.id)(claim({ bandProfileId: profile.id })).expect(403)
    expect(res.body.code).toBe('tenant_kind_not_supported')
  })

  it('needs tenant.manage, not just membership', async () => {
    await pool.query(
      `UPDATE memberships SET role = 'contributor' WHERE tenant_id = $1 AND user_id = $2`,
      [seed.tenantA.id, seed.userA.id],
    )

    await asA(claim({ bandProfileId: profile.id })).expect(403)
  })
})

describe('POST /api/band-profile-claims', () => {
  it('records a claim and freezes the profile', async () => {
    const res = await asA(claim({ bandProfileId: profile.id, message: 'We are this band' })).expect(201)

    expect(res.body).toMatchObject({
      bandProfileId: profile.id,
      bandProfileName: 'Off Platform',
      status: 'pending',
      message: 'We are this band',
    })
    expectNoInternalFields(res.body)

    const profileRes = await asA(request(app).get(`/api/band-profiles/${profile.id}`)).expect(200)
    expect(profileRes.body.status).toBe('pending_claim')
  })

  it('is idempotent for the same profile', async () => {
    const first = await asA(claim({ bandProfileId: profile.id })).expect(201)
    const second = await asA(claim({ bandProfileId: profile.id })).expect(200)

    expect(second.body.id).toBe(first.body.id)
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM band_profile_claims')
    expect(rows[0].n).toBe(1)
  })

  it('lets only one band claim a profile at a time', async () => {
    await asA(claim({ bandProfileId: profile.id })).expect(201)

    const res = await asB(claim({ bandProfileId: profile.id })).expect(409)
    // Deliberately does not name the tenant already claiming it.
    expect(res.body.code).toBe('claim_pending_elsewhere')
    expect(JSON.stringify(res.body)).not.toContain(String(seed.tenantA.id))
  })

  it('resolves concurrent claims to exactly one pending row', async () => {
    const [first, second] = await Promise.all([
      asA(claim({ bandProfileId: profile.id })),
      asB(claim({ bandProfileId: profile.id })),
    ])

    expect([first.status, second.status].sort()).toEqual([201, 409])
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM band_profile_claims WHERE status = 'pending'`,
    )
    expect(rows[0].n).toBe(1)
  })

  it('lets a band claim only one profile', async () => {
    const other = await insertProfile(pool, { name: 'Other', website_key: 'o.example', website_url: 'https://o.example' })
    await asA(claim({ bandProfileId: profile.id })).expect(201)

    const res = await asA(claim({ bandProfileId: other.id })).expect(409)
    expect(res.body.code).toBe('tenant_already_claiming')
  })

  it('refuses a profile that is already claimed', async () => {
    await pool.query('UPDATE band_profiles SET claimed_by_tenant_id = $1 WHERE id = $2',
      [seed.tenantB.id, profile.id])

    const res = await asA(claim({ bandProfileId: profile.id })).expect(409)
    expect(res.body.code).toBe('band_profile_already_claimed')
  })

  it('404s an unknown profile and 400s a malformed id', async () => {
    await asA(claim({ bandProfileId: 999999 })).expect(404)
    await asA(claim({ bandProfileId: 'abc' })).expect(400)
  })
})

describe('reading and withdrawing', () => {
  it('shows a band only its own claim', async () => {
    const created = await asA(claim({ bandProfileId: profile.id })).expect(201)

    const mine = await asA(myClaim()).expect(200)
    expect(mine.body.claim.id).toBe(created.body.id)

    const theirs = await asB(myClaim()).expect(200)
    expect(theirs.body.claim).toBeNull()
  })

  it('404s withdrawing another band\'s claim, and leaves it standing', async () => {
    const created = await asA(claim({ bandProfileId: profile.id })).expect(201)

    await asB(request(app).delete(`/api/band-profile-claims/${created.body.id}`)).expect(404)

    const { rowCount } = await pool.query('SELECT 1 FROM band_profile_claims WHERE id = $1', [created.body.id])
    expect(rowCount).toBe(1)
  })

  it('withdrawing frees the profile for someone else', async () => {
    // The profile needs a holder to survive the withdrawal: a claim is the only
    // other thing keeping a holderless profile alive.
    const personal = await makePersonalTenant()
    await pool.query('INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2)', [personal.id, profile.id])
    const created = await asA(claim({ bandProfileId: profile.id })).expect(201)

    await asA(request(app).delete(`/api/band-profile-claims/${created.body.id}`)).expect(204)

    await asB(claim({ bandProfileId: profile.id })).expect(201)
  })

  it('withdrawing a holderless profile\'s only claim deletes the profile', async () => {
    const created = await asA(claim({ bandProfileId: profile.id })).expect(201)

    await asA(request(app).delete(`/api/band-profile-claims/${created.body.id}`)).expect(204)

    const { rowCount } = await pool.query('SELECT 1 FROM band_profiles WHERE id = $1', [profile.id])
    expect(rowCount).toBe(0)
  })

  it('keeps a profile someone still holds', async () => {
    const created = await asA(claim({ bandProfileId: profile.id })).expect(201)
    const personal = await makePersonalTenant()
    await pool.query('INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2)', [personal.id, profile.id])

    await asA(request(app).delete(`/api/band-profile-claims/${created.body.id}`)).expect(204)

    const { rowCount } = await pool.query('SELECT 1 FROM band_profiles WHERE id = $1', [profile.id])
    expect(rowCount).toBe(1)
  })

  it('404s withdrawing twice', async () => {
    const created = await asA(claim({ bandProfileId: profile.id })).expect(201)
    await asA(request(app).delete(`/api/band-profile-claims/${created.body.id}`)).expect(204)
    await asA(request(app).delete(`/api/band-profile-claims/${created.body.id}`)).expect(404)
  })
})
