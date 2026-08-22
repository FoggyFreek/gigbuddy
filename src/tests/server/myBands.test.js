import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'
import {
  ARTIST_ID,
  spotifyUrl,
  insertProfile,
  insertPendingClaim,
  isolateProfileIds,
  expectNoInternalFields,
} from './_bandProfileHelpers.js'

vi.mock('../../../server/platform/files/storageService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  deleteTenantObjects: vi.fn(async () => undefined),
  safeRemove: vi.fn(() => undefined),
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants, deleteTenantObjects, safeRemove
let seed, personalA, personalB

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const storageMod = await import('../../../server/platform/files/storageService.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  deleteTenantObjects = storageMod.deleteTenantObjects
  safeRemove = storageMod.safeRemove
  app = appMod.createTestApp()
  await runMigrations()
})

// My Bands is personal-only, and the seed makes band tenants, so each suite
// gets a personal workspace per user.
async function createPersonalTenant(slug, userId) {
  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants (slug, band_name, display_name, kind, owner_user_id)
     VALUES ($1, $2, $2, 'personal', $3) RETURNING *`,
    [slug, `${slug} workspace`, userId],
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
     VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), 'owner')`,
    [userId, tenant.id],
  )
  return tenant
}

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  const fixtureDb = await import('./_db.js')
  seed = await fixtureDb.seedSharePhotos(seed)
  await isolateProfileIds(pool)
  personalA = await createPersonalTenant('personal-a', seed.userA.id)
  personalB = await createPersonalTenant('personal-b', seed.userB.id)
  deleteTenantObjects.mockReset().mockResolvedValue(undefined)
  safeRemove.mockClear()
})

afterAll(async () => pool.end())

const as = (userId, tenantId) => (req) => req
  .set('x-test-user-id', String(userId))
  .set('x-test-tenant-id', String(tenantId))

const asA = (req) => as(seed.userA.id, personalA.id)(req)
const asB = (req) => as(seed.userB.id, personalB.id)(req)
const asBandA = (req) => as(seed.userA.id, seed.tenantA.id)(req)

const NEW_BAND = {
  name: 'Off Platform',
  countryCode: 'nl',
  websiteUrl: 'https://offplatform.example',
}

const addBand = (body) => request(app).post('/api/my-bands').send(body)
const listBands = () => request(app).get('/api/my-bands')

async function addFor(agent, body = { bandProfile: NEW_BAND }) {
  const res = await agent(addBand(body)).expect(201)
  return res.body
}

// Links an event of each type to a My Bands row, so removal modes can be
// asserted across all three planning tables at once.
async function linkAllEvents(tenantId, myBandId) {
  const ids = {}
  const { rows: [gig] } = await pool.query(
    `INSERT INTO gigs (tenant_id, event_date, event_description, my_band_id, banner_path)
     VALUES ($1, '2099-01-01', 'Linked gig', $2, $3) RETURNING id`,
    [tenantId, myBandId, `tenants/${tenantId}/gig-banners/b.jpg`],
  )
  ids.gig = gig.id
  await pool.query(
    `INSERT INTO gig_attachments (gig_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, 'rider.pdf', 'application/pdf', 10)`,
    [gig.id, tenantId, `tenants/${tenantId}/gig_attachments/r.pdf`],
  )
  const { rows: [rehearsal] } = await pool.query(
    `INSERT INTO rehearsals (tenant_id, proposed_date, status, my_band_id)
     VALUES ($1, '2099-01-02', 'planned', $2) RETURNING id`,
    [tenantId, myBandId],
  )
  ids.rehearsal = rehearsal.id
  const { rows: [event] } = await pool.query(
    `INSERT INTO band_events (tenant_id, title, start_date, end_date, my_band_id)
     VALUES ($1, 'Linked event', '2099-01-03', '2099-01-03', $2) RETURNING id`,
    [tenantId, myBandId],
  )
  ids.bandEvent = event.id
  return ids
}

const countIn = async (table, tenantId) => {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenantId])
  return rows[0].n
}

describe('capability gating', () => {
  it('is unavailable in a band workspace', async () => {
    const res = await asBandA(listBands()).expect(403)
    expect(res.body.code).toBe('tenant_kind_not_supported')

    await asBandA(addBand({ bandProfile: NEW_BAND })).expect(403)
  })
})

describe('POST /api/my-bands', () => {
  it('creates the profile and holds it in one call', async () => {
    const body = await addFor(asA)

    expect(body.bandProfile).toMatchObject({ name: 'Off Platform', countryCode: 'nl', status: 'claimable' })
    expect(body.eventCounts).toEqual({ gigs: 0, rehearsals: 0, bandEvents: 0 })
    expectNoInternalFields(body)
    // The audit descriptor is the route's business, not the client's.
    expect(body).not.toHaveProperty('audit')
  })

  // The window a create-then-add pair would leave open: a global row nobody
  // holds and nothing ever cleans up.
  it('creates nothing when the add half fails', async () => {
    await pool.query(
      `INSERT INTO my_bands (tenant_id, band_profile_id)
       SELECT $1, id FROM band_profiles`, [personalA.id],
    )
    for (let i = 0; i < 50; i += 1) {
      const profile = await insertProfile(pool, { name: `Filler ${i}`, website_key: `f${i}.example`, website_url: `https://f${i}.example` })
      await pool.query('INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2)', [personalA.id, profile.id])
    }
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM band_profiles')

    const res = await asA(addBand({ bandProfile: { ...NEW_BAND, name: 'Should Not Exist' } })).expect(409)

    expect(res.body.code).toBe('my_bands_limit')
    const after = await pool.query('SELECT COUNT(*)::int AS n FROM band_profiles')
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('is idempotent when the band is already held', async () => {
    const first = await addFor(asA)

    const res = await asA(addBand({ bandProfileId: first.bandProfile.id })).expect(200)
    expect(res.body.id).toBe(first.id)
  })

  it('refuses a claimed profile — the artist should join the band instead', async () => {
    const profile = await insertProfile(pool, { createdBy: seed.userA.id })
    await pool.query('UPDATE band_profiles SET claimed_by_tenant_id = $1 WHERE id = $2',
      [seed.tenantB.id, profile.id])

    const res = await asA(addBand({ bandProfileId: profile.id })).expect(409)
    expect(res.body.code).toBe('band_profile_claimed')
  })

  it('caps holders per profile', async () => {
    const profile = await insertProfile(pool)
    // A user may own only one personal workspace, so the other holders are
    // stand-in tenants: the cap counts my_bands rows, not workspace kinds.
    for (let i = 0; i < 5; i += 1) {
      const { rows: [tenant] } = await pool.query(
        `INSERT INTO tenants (slug, band_name, display_name, kind)
         VALUES ($1, $1, $1, 'band') RETURNING id`,
        [`holder-${i}`],
      )
      await pool.query('INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2)', [tenant.id, profile.id])
    }

    const res = await asA(addBand({ bandProfileId: profile.id })).expect(409)
    expect(res.body).toMatchObject({ code: 'band_profile_full', limit: 5 })
  })

  it('caps profiles authored per user', async () => {
    for (let i = 0; i < 20; i += 1) {
      await insertProfile(pool, { createdBy: seed.userA.id, name: `Mine ${i}`, website_key: `m${i}.example`, website_url: `https://m${i}.example` })
    }

    const res = await asA(addBand({ bandProfile: NEW_BAND })).expect(409)
    expect(res.body).toMatchObject({ code: 'band_profile_limit', limit: 20 })
  })

  it('reports a Spotify collision as a duplicate', async () => {
    await insertProfile(pool, { spotify_url: spotifyUrl(), spotify_artist_id: ARTIST_ID })

    const res = await asA(addBand({ bandProfile: { ...NEW_BAND, spotifyUrl: spotifyUrl() } })).expect(409)
    expect(res.body.code).toBe('band_profile_duplicate')
  })

  it('404s for an unknown profile id', async () => {
    await asA(addBand({ bandProfileId: 999999 })).expect(404)
  })

  it('rejects a body naming neither an id nor a profile', async () => {
    const res = await asA(addBand({})).expect(400)
    expect(res.body.code).toBe('band_profile_required')
  })
})

describe('GET /api/my-bands', () => {
  // parseListLimit defaults an omitted limit to 10 whatever maximum it is
  // given, which would silently truncate a full collection.
  it('returns a full collection when no limit is asked for', async () => {
    for (let i = 0; i < 50; i += 1) {
      const profile = await insertProfile(pool, { name: `Band ${i}`, website_key: `b${i}.example`, website_url: `https://b${i}.example` })
      await pool.query('INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2)', [personalA.id, profile.id])
    }

    const res = await asA(listBands()).expect(200)

    expect(res.body.items).toHaveLength(50)
    expect(res.body.meta).toEqual({ limit: 50, returned: 50 })
  })

  it('counts the linked events per band', async () => {
    const band = await addFor(asA)
    await linkAllEvents(personalA.id, band.id)

    const res = await asA(listBands()).expect(200)
    expect(res.body.items[0].eventCounts).toEqual({ gigs: 1, rehearsals: 1, bandEvents: 1 })
  })
})

describe('tenant isolation', () => {
  it('never shows one workspace another\'s collection', async () => {
    await addFor(asA)

    const res = await asB(listBands()).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('404s on another workspace\'s row rather than revealing it', async () => {
    const band = await addFor(asA)

    await asB(request(app).get(`/api/my-bands/${band.id}/removal-preview`)).expect(404)
    await asB(request(app).delete(`/api/my-bands/${band.id}`)).expect(404)

    const { rowCount } = await pool.query('SELECT 1 FROM my_bands WHERE id = $1', [band.id])
    expect(rowCount).toBe(1)
  })

  it('refuses at the database level too', async () => {
    const band = await addFor(asA)
    // B needs a gig of its own, or the UPDATE would match no rows and pass
    // without the constraint ever being consulted.
    const { rows: [gigB] } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description)
       VALUES ($1, '2099-02-01', 'B gig') RETURNING id`,
      [personalB.id],
    )

    await expect(pool.query(
      'UPDATE gigs SET my_band_id = $1 WHERE id = $2',
      [band.id, gigB.id],
    )).rejects.toMatchObject({ code: '23503' })
  })
})

describe('DELETE /api/my-bands/:id', () => {
  it('keeps the events by default, unlinking them', async () => {
    const band = await addFor(asA)
    await linkAllEvents(personalA.id, band.id)

    const res = await asA(request(app).delete(`/api/my-bands/${band.id}`)).expect(200)

    expect(res.body).toMatchObject({
      removed: true,
      mode: 'keep',
      unlinked: { gigs: 1, rehearsals: 1, bandEvents: 1 },
    })
    expect(res.body).not.toHaveProperty('audit')
    expect(safeRemove).not.toHaveBeenCalled()

    for (const table of ['gigs', 'rehearsals', 'band_events']) {
      const { rows } = await pool.query(
        `SELECT my_band_id, tenant_id FROM ${table} WHERE tenant_id = $1`, [personalA.id],
      )
      expect(rows).toHaveLength(1)
      // The SET NULL column list keeps tenant_id intact.
      expect(rows[0]).toEqual({ my_band_id: null, tenant_id: personalA.id })
    }
  })

  it('deletes the events on request, reclaiming their objects', async () => {
    const band = await addFor(asA)
    await linkAllEvents(personalA.id, band.id)

    const res = await asA(request(app).delete(`/api/my-bands/${band.id}?mode=delete`)).expect(200)

    expect(res.body.deleted).toEqual({ gigs: 1, rehearsals: 1, bandEvents: 1 })
    expect(await countIn('gigs', personalA.id)).toBe(0)
    expect(await countIn('rehearsals', personalA.id)).toBe(0)
    expect(await countIn('band_events', personalA.id)).toBe(0)

    // Banner AND attachment: attachment rows cascade with the gig, so their
    // keys are unreachable once it is gone.
    expect(safeRemove.mock.calls.map(([key]) => key).sort()).toEqual([
      `tenants/${personalA.id}/gig-banners/b.jpg`,
      `tenants/${personalA.id}/gig_attachments/r.pdf`,
    ].sort())
  })

  it('leaves another band\'s events alone', async () => {
    const kept = await addFor(asA)
    const removed = await addFor(asA, {
      bandProfile: { ...NEW_BAND, name: 'Other', websiteUrl: 'https://other.example' },
    })
    await linkAllEvents(personalA.id, kept.id)
    await linkAllEvents(personalA.id, removed.id)

    await asA(request(app).delete(`/api/my-bands/${removed.id}?mode=delete`)).expect(200)

    expect(await countIn('gigs', personalA.id)).toBe(1)
  })

  it('rejects an unknown mode and 404s a second removal', async () => {
    const band = await addFor(asA)

    const res = await asA(request(app).delete(`/api/my-bands/${band.id}?mode=purge`)).expect(400)
    expect(res.body.code).toBe('invalid_mode')

    await asA(request(app).delete(`/api/my-bands/${band.id}`)).expect(200)
    await asA(request(app).delete(`/api/my-bands/${band.id}`)).expect(404)
  })

  it('previews what removal would touch without touching it', async () => {
    const band = await addFor(asA)
    await linkAllEvents(personalA.id, band.id)

    const preview = await asA(request(app).get(`/api/my-bands/${band.id}/removal-preview`)).expect(200)
    expect(preview.body).toEqual({ gigs: 1, rehearsals: 1, bandEvents: 1 })

    const removal = await asA(request(app).delete(`/api/my-bands/${band.id}`)).expect(200)
    expect(removal.body.unlinked).toEqual(preview.body)
  })
})

// A global profile is a directory entry, not a possession: it outlives every
// holder so the next musician to join finds the band already described.
describe('profile persistence', () => {
  const profileCount = async () => {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM band_profiles')
    return rows[0].n
  }

  it('keeps the profile when the last holder lets go', async () => {
    const band = await addFor(asA)
    const profileId = band.bandProfile.id
    await pool.query('INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2)', [personalB.id, profileId])

    await asA(request(app).delete(`/api/my-bands/${band.id}`)).expect(200)
    expect(await profileCount()).toBe(1)

    const { rows: [other] } = await pool.query('SELECT id FROM my_bands WHERE tenant_id = $1', [personalB.id])
    await asB(request(app).delete(`/api/my-bands/${other.id}`)).expect(200)

    expect(await profileCount()).toBe(1)
  })

  // Holderless is not orphaned: the row stays searchable, so a later arrival
  // adds the existing band rather than minting a duplicate.
  it('leaves a holderless profile searchable and addable again', async () => {
    const band = await addFor(asA)
    const profileId = band.bandProfile.id
    await asA(request(app).delete(`/api/my-bands/${band.id}`)).expect(200)

    const found = await asB(
      request(app).get(`/api/band-profiles/search?q=${encodeURIComponent(band.bandProfile.name)}`),
    ).expect(200)
    expect(found.body.items.map((item) => item.id)).toContain(profileId)

    const readded = await asB(addBand({ bandProfileId: profileId })).expect(201)
    expect(readded.body.bandProfile.id).toBe(profileId)
    expect(await profileCount()).toBe(1)
  })

  it('keeps a profile whose claim is still pending', async () => {
    const band = await addFor(asA)
    await insertPendingClaim(pool, band.bandProfile.id, seed.tenantB.id, seed.userB.id)

    await asA(request(app).delete(`/api/my-bands/${band.id}`)).expect(200)

    expect(await profileCount()).toBe(1)
  })

  it('keeps a profile when the last holder\'s workspace is deleted', async () => {
    await addFor(asA)
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [personalA.id])

    await request(app)
      .delete(`/api/admin/tenants/${personalA.id}`)
      .send({ confirmationSlug: 'personal-a' })
      .set('x-test-user-id', String(seed.superUser.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .expect(204)

    expect(deleteTenantObjects).toHaveBeenCalledWith(personalA.id, [])
    expect(await profileCount()).toBe(1)
    const { rowCount } = await pool.query('SELECT 1 FROM my_bands WHERE tenant_id = $1', [personalA.id])
    expect(rowCount).toBe(0)
  })

  it('keeps a profile another workspace still holds', async () => {
    const band = await addFor(asA)
    await pool.query('INSERT INTO my_bands (tenant_id, band_profile_id) VALUES ($1, $2)',
      [personalB.id, band.bandProfile.id])
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [personalA.id])

    await request(app)
      .delete(`/api/admin/tenants/${personalA.id}`)
      .send({ confirmationSlug: 'personal-a' })
      .set('x-test-user-id', String(seed.superUser.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .expect(204)

    expect(deleteTenantObjects).toHaveBeenCalledWith(personalA.id, [])
    expect(await profileCount()).toBe(1)
  })

  // A band tenant holds no my_bands rows, but its claim cascades away with it.
  // That releases the profile back to claimable; it does not remove it.
  it('releases but keeps a profile whose sole pending claimant is deleted', async () => {
    const profile = await insertProfile(pool, { createdBy: seed.userA.id })
    await insertPendingClaim(pool, profile.id, seed.tenantB.id, seed.userB.id)
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantB.id])

    await request(app)
      .delete(`/api/admin/tenants/${seed.tenantB.id}`)
      .send({ confirmationSlug: seed.tenantB.slug })
      .set('x-test-user-id', String(seed.superUser.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .expect(204)

    expect(deleteTenantObjects).toHaveBeenCalledWith(
      seed.tenantB.id,
      expect.arrayContaining([`tenants/${seed.tenantB.id}/share/beta.jpg`]),
    )
    expect(await profileCount()).toBe(1)

    const res = await asA(request(app).get(`/api/band-profiles/${profile.id}`)).expect(200)
    expect(res.body.status).toBe('claimable')
  })
})
