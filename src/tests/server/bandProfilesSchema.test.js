import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'

// Schema-level guarantees for migration 168. These are the constraints the
// services rely on rather than re-implement, so they are asserted directly
// against the database instead of through a route.

let pool, runMigrations, truncateAll, seedTwoTenants
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => pool.end())

const insertProfile = async (overrides = {}) => {
  const values = {
    name: 'Off Platform',
    country_code: 'nl',
    website_url: 'https://offplatform.example',
    website_key: 'offplatform.example',
    spotify_url: null,
    spotify_artist_id: null,
    ...overrides,
  }
  const { rows } = await pool.query(
    `INSERT INTO band_profiles
       (name, country_code, website_url, website_key, spotify_url, spotify_artist_id, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [values.name, values.country_code, values.website_url, values.website_key,
      values.spotify_url, values.spotify_artist_id, seed.userA.id],
  )
  return rows[0]
}

const addToMyBands = async (tenantId, profileId) => {
  const { rows } = await pool.query(
    'INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2) RETURNING *',
    [tenantId, profileId],
  )
  return rows[0]
}

const expectViolation = (promise, code) => expect(promise).rejects.toMatchObject({ code })

describe('band_profiles constraints', () => {
  it('requires at least one link', async () => {
    await expectViolation(
      insertProfile({ website_url: null, website_key: null }),
      '23514',
    )
  })

  it('refuses a dedup key without its URL, and the reverse', async () => {
    await expectViolation(insertProfile({ website_key: null }), '23514')
    await expectViolation(
      insertProfile({ spotify_url: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' }),
      '23514',
    )
  })

  it('rejects a country code that is not two lowercase letters', async () => {
    await expectViolation(insertProfile({ country_code: 'NL' }), '23514')
    await expectViolation(insertProfile({ country_code: 'nld' }), '23514')
  })

  it('rejects a blank name', async () => {
    await expectViolation(insertProfile({ name: '   ' }), '23514')
  })

  it('enforces one profile per Spotify artist, and nothing else', async () => {
    const spotify = {
      spotify_url: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
      spotify_artist_id: '4Z8W4fKeB5YxbusRsdQVPb',
    }
    await insertProfile(spotify)
    await expectViolation(insertProfile({ ...spotify, name: 'Different Name' }), '23505')

    // Same name and country, different links: two real bands may share a name.
    await insertProfile({ website_url: 'https://other.example', website_key: 'other.example' })
    // Same website: advisory only, so the insert must succeed.
    const dupWebsite = await insertProfile({ name: 'Another Band' })
    expect(dupWebsite.id).toBeTruthy()
  })

  it('releases the profile when the claiming tenant is deleted', async () => {
    const profile = await insertProfile()
    await pool.query('UPDATE band_profiles SET claimed_by_tenant_id = $1 WHERE id = $2',
      [seed.tenantB.id, profile.id])

    await pool.query('DELETE FROM tenants WHERE id = $1', [seed.tenantB.id])

    const { rows } = await pool.query('SELECT claimed_by_tenant_id FROM band_profiles WHERE id = $1', [profile.id])
    expect(rows[0].claimed_by_tenant_id).toBeNull()
  })
})

describe('band_profile_claims constraints', () => {
  const claim = (profileId, tenantId, status = 'pending') => pool.query(
    `INSERT INTO band_profile_claims (band_profile_id, band_profile_name, tenant_id, status, decided_at)
     VALUES ($1, 'Off Platform', $2, $3, CASE WHEN $3 = 'pending' THEN NULL ELSE NOW() END)
     RETURNING id`,
    [profileId, tenantId, status],
  )

  it('allows only one pending claim per profile', async () => {
    const profile = await insertProfile()
    await claim(profile.id, seed.tenantA.id)
    await expectViolation(claim(profile.id, seed.tenantB.id), '23505')
  })

  it('allows only one live claim per tenant', async () => {
    const [a, b] = [await insertProfile(), await insertProfile({ name: 'Second', website_key: 's.example', website_url: 'https://s.example' })]
    await claim(a.id, seed.tenantA.id)
    await expectViolation(claim(b.id, seed.tenantA.id), '23505')
  })

  it('ties decided_at to the status', async () => {
    const profile = await insertProfile()
    await expectViolation(
      pool.query(
        `INSERT INTO band_profile_claims (band_profile_id, band_profile_name, tenant_id, status, decided_at)
         VALUES ($1, 'x', $2, 'pending', NOW())`,
        [profile.id, seed.tenantA.id],
      ),
      '23514',
    )
  })

  // Terminal deletion removes the profile once nobody holds it; the decided
  // claim is an audit record and must survive with its name snapshot.
  it('keeps decided claims when the profile is deleted', async () => {
    const profile = await insertProfile()
    await claim(profile.id, seed.tenantA.id, 'approved')

    await pool.query('DELETE FROM band_profiles WHERE id = $1', [profile.id])

    const { rows } = await pool.query('SELECT band_profile_id, band_profile_name FROM band_profile_claims')
    expect(rows).toEqual([{ band_profile_id: null, band_profile_name: 'Off Platform' }])
  })

  it('drops the claim when the claiming tenant is deleted', async () => {
    const profile = await insertProfile()
    await claim(profile.id, seed.tenantB.id)

    await pool.query('DELETE FROM tenants WHERE id = $1', [seed.tenantB.id])

    const { rowCount } = await pool.query('SELECT 1 FROM band_profile_claims')
    expect(rowCount).toBe(0)
  })
})

describe('my_bands and the event link', () => {
  const EVENT_TABLES = ['gigs', 'rehearsals', 'band_events']

  it('refuses a duplicate profile in one collection', async () => {
    const profile = await insertProfile()
    await addToMyBands(seed.tenantA.id, profile.id)
    await expectViolation(addToMyBands(seed.tenantA.id, profile.id), '23505')
  })

  it('refuses linking an event to another tenant\'s my_bands row', async () => {
    const profile = await insertProfile()
    const rowA = await addToMyBands(seed.tenantA.id, profile.id)

    // The composite FK is the database backstop for tenant isolation: tenant B
    // cannot reach tenant A's row even by writing raw SQL.
    await expectViolation(
      pool.query('UPDATE gigs SET my_band_id = $1 WHERE id = $2', [rowA.id, seed.gigB.id]),
      '23503',
    )
  })

  it.each(EVENT_TABLES)('clears only my_band_id on %s when the row goes away', async (table) => {
    const profile = await insertProfile()
    const row = await addToMyBands(seed.tenantA.id, profile.id)
    await pool.query(`UPDATE ${table} SET my_band_id = $1 WHERE tenant_id = $2`, [row.id, seed.tenantA.id])

    await pool.query('DELETE FROM my_bands WHERE id = $1', [row.id])

    // Without the (my_band_id) column list on ON DELETE SET NULL, PostgreSQL
    // would null every column of the composite key — including tenant_id, which
    // is NOT NULL — and this delete would fail outright.
    const { rows } = await pool.query(
      `SELECT my_band_id, tenant_id FROM ${table} WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((r) => {
      expect(r.my_band_id).toBeNull()
      expect(r.tenant_id).toBe(seed.tenantA.id)
    })
  })

  it('cascades the collection row when the profile is deleted', async () => {
    const profile = await insertProfile()
    await addToMyBands(seed.tenantA.id, profile.id)

    await pool.query('DELETE FROM band_profiles WHERE id = $1', [profile.id])

    const { rowCount } = await pool.query('SELECT 1 FROM my_bands')
    expect(rowCount).toBe(0)
  })
})
