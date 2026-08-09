import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { insertProfile, isolateProfileIds } from './_bandProfileHelpers.js'

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

const asAdmin = (req) => as(seed.superUser.id, seed.tenantA.id)(req)
const asA = (req) => as(seed.userA.id, seed.tenantA.id)(req)

const queue = (qs = '') => request(app).get(`/api/admin/band-profile-claims${qs}`)
const unclaimed = (qs = '') => request(app).get(`/api/admin/band-profile-claims/unclaimed${qs}`)
const approve = (id) => request(app).post(`/api/admin/band-profile-claims/${id}/approve`).send({})
const reject = (id, body) => request(app).post(`/api/admin/band-profile-claims/${id}/reject`).send(body)

async function makeClaim(profileId = profile.id) {
  const res = await asA(
    request(app).post('/api/band-profile-claims').send({ bandProfileId: profileId }),
  ).expect(201)
  return res.body.id
}

async function addHolder(slug, profileId = profile.id) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (email, name) VALUES ($1, $1) RETURNING id`, [`${slug}@test.local`],
  )
  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (slug, band_name, display_name, kind, owner_user_id)
     VALUES ($1, $1, $1, 'personal', $2) RETURNING id`, [slug, user.id],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), 'owner')`, [user.id, tenant.id],
  )
  await pool.query('INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2)', [tenant.id, profileId])
  return tenant.id
}

// dispatchNotification inserts one row per user in the audience, so a tenant
// with two approved members yields two rows. Which tenants were told is the
// question here.
const notifiedTenants = async (type) => {
  const { rows } = await pool.query(
    'SELECT DISTINCT tenant_id FROM notifications WHERE type = $1 ORDER BY tenant_id', [type],
  )
  return rows.map((row) => row.tenant_id)
}

describe('authorization', () => {
  it('refuses every route to a non-super-admin', async () => {
    const claimId = await makeClaim()

    await asA(queue()).expect(403)
    await asA(unclaimed()).expect(403)
    await asA(approve(claimId)).expect(403)
    await asA(reject(claimId, { reason: 'no' })).expect(403)
  })
})

describe('unclaimed profiles', () => {
  it('returns current unclaimed profiles with member counts and excludes claimed profiles', async () => {
    await addHolder('holder-a')
    await addHolder('holder-b')
    await makeClaim()

    const other = await insertProfile(pool, {
      name: 'Another Band', website_key: 'another.example', website_url: 'https://another.example',
    })
    await addHolder('holder-c', other.id)

    const claimed = await insertProfile(pool, {
      name: 'Claimed Band', website_key: 'claimed.example', website_url: 'https://claimed.example',
    })
    await addHolder('holder-d', claimed.id)
    await pool.query('UPDATE band_profiles SET claimed_by_tenant_id = $2 WHERE id = $1', [claimed.id, seed.tenantB.id])

    const res = await asAdmin(unclaimed('?limit=10')).expect(200)

    expect(res.body.meta).toMatchObject({ limit: 10, returned: 2, total: 2, nextCursor: null })
    expect(res.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: profile.id, name: 'Off Platform', memberCount: 2 }),
      expect.objectContaining({ id: other.id, name: 'Another Band', memberCount: 1 }),
    ]))
    expect(res.body.items.map((item) => item.id)).not.toContain(claimed.id)
  })

  it('paginates profiles without duplicates and keeps the full total', async () => {
    for (let i = 0; i < 3; i += 1) {
      await insertProfile(pool, {
        name: `Band ${i}`,
        website_key: `unclaimed-${i}.example`,
        website_url: `https://unclaimed-${i}.example`,
      })
    }

    const seen = []
    let cursor = null
    for (let page = 0; page < 6; page += 1) {
      const qs = `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const res = await asAdmin(unclaimed(qs)).expect(200)
      expect(res.body.meta.total).toBe(4)
      seen.push(...res.body.items.map((item) => item.id))
      cursor = res.body.meta.nextCursor
      if (!cursor) break
    }

    expect(seen).toHaveLength(4)
    expect(new Set(seen).size).toBe(4)
  })

  it('rejects malformed pagination input', async () => {
    await asAdmin(unclaimed('?limit=0')).expect(400)
    await asAdmin(unclaimed('?cursor=not-a-cursor')).expect(400)
  })
})

describe('the queue', () => {
  it('shows the claim with the requester and the claiming band socials', async () => {
    await pool.query(
      `UPDATE tenants
          SET instagram_handle = 'offplatformband',
              facebook_handle = 'offplatform.music',
              tiktok_handle = 'offplatform',
              youtube_handle = '@offplatformband',
              spotify_handle = 'claiming-spotify-artist'
        WHERE id = $1`,
      [seed.tenantA.id],
    )
    await makeClaim()

    const res = await asAdmin(queue('?status=pending')).expect(200)

    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({
      status: 'pending',
      bandProfileName: 'Off Platform',
      tenant: {
        id: seed.tenantA.id,
        slug: seed.tenantA.slug,
        socials: {
          instagram: 'offplatformband',
          facebook: 'offplatform.music',
          tiktok: 'offplatform',
          youtube: '@offplatformband',
          spotify: 'claiming-spotify-artist',
        },
      },
      requestedBy: { email: seed.userA.email, name: 'Alpha User' },
    })
    expect(res.body.items[0].bandProfile).toMatchObject({ id: profile.id })
  })

  it('shows who uses the profile and whether they belong to the claiming band', async () => {
    await addHolder('matched-holder')
    await addHolder('outside-holder')
    const { rows: [matched] } = await pool.query(
      `UPDATE users SET name = 'Matched Musician'
        WHERE email = 'matched-holder@test.local' RETURNING id, email, name`,
    )
    const { rows: [outside] } = await pool.query(
      `UPDATE users SET name = 'Outside Musician'
        WHERE email = 'outside-holder@test.local' RETURNING id, email, name`,
    )
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
       VALUES ($1, $2, 'reader', 'approved', NOW(), 'invite')`,
      [matched.id, seed.tenantA.id],
    )
    await makeClaim()

    const res = await asAdmin(queue('?status=pending')).expect(200)

    expect(res.body.items[0].profileUsers).toEqual([
      {
        id: matched.id,
        email: matched.email,
        name: matched.name,
        requestingTenantMembership: { status: 'approved', role: 'reader' },
      },
      {
        id: outside.id,
        email: outside.email,
        name: outside.name,
        requestingTenantMembership: null,
      },
    ])
  })

  // The case a day-granular cursor would break: several claims on one calendar
  // day page correctly only if the cursor keeps the time.
  it('pages claims created on the same day exactly once each', async () => {
    // One live claim per tenant is a hard constraint, so each claim needs its
    // own band and its own profile.
    for (let i = 0; i < 4; i += 1) {
      const p = await insertProfile(pool, {
        name: `Band ${i}`, website_key: `p${i}.example`, website_url: `https://p${i}.example`,
      })
      const { rows: [tenant] } = await pool.query(
        `INSERT INTO tenants (slug, band_name, display_name, kind)
         VALUES ($1, $1, $1, 'band') RETURNING id`, [`claimer-${i}`],
      )
      await pool.query(
        `INSERT INTO band_profile_claims (band_profile_id, band_profile_name, tenant_id, status, created_at)
         VALUES ($1, $2, $3, 'pending', date_trunc('day', NOW()) + ($4 || ' seconds')::interval)`,
        [p.id, p.name, tenant.id, String(i)],
      )
    }

    const seen = []
    let cursor = null
    for (let page = 0; page < 6; page += 1) {
      const qs = `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const res = await asAdmin(queue(qs)).expect(200)
      seen.push(...res.body.items.map((item) => item.id))
      cursor = res.body.meta.nextCursor
      if (!cursor) break
    }

    expect(seen).toHaveLength(4)
    expect(new Set(seen).size).toBe(4)
  })

  it('pages decided history too, not just pending', async () => {
    const claimId = await makeClaim()
    await asAdmin(reject(claimId, { reason: 'Could not verify' })).expect(200)

    const rejected = await asAdmin(queue('?status=rejected')).expect(200)
    expect(rejected.body.items).toHaveLength(1)

    const pending = await asAdmin(queue('?status=pending')).expect(200)
    expect(pending.body.items).toHaveLength(0)
  })

  it('rejects a malformed cursor rather than silently starting over', async () => {
    await asAdmin(queue('?cursor=2099-01-01')).expect(400)
    await asAdmin(queue('?status=nonsense')).expect(400)
  })
})

describe('approval', () => {
  it('claims the profile and keeps holders and their event links', async () => {
    const holder = await addHolder('holder-a')
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, my_band_id)
       SELECT $1, '2099-01-01', 'Tagged', id FROM my_bands WHERE tenant_id = $1`, [holder],
    )
    const claimId = await makeClaim()

    const res = await asAdmin(approve(claimId)).expect(200)

    expect(res.body.claim.status).toBe('approved')
    expect(res.body.profileDeleted).toBe(false)
    expect(res.body.profile.status).toBe('claimed')

    const { rows } = await pool.query('SELECT my_band_id FROM gigs WHERE tenant_id = $1', [holder])
    expect(rows[0].my_band_id).not.toBeNull()
  })

  // Without this the approval mints a claimed profile nobody holds, which
  // removeMyBand can never revisit and nothing else would ever delete.
  it('deletes a profile nobody holds any more', async () => {
    const claimId = await makeClaim()

    const res = await asAdmin(approve(claimId)).expect(200)

    expect(res.body.profileDeleted).toBe(true)
    const { rowCount } = await pool.query('SELECT 1 FROM band_profiles WHERE id = $1', [profile.id])
    expect(rowCount).toBe(0)
  })

  it('keeps the decided claim readable after the profile is gone', async () => {
    const claimId = await makeClaim()
    await asAdmin(approve(claimId)).expect(200)

    const res = await asAdmin(queue('?status=approved')).expect(200)

    expect(res.body.items[0]).toMatchObject({
      bandProfileId: null,
      bandProfileName: 'Off Platform',
      bandProfile: null,
      status: 'approved',
      decidedBy: { email: seed.superUser.email, name: 'Super User' },
    })

    const own = await asA(request(app).get('/api/band-profile-claims')).expect(200)
    expect(own.body.claim).toMatchObject({ bandProfileId: null, bandProfileName: 'Off Platform' })
  })

  it('tells every holder the band is on gigbuddy, and nobody else', async () => {
    const holders = [await addHolder('holder-a'), await addHolder('holder-b')]
    const bystander = await insertProfile(pool, { name: 'Unrelated', website_key: 'u.example', website_url: 'https://u.example' })
    await addHolder('holder-c', bystander.id)
    const claimId = await makeClaim()

    await asAdmin(approve(claimId)).expect(200)

    expect(await notifiedTenants('band-profile-claimed')).toEqual(holders.sort((a, b) => a - b))
    expect(await notifiedTenants('band-profile-claim-decided')).toEqual([seed.tenantA.id])
  })

  it('refuses when the claiming band was archived meanwhile, writing nothing', async () => {
    const claimId = await makeClaim()
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantA.id])

    const res = await asAdmin(approve(claimId)).expect(409)

    expect(res.body.code).toBe('tenant_unavailable')
    const { rows } = await pool.query(
      'SELECT status, claimed_by_tenant_id FROM band_profile_claims c, band_profiles p WHERE c.id = $1 AND p.id = $2',
      [claimId, profile.id],
    )
    expect(rows[0]).toEqual({ status: 'pending', claimed_by_tenant_id: null })
  })

  it('refuses a claim that was already decided', async () => {
    const claimId = await makeClaim()
    await asAdmin(approve(claimId)).expect(200)

    const res = await asAdmin(approve(claimId)).expect(409)
    expect(res.body.code).toBe('claim_not_pending')
  })

  it('404s an unknown claim', async () => {
    await asAdmin(approve(999999)).expect(404)
  })
})

describe('rejection', () => {
  it('requires a reason', async () => {
    const claimId = await makeClaim()

    const res = await asAdmin(reject(claimId, {})).expect(400)
    expect(res.body.code).toBe('reason_required')
  })

  it('frees the profile to be claimed again', async () => {
    await addHolder('holder-a')
    const claimId = await makeClaim()

    await asAdmin(reject(claimId, { reason: 'Could not verify ownership' })).expect(200)

    const res = await asA(request(app).get(`/api/band-profiles/${profile.id}`)).expect(200)
    expect(res.body.status).toBe('claimable')

    // And the band can see why.
    const own = await asA(request(app).get('/api/band-profile-claims')).expect(200)
    expect(own.body.claim).toMatchObject({ status: 'rejected', decisionReason: 'Could not verify ownership' })
  })

  it('notifies only the claiming band', async () => {
    await addHolder('holder-a')
    const claimId = await makeClaim()

    await asAdmin(reject(claimId, { reason: 'nope' })).expect(200)

    expect(await notifiedTenants('band-profile-claimed')).toEqual([])
    expect(await notifiedTenants('band-profile-claim-decided')).toEqual([seed.tenantA.id])
  })
})
