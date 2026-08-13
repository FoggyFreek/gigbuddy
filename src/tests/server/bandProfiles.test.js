import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import {
  ARTIST_ID,
  spotifyUrl,
  insertProfile,
  insertPendingClaim,
  makeDiscoverable,
  isolateProfileIds,
  expectNoInternalFields,
  expectAbsentId,
} from './_bandProfileHelpers.js'

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
  await isolateProfileIds(pool)
})

afterAll(async () => pool.end())

// Band profiles are global, so the caller needs no active tenant.
const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', 'null')
const asUserB = (req) => req
  .set('x-test-user-id', String(seed.userB.id))
  .set('x-test-tenant-id', 'null')

const search = (qs) => request(app).get(`/api/band-profiles/search?${qs}`)
const mine = (overrides) => insertProfile(pool, { createdBy: seed.userA.id, ...overrides })

describe('GET /api/band-profiles/search', () => {
  it('refuses a query too short to be a search', async () => {
    const res = await asUserA(search('q=ab')).expect(400)
    expect(res.body.code).toBe('query_too_short')

    await asUserA(search('')).expect(400)
  })

  it('returns the standard bounded envelope', async () => {
    await mine({ name: 'Thunder Road' })

    const res = await asUserA(search('q=thunder')).expect(200)

    expect(res.body.items).toHaveLength(1)
    expect(res.body.meta).toEqual({ limit: 10, returned: 1 })
  })

  it('matches case-insensitively on any part of the name', async () => {
    await mine({ name: 'The Quiet Ones' })

    for (const q of ['quiet', 'QUIET', 'he Quiet O']) {
      const res = await asUserA(search(`q=${encodeURIComponent(q)}`)).expect(200)
      expect(res.body.items).toHaveLength(1)
    }
  })

  it('sorts an exact name match ahead of a partial one', async () => {
    await mine({ name: 'Echo Chamber', website_key: 'a.example', website_url: 'https://a.example' })
    await mine({ name: 'Echo', website_key: 'b.example', website_url: 'https://b.example' })

    const res = await asUserA(search('q=echo')).expect(200)
    expect(res.body.items.map((p) => p.name)).toEqual(['Echo', 'Echo Chamber'])
  })
})

describe('the website suggestion', () => {
  it('flags an existing profile with the same normalized website', async () => {
    const existing = await mine({ website_url: 'https://theband.example', website_key: 'theband.example' })

    // Same site, dressed differently: www, trailing slash, campaign params.
    const res = await asUserA(
      search(`website=${encodeURIComponent('https://www.theband.example/?utm_source=x')}`),
    ).expect(200)

    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({ id: existing.id, websiteMatch: true })
  })

  it('sorts a website match ahead of name matches', async () => {
    await mine({ name: 'Matching Name', website_key: 'other.example', website_url: 'https://other.example' })
    const linked = await mine({ name: 'Zzz Last Alphabetically', website_key: 'linked.example', website_url: 'https://linked.example' })

    const res = await asUserA(
      search(`q=${encodeURIComponent('Matching')}&website=${encodeURIComponent('https://linked.example')}`),
    ).expect(200)

    expect(res.body.items[0].id).toBe(linked.id)
    expect(res.body.items[0].websiteMatch).toBe(true)
    expect(res.body.items[1].websiteMatch).toBe(false)
  })

  // Distinct bands routinely share a platform domain.
  it('does not match a different page on the same domain', async () => {
    await mine({ website_url: 'https://facebook.com/bandA', website_key: 'facebook.com/bandA' })

    const res = await asUserA(
      search(`website=${encodeURIComponent('https://facebook.com/bandB')}`),
    ).expect(200)

    expect(res.body.items).toHaveLength(0)
  })

  it('rejects a malformed website input rather than ignoring it', async () => {
    const res = await asUserA(search('website=javascript:alert(1)')).expect(400)
    expect(res.body.code).toBe('invalid_website_url')
  })
})

describe('what a profile payload may disclose', () => {
  it('never emits internal columns on any read surface', async () => {
    const profile = await mine()

    const searchRes = await asUserA(search('q=Off Platform')).expect(200)
    const detailRes = await asUserA(request(app).get(`/api/band-profiles/${profile.id}`)).expect(200)

    expectNoInternalFields(searchRes.body)
    expectNoInternalFields(detailRes.body)
    expectAbsentId(detailRes.body, seed.userA.id)
  })

  it('identifies the claiming band only when it opted into discovery', async () => {
    const profile = await mine()
    await pool.query('UPDATE band_profiles SET claimed_by_tenant_id = $1 WHERE id = $2',
      [seed.tenantB.id, profile.id])

    const hidden = await asUserA(request(app).get(`/api/band-profiles/${profile.id}`)).expect(200)
    expect(hidden.body).toMatchObject({ status: 'claimed', claimed: true, claimedTenant: null })
    // The id is the input to the join and avatar endpoints: it must not appear
    // anywhere, under any key.
    expectAbsentId(hidden.body, seed.tenantB.id)

    await makeDiscoverable(pool, seed.tenantB.id)

    const shown = await asUserA(request(app).get(`/api/band-profiles/${profile.id}`)).expect(200)
    expect(shown.body.claimedTenant).toMatchObject({ id: seed.tenantB.id, slug: seed.tenantB.slug })
  })

  it('hides an archived or personal claiming tenant even when discoverable', async () => {
    const profile = await mine()
    await makeDiscoverable(pool, seed.tenantB.id)
    await pool.query('UPDATE band_profiles SET claimed_by_tenant_id = $1 WHERE id = $2',
      [seed.tenantB.id, profile.id])

    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantB.id])
    let res = await asUserA(request(app).get(`/api/band-profiles/${profile.id}`)).expect(200)
    expect(res.body.claimedTenant).toBeNull()

    await pool.query(
      `UPDATE tenants SET archived_at = NULL, kind = 'personal', owner_user_id = $2 WHERE id = $1`,
      [seed.tenantB.id, seed.userB.id],
    )
    res = await asUserA(request(app).get(`/api/band-profiles/${profile.id}`)).expect(200)
    expect(res.body.claimedTenant).toBeNull()
  })
})

describe('GET /api/band-profiles/:id', () => {
  it('404s for an unknown profile', async () => {
    await asUserA(request(app).get('/api/band-profiles/999999')).expect(404)
  })

  it('reports canEdit only for the creator of an unclaimed profile', async () => {
    const profile = await mine()

    const asCreator = await asUserA(request(app).get(`/api/band-profiles/${profile.id}`)).expect(200)
    const asStranger = await asUserB(request(app).get(`/api/band-profiles/${profile.id}`)).expect(200)

    expect(asCreator.body.canEdit).toBe(true)
    expect(asStranger.body.canEdit).toBe(false)
    expect(asStranger.body.status).toBe('claimable')
  })
})

describe('PATCH /api/band-profiles/:id', () => {
  const patch = (id, body) => request(app).patch(`/api/band-profiles/${id}`).send(body)

  it('lets the creator edit an unclaimed profile', async () => {
    const profile = await mine()

    const res = await asUserA(patch(profile.id, { name: 'Renamed', countryCode: 'BE' })).expect(200)

    expect(res.body).toMatchObject({ name: 'Renamed', countryCode: 'be' })
    expectNoInternalFields(res.body)
  })

  it('refuses anyone but the creator', async () => {
    const profile = await mine()

    const res = await asUserB(patch(profile.id, { name: 'Hijacked' })).expect(403)
    expect(res.body.code).toBe('not_profile_creator')
  })

  // The whole class of bug the plan called out: the validator cannot see the
  // stored row, so only a merged-row check catches this.
  it('refuses a partial update that clears the last link', async () => {
    const profile = await mine({ spotify_url: null, spotify_artist_id: null })

    const res = await asUserA(patch(profile.id, { websiteUrl: null })).expect(400)
    expect(res.body.code).toBe('band_profile_needs_link')

    const { rows } = await pool.query('SELECT website_url FROM band_profiles WHERE id = $1', [profile.id])
    expect(rows[0].website_url).toBe('https://offplatform.example')
  })

  it('allows clearing one link once the other is set', async () => {
    const profile = await mine()

    await asUserA(patch(profile.id, { spotifyUrl: spotifyUrl() })).expect(200)
    const res = await asUserA(patch(profile.id, { websiteUrl: null })).expect(200)

    expect(res.body.websiteUrl).toBeNull()
    expect(res.body.spotifyUrl).toBe(spotifyUrl())
    // The dedup key must travel with its URL or it silently keeps matching.
    const { rows } = await pool.query('SELECT website_key FROM band_profiles WHERE id = $1', [profile.id])
    expect(rows[0].website_key).toBeNull()
  })

  it('freezes the profile while a claim is pending', async () => {
    const profile = await mine()
    await insertPendingClaim(pool, profile.id, seed.tenantB.id, seed.userB.id)

    const res = await asUserA(patch(profile.id, { name: 'Sneaky' })).expect(409)
    expect(res.body.code).toBe('band_profile_locked')
  })

  it('freezes the profile once it is claimed', async () => {
    const profile = await mine()
    await pool.query('UPDATE band_profiles SET claimed_by_tenant_id = $1 WHERE id = $2',
      [seed.tenantB.id, profile.id])

    await asUserA(patch(profile.id, { name: 'Sneaky' })).expect(409)
  })

  it('reports a Spotify collision as a duplicate', async () => {
    await mine({ name: 'First', spotify_url: spotifyUrl(), spotify_artist_id: ARTIST_ID })
    const second = await mine({ name: 'Second', website_key: 'second.example', website_url: 'https://second.example' })

    const res = await asUserA(patch(second.id, { spotifyUrl: spotifyUrl() })).expect(409)
    expect(res.body.code).toBe('band_profile_duplicate')
  })

  it('leaves a profile uneditable when its creator is gone', async () => {
    const profile = await mine()
    await pool.query('UPDATE band_profiles SET created_by_user_id = NULL WHERE id = $1', [profile.id])

    await asUserA(patch(profile.id, { name: 'Orphaned' })).expect(403)
  })

  it('rejects an empty patch', async () => {
    const profile = await mine()
    const res = await asUserA(patch(profile.id, {})).expect(400)
    expect(res.body.code).toBe('no_fields_to_update')
  })

  it('has no create route: a profile is only ever created with a holder', async () => {
    await asUserA(request(app).post('/api/band-profiles').send({ name: 'Ghost', countryCode: 'nl' }))
      .expect(404)
  })
})
