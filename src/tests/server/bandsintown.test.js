import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let fetchArtistById, fetchArtistEvents
let mapArtistLinksToSocials, normalizeBandsintownEvent, scoreVenueMatch
let setIntegrationCredential, CREDENTIAL_TYPES
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const serviceMod = await import('../../../server/services/bandsintownService.js')
  const validatorMod = await import('../../../server/validators/bandsintownValidators.js')
  const credMod = await import('../../../server/services/integrationCredentialService.js')
  const secretsMod = await import('../../../server/security/integrationSecrets.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  fetchArtistById = serviceMod.fetchArtistById
  fetchArtistEvents = serviceMod.fetchArtistEvents
  mapArtistLinksToSocials = validatorMod.mapArtistLinksToSocials
  normalizeBandsintownEvent = validatorMod.normalizeBandsintownEvent
  scoreVenueMatch = validatorMod.scoreVenueMatch
  setIntegrationCredential = credMod.setIntegrationCredential
  CREDENTIAL_TYPES = secretsMod.CREDENTIAL_TYPES
  await runMigrations()
})

// The app_id is a per-tenant encrypted integration credential, not an env var.
async function setAppId(tenantId, value = 'test-app-id') {
  await setIntegrationCredential(pool, tenantId, CREDENTIAL_TYPES.BANDSINTOWN_APP_ID, value)
}

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(seed.tenantA.id))
}

function asUserB(req) {
  return req.set('x-test-user-id', String(seed.userB.id)).set('x-test-tenant-id', String(seed.tenantB.id))
}

// ---------- Bandsintown fetch fakes ----------

const ARTIST_JSON = {
  id: '15556138',
  name: 'The Woods (NL)',
  url: 'https://www.bandsintown.com/a/15556138?came_from=267',
  image_url: 'https://photos.bandsintown.com/large/20802144.jpeg',
  thumb_url: 'https://photos.bandsintown.com/thumb/20802144.jpeg',
  tracker_count: 501,
  upcoming_event_count: 3,
  links: [
    { type: 'youtube', url: 'https://www.youtube.com/@thewoods1957' },
    { type: 'spotify', url: 'https://open.spotify.com/artist/06DpifCdtoyId3wTL5hRXv' },
    { type: 'instagram', url: 'https://www.instagram.com/thewoodsbandnl/' },
    { type: 'website', url: 'http://thewoodsmusic.nl' },
    { type: 'facebook', url: 'https://www.facebook.com/TheWoodsBandNL' },
  ],
}

const EVENT_JSON = {
  id: '108197116',
  url: 'https://www.bandsintown.com/e/108197116?app_id=x&came_from=267',
  datetime: '2026-07-06T15:00:00',
  title: 'Tall Ships Races 2026',
  description: 'Woods play live! on sail-out parade!',
  venue: {
    location: 'Harlingen, Netherlands',
    name: 'Tall Ships Races 2026',
    latitude: '53.1720076',
    longitude: '5.411957399999999',
    street_address: 'Nieuwe Willemshaven 5',
    postal_code: '8862 RZ',
    city: 'Harlingen',
    country: 'Netherlands',
    region: '',
  },
  offers: [{ status: 'available', type: 'Free', url: 'https://www.bandsintown.com/t/108197116' }],
  free: true,
  artist_id: '15556138',
  festival_start_date: '',
  starts_at: '2026-07-06T15:00:00',
  ends_at: '2026-07-06T16:00:00',
}

const EVENT_JSON_2 = {
  id: '108395923',
  url: 'https://www.bandsintown.com/e/108395923?app_id=x',
  datetime: '2026-08-23T16:00:00',
  title: 'Schokker blues',
  venue: {
    location: 'Schokland, Netherlands',
    name: 'Schokker blues',
    street_address: 'Middelbuurt 2',
    postal_code: '8319 AB',
    city: 'Schokland',
    country: 'Netherlands',
    region: '',
  },
  offers: [],
  free: false,
  starts_at: '2026-08-23T16:00:00',
  ends_at: '2026-08-23T17:00:00',
}

function jsonResponse(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

// Routes /artists/id_* to the artist payload and /events to the events list.
function fakeBandsintown({ artist = ARTIST_JSON, events = [EVENT_JSON, EVENT_JSON_2] } = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes('/events')) return jsonResponse(events)
    return jsonResponse(artist)
  }
  fetchImpl.calls = calls
  return fetchImpl
}

async function setTenantArtist(tenantId, { id = '15556138', name = null } = {}) {
  await pool.query(
    'UPDATE tenants SET bandsintown_artist_id = $2, bandsintown_artist_name = $3 WHERE id = $1',
    [tenantId, id, name],
  )
}

// ---------- validators ----------

describe('bandsintown validators', () => {
  it('maps artist links onto profile social handles', () => {
    const socials = mapArtistLinksToSocials(ARTIST_JSON.links)
    expect(socials).toEqual({
      youtube_handle: '@thewoods1957',
      spotify_handle: '06DpifCdtoyId3wTL5hRXv',
      instagram_handle: 'thewoodsbandnl',
      facebook_handle: 'TheWoodsBandNL',
    })
  })

  it('normalizes an event payload into an import candidate', () => {
    const row = normalizeBandsintownEvent(EVENT_JSON)
    expect(row).toMatchObject({
      bandsintown_event_id: '108197116',
      event_date: '2026-07-06',
      event_description: 'Tall Ships Races 2026',
      start_time: '15:00',
      end_time: '16:00',
      admission: 'free',
      ticket_link: 'https://www.bandsintown.com/t/108197116',
    })
    expect(row.venue).toMatchObject({
      name: 'Tall Ships Races 2026',
      city: 'Harlingen',
      street_address: 'Nieuwe Willemshaven 5',
      postal_code: '8862 RZ',
    })
  })

  it('scores venue matches on name/city/street/postal', () => {
    const eventVenue = normalizeBandsintownEvent(EVENT_JSON).venue
    expect(scoreVenueMatch(eventVenue, {
      name: 'Tall Ships Races 2026', city: 'Harlingen',
    })).toBe(1)
    expect(scoreVenueMatch(eventVenue, {
      name: 'Tall Ships', city: 'Rotterdam', postal_code: '8862RZ',
    })).toBe(0.9)
    expect(scoreVenueMatch(eventVenue, {
      name: 'Completely Different', city: 'Elsewhere',
    })).toBe(0)
  })
})

// ---------- artist lookup ----------

describe('GET /api/bandsintown/artist/:artistId', () => {
  it('returns artist name and mapped socials via the service', async () => {
    await setAppId(seed.tenantA.id)
    const fetchImpl = fakeBandsintown()
    const result = await fetchArtistById(pool, seed.tenantA.id, '15556138', fetchImpl)
    expect(result.error).toBeUndefined()
    expect(result.artist.name).toBe('The Woods (NL)')
    expect(result.artist.socials.instagram_handle).toBe('thewoodsbandnl')
    expect(fetchImpl.calls[0]).toContain('/artists/id_15556138')
    expect(fetchImpl.calls[0]).toContain('app_id=test-app-id')
  })

  it('rejects a non-numeric artist id', async () => {
    await setAppId(seed.tenantA.id)
    const result = await fetchArtistById(pool, seed.tenantA.id, 'The Woods', fakeBandsintown())
    expect(result.error.status).toBe(400)
  })

  it('404s when Bandsintown does not know the artist', async () => {
    await setAppId(seed.tenantA.id)
    const result = await fetchArtistById(pool, seed.tenantA.id, '999', async () => jsonResponse('', 404))
    expect(result.error.status).toBe(404)
  })

  it('400s when the tenant has no API key configured', async () => {
    const res = await asUserA(request(app).get('/api/bandsintown/artist/15556138'))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Bandsintown API key is not configured')
  })

  it('uses the per-tenant key: configuring tenant A does not enable tenant B', async () => {
    await setAppId(seed.tenantA.id)
    const result = await fetchArtistEvents(pool, seed.tenantB.id, fakeBandsintown())
    expect(result.error.status).toBe(400)
    expect(result.error.body.error).toBe('Bandsintown API key is not configured')
  })
})

describe('/api/profile/bandsintown-key', () => {
  it('sets, reports and clears the key without exposing its value', async () => {
    const empty = await asUserA(request(app).get('/api/profile/bandsintown-key'))
    expect(empty.body.isSet).toBe(false)

    const put = await asUserA(request(app).put('/api/profile/bandsintown-key'))
      .send({ key: 'js_www.example.com' })
    expect(put.status).toBe(200)
    expect(put.body.isSet).toBe(true)
    expect(JSON.stringify(put.body)).not.toContain('js_www.example.com')

    // Stored encrypted, plaintext column stays empty.
    const { rows: [row] } = await pool.query(
      'SELECT bandsintown_app_id, bandsintown_app_id_encrypted FROM tenants WHERE id = $1',
      [seed.tenantA.id],
    )
    expect(row.bandsintown_app_id).toBeNull()
    expect(row.bandsintown_app_id_encrypted).not.toBeNull()

    const del = await asUserA(request(app).delete('/api/profile/bandsintown-key'))
    expect(del.body.isSet).toBe(false)
  })

  it('rejects an invalid key', async () => {
    const res = await asUserA(request(app).put('/api/profile/bandsintown-key'))
      .send({ key: '  ' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_bandsintown_key')
  })
})

// ---------- events ----------

describe('fetchArtistEvents', () => {
  it('fetches the artist by id first, then events by artist name', async () => {
    await setAppId(seed.tenantA.id)
    await setTenantArtist(seed.tenantA.id)
    const fetchImpl = fakeBandsintown()
    const result = await fetchArtistEvents(pool, seed.tenantA.id, fetchImpl)
    expect(result.error).toBeUndefined()
    expect(fetchImpl.calls[0]).toContain('/artists/id_15556138')
    expect(fetchImpl.calls[1]).toContain(`/artists/${encodeURIComponent('The Woods (NL)')}/events`)
    expect(result.events).toHaveLength(2)
    expect(result.events[0].matched_venue).toBeNull()
    expect(result.events[0].is_duplicate).toBe(false)
  })

  it('400s when the tenant has no artist id or name configured', async () => {
    await setAppId(seed.tenantA.id)
    const result = await fetchArtistEvents(pool, seed.tenantA.id, fakeBandsintown())
    expect(result.error.status).toBe(400)
  })

  it('annotates events with a matching venue from the own tenant only', async () => {
    await setAppId(seed.tenantA.id)
    await setAppId(seed.tenantB.id)
    await setTenantArtist(seed.tenantA.id)
    await setTenantArtist(seed.tenantB.id)
    // The matching venue exists in tenant B only.
    await pool.query(
      `INSERT INTO venues (tenant_id, category, name, city) VALUES ($1, 'venue', 'Tall Ships Races 2026', 'Harlingen')`,
      [seed.tenantB.id],
    )

    const forA = await fetchArtistEvents(pool, seed.tenantA.id, fakeBandsintown())
    expect(forA.events[0].matched_venue).toBeNull()

    const forB = await fetchArtistEvents(pool, seed.tenantB.id, fakeBandsintown())
    expect(forB.events[0].matched_venue).toMatchObject({ name: 'Tall Ships Races 2026', category: 'venue' })
  })

  it('flags duplicates by existing event link and by date + venue', async () => {
    await setAppId(seed.tenantA.id)
    await setTenantArtist(seed.tenantA.id)
    // Gig previously imported from the same Bandsintown event.
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, event_link)
       VALUES ($1, '2026-07-06', 'Old import', 'https://www.bandsintown.com/e/108197116?app_id=old')`,
      [seed.tenantA.id],
    )
    // Same-date gig at a venue whose name matches the second event.
    const { rows: [venue] } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name, city) VALUES ($1, 'venue', 'Schokker blues', 'Schokland') RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, venue_id) VALUES ($1, '2026-08-23', 'Existing', $2)`,
      [seed.tenantA.id, venue.id],
    )

    const result = await fetchArtistEvents(pool, seed.tenantA.id, fakeBandsintown())
    expect(result.events.map((e) => e.is_duplicate)).toEqual([true, true])
  })

  it('does not flag a same-date gig at a similar-named venue in a different city', async () => {
    await setAppId(seed.tenantA.id)
    await setTenantArtist(seed.tenantA.id)
    // Similar name, but Amsterdam — not the event's Schokland venue.
    const { rows: [venue] } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name, city) VALUES ($1, 'venue', 'Schokker blues café', 'Amsterdam') RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, venue_id) VALUES ($1, '2026-08-23', 'Existing', $2)`,
      [seed.tenantA.id, venue.id],
    )

    const result = await fetchArtistEvents(pool, seed.tenantA.id, fakeBandsintown())
    expect(result.events[1].is_duplicate).toBe(false)
  })
})

// ---------- import ----------

function importRowFromEvent(event, overrides = {}) {
  const normalized = normalizeBandsintownEvent(event)
  return {
    bandsintown_event_id: normalized.bandsintown_event_id,
    event_date: normalized.event_date,
    event_description: normalized.event_description,
    start_time: normalized.start_time,
    end_time: normalized.end_time,
    event_link: normalized.event_link,
    ticket_link: normalized.ticket_link,
    admission: normalized.admission,
    venue: normalized.venue,
    venue_id: null,
    status: 'confirmed',
    category: 'venue',
    ...overrides,
  }
}

describe('POST /api/bandsintown/import', () => {
  it('creates missing venues/festivals and gigs with lead participants', async () => {
    const res = await asUserA(request(app).post('/api/bandsintown/import')).send({
      events: [
        importRowFromEvent(EVENT_JSON, { category: 'festival' }),
        importRowFromEvent(EVENT_JSON_2),
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ created: 2, skipped: 0, venues_created: 2 })

    const { rows: venues } = await pool.query(
      `SELECT name, category, city, street_and_number, postal_code FROM venues
       WHERE tenant_id = $1 AND name IN ('Tall Ships Races 2026', 'Schokker blues') ORDER BY name`,
      [seed.tenantA.id],
    )
    expect(venues).toEqual([
      {
        name: 'Schokker blues', category: 'venue', city: 'Schokland',
        street_and_number: 'Middelbuurt 2', postal_code: '8319 AB',
      },
      {
        name: 'Tall Ships Races 2026', category: 'festival', city: 'Harlingen',
        street_and_number: 'Nieuwe Willemshaven 5', postal_code: '8862 RZ',
      },
    ])

    const { rows: gigs } = await pool.query(
      `SELECT event_description, venue_id, festival_id, admission, status,
              (SELECT COUNT(*)::int FROM gig_participants gp WHERE gp.gig_id = gigs.id) AS participants
       FROM gigs WHERE tenant_id = $1 AND event_link IS NOT NULL ORDER BY event_date`,
      [seed.tenantA.id],
    )
    expect(gigs).toHaveLength(2)
    expect(gigs[0].festival_id).not.toBeNull()
    expect(gigs[0].venue_id).toBeNull()
    expect(gigs[0].admission).toBe('free')
    expect(gigs[0].participants).toBe(1)
    expect(gigs[1].venue_id).not.toBeNull()
    expect(gigs[1].festival_id).toBeNull()
  })

  it('reuses an existing venue and skips duplicates on re-import', async () => {
    const body = { events: [importRowFromEvent(EVENT_JSON), importRowFromEvent(EVENT_JSON_2)] }
    const first = await asUserA(request(app).post('/api/bandsintown/import')).send(body)
    expect(first.body).toEqual({ created: 2, skipped: 0, venues_created: 2 })

    const second = await asUserA(request(app).post('/api/bandsintown/import')).send(body)
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ created: 0, skipped: 2, venues_created: 0 })

    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM gigs WHERE tenant_id = $1 AND event_link IS NOT NULL`,
      [seed.tenantA.id],
    )
    expect(count).toBe(2)
  })

  it('rejects a venue_id from another tenant without leaking existence', async () => {
    const { rows: [venueB] } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name) VALUES ($1, 'venue', 'B-only Hall') RETURNING id`,
      [seed.tenantB.id],
    )
    const res = await asUserA(request(app).post('/api/bandsintown/import')).send({
      events: [importRowFromEvent(EVENT_JSON, { venue_id: venueB.id })],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('venue_id not found')
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM gigs WHERE tenant_id = $1 AND event_link IS NOT NULL`,
      [seed.tenantA.id],
    )
    expect(count).toBe(0)
  })

  it('keeps imported data scoped to the importing tenant', async () => {
    await asUserA(request(app).post('/api/bandsintown/import')).send({
      events: [importRowFromEvent(EVENT_JSON)],
    })
    const listForB = await asUserB(request(app).get('/api/venues'))
    expect(listForB.body.some((v) => v.name === 'Tall Ships Races 2026')).toBe(false)
  })

  it('400s on an empty body', async () => {
    const res = await asUserA(request(app).post('/api/bandsintown/import')).send({ events: [] })
    expect(res.status).toBe(400)
  })

  it('does not create a venue for an event skipped as a duplicate', async () => {
    // The event id already exists on a gig, but its venue does not exist yet.
    await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, event_link)
       VALUES ($1, '2026-07-06', 'Old import', 'https://www.bandsintown.com/e/108197116?app_id=old')`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).post('/api/bandsintown/import')).send({
      events: [importRowFromEvent(EVENT_JSON)],
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ created: 0, skipped: 1, venues_created: 0 })
    const { rows } = await pool.query(
      `SELECT 1 FROM venues WHERE tenant_id = $1 AND name = 'Tall Ships Races 2026'`,
      [seed.tenantA.id],
    )
    expect(rows).toHaveLength(0)
  })

  it('400s on malformed dates and times instead of failing in the database', async () => {
    const badDate = await asUserA(request(app).post('/api/bandsintown/import')).send({
      events: [importRowFromEvent(EVENT_JSON, { event_date: '2026-99-99' })],
    })
    expect(badDate.status).toBe(400)
    expect(badDate.body.error).toBe('Invalid event_date')

    const badTime = await asUserA(request(app).post('/api/bandsintown/import')).send({
      events: [importRowFromEvent(EVENT_JSON, { start_time: 'invalid' })],
    })
    expect(badTime.status).toBe(400)
    expect(badTime.body.error).toBe('Invalid start_time')

    const badEndTime = await asUserA(request(app).post('/api/bandsintown/import')).send({
      events: [importRowFromEvent(EVENT_JSON, { end_time: '25:00' })],
    })
    expect(badEndTime.status).toBe(400)
    expect(badEndTime.body.error).toBe('Invalid end_time')
  })
})
