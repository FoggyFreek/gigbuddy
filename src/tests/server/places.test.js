// The service reads TOMTOM_API_KEY at module load, so set it before anything
// imports it. globalThis.fetch is stubbed per test — no request ever leaves.
process.env.TOMTOM_API_KEY = 'test-key'

import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, afterEach, expect, vi } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let mapPlaceDetails, mapSuggestResult, resetPlaceSearchCacheForTests, searchPlaces
let seed
const realFetch = globalThis.fetch
const SESSION_ID = '34a45e58-9f68-4ca6-bc0e-4f04311fbc42'

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const svc = await import('../../../server/services/placeService.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  mapPlaceDetails = svc.mapPlaceDetails
  mapSuggestResult = svc.mapSuggestResult
  resetPlaceSearchCacheForTests = svc.resetPlaceSearchCacheForTests
  searchPlaces = svc.searchPlaces
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  resetPlaceSearchCacheForTests()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

const PARADISO_SUGGESTION = {
  id: 'poi-paradiso',
  type: 'poi',
  title: 'Paradiso',
  subtitles: ['Weteringschans 6-8', '1017 SG Amsterdam', 'Netherlands'],
  poiTypes: [{ id: 'concert_hall', name: 'Concert Hall' }],
  more: {
    operation: 'details',
    pathParameters: [
      { parameter: 'type', argument: 'pois' },
      { parameter: 'id', argument: 'poi-paradiso' },
    ],
  },
}

const PARADISO_DETAILS = {
  id: 'poi-paradiso',
  type: 'poi',
  title: 'Paradiso',
  subtitles: ['Weteringschans 6-8, 1017 SG Amsterdam'],
  poiTypes: [{ id: 'concert_hall', name: 'Concert Hall' }],
  address: {
    street: 'Weteringschans',
    houseNumber: '6-8',
    municipality: 'Amsterdam',
    countrySubdivision: 'Noord-Holland',
    postalCode: '1017SG',
    countryCodeIso2: 'NL',
  },
  position: { type: 'Point', coordinates: [4.8838, 52.3624] },
  contacts: [{
    type: 'Reservations',
    phones: ['+31 20 626 4521'],
    websites: ['www.paradiso.nl'],
  }],
}

function stubFetch(body, { ok = true, status = 200 } = {}) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
  }))
  globalThis.fetch = fetchMock
  return fetchMock
}

describe('TomTom Places v3 mapping', () => {
  it('maps a lightweight suggestion and preserves its details reference', () => {
    expect(mapSuggestResult(PARADISO_SUGGESTION, SESSION_ID)).toEqual({
      id: 'poi-paradiso',
      name: 'Paradiso',
      street_and_number: null,
      postal_code: null,
      city: null,
      region: null,
      country: null,
      website: null,
      phone: null,
      latitude: null,
      longitude: null,
      freeform_address: 'Weteringschans 6-8, 1017 SG Amsterdam, Netherlands',
      categories: ['Concert Hall'],
      details: { id: 'poi-paradiso', session_id: SESSION_ID },
    })
  })

  it('maps details, including GeoJSON coordinate order and contacts', () => {
    expect(mapPlaceDetails(PARADISO_DETAILS)).toEqual({
      id: 'poi-paradiso',
      name: 'Paradiso',
      street_and_number: 'Weteringschans 6-8',
      postal_code: '1017SG',
      city: 'Amsterdam',
      region: 'Noord-Holland',
      country: 'NL',
      website: 'https://www.paradiso.nl',
      phone: '+31 20 626 4521',
      latitude: 52.3624,
      longitude: 4.8838,
      freeform_address: 'Weteringschans 6-8, 1017 SG Amsterdam',
      categories: ['Concert Hall'],
      details: null,
    })
  })
})

describe('searchPlaces — validation lives at the service boundary', () => {
  it('rejects a short query without contacting the upstream, even called directly', async () => {
    const fetchImpl = vi.fn()
    const result = await searchPlaces({ q: 'ab' }, { fetchImpl })

    expect(result.error.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('clamps an oversized limit to the v3 maximum', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, headers: new Headers(), json: async () => ({ results: [] }),
    }))
    const result = await searchPlaces({ q: 'Paradiso', limit: 999 }, { fetchImpl })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)

    expect(body.maxResults).toBe(10)
    expect(result.meta.limit).toBe(10)
  })
})

describe('GET /api/places/search', () => {
  it('returns lightweight mapped suggestions', async () => {
    stubFetch({ results: [PARADISO_SUGGESTION] })

    const res = await asUserA(request(app).get('/api/places/search').query({
      q: 'Paradiso', sessionId: SESSION_ID,
    })).expect(200)

    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({
      name: 'Paradiso',
      freeform_address: 'Weteringschans 6-8, 1017 SG Amsterdam, Netherlands',
      details: { id: 'poi-paradiso', session_id: SESSION_ID },
    })
  })

  it('calls v3 Suggest with the required headers, explicit attributes, and POI filter', async () => {
    const fetchMock = stubFetch({ results: [] })

    await asUserA(request(app).get('/api/places/search').query({
      q: 'Paradiso', limit: '3', language: 'nl', sessionId: SESSION_ID,
    })).expect(200)

    const [url, options] = fetchMock.mock.calls[0]
    const headers = new Headers(options.headers)
    expect(url).toBe('https://api.tomtom.com/maps/orbis/places/suggest')
    expect(options.method).toBe('POST')
    expect(headers.get('TomTom-Api-Key')).toBe('test-key')
    expect(headers.get('TomTom-Api-Version')).toBe('3')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('Accept-Language')).toBe('nl')
    expect(headers.get('Session-Id')).toBe(SESSION_ID)
    expect(headers.get('Attributes')).toBe('results(id,type,title,subtitles,address,poiTypes,more)')
    expect(JSON.parse(options.body)).toEqual({
      query: 'Paradiso', maxResults: 3, filters: { types: ['poi'] },
    })
  })

  it('narrows the lookup with the record’s known country and city', async () => {
    const fetchMock = stubFetch({ results: [] })

    await asUserA(request(app).get('/api/places/search').query({
      q: 'Paradiso', country: 'nl', city: 'Amsterdam',
    })).expect(200)

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      query: 'Paradiso Amsterdam',
      maxResults: 10,
      filters: { types: ['poi'], countryCodesIso2: ['NL'] },
    })
  })

  it('does not repeat a city the query already names', async () => {
    const fetchMock = stubFetch({ results: [] })

    await asUserA(request(app).get('/api/places/search').query({
      q: 'Paradiso amsterdam', city: 'Amsterdam',
    })).expect(200)

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toBe('Paradiso amsterdam')
  })

  it('drops an incomplete country code instead of failing the lookup', async () => {
    const fetchMock = stubFetch({ results: [] })

    await asUserA(request(app).get('/api/places/search').query({
      q: 'Paradiso', country: 'N', city: '   ',
    })).expect(200)

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      query: 'Paradiso', maxResults: 10, filters: { types: ['poi'] },
    })
  })

  it('keys the cache on the country and city so a narrowed query is not served a stale answer', async () => {
    const fetchMock = stubFetch({ results: [PARADISO_SUGGESTION] })
    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(200)
    await asUserA(request(app).get('/api/places/search').query({
      q: 'Paradiso', country: 'BE',
    })).expect(200)
    await asUserA(request(app).get('/api/places/search').query({
      q: 'Paradiso', country: 'BE', city: 'Gent',
    })).expect(200)

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('sends a complete bias point longitude-first as origin and ranking preference', async () => {
    const fetchMock = stubFetch({ results: [] })
    await asUserA(request(app).get('/api/places/search').query({
      q: 'Paradiso', lat: '52.3', lon: '4.9',
    })).expect(200)

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      origin: { type: 'point', coordinates: [4.9, 52.3] },
      preferences: { geometry: { type: 'point', coordinates: [4.9, 52.3] } },
    })
  })

  it('ignores a half bias pair and rejects out-of-range coordinates', async () => {
    const fetchMock = stubFetch({ results: [] })
    await asUserA(request(app).get('/api/places/search').query({
      q: 'Paradiso', lat: '52.3',
    })).expect(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('origin')

    resetPlaceSearchCacheForTests()
    await asUserA(request(app).get('/api/places/search').query({
      q: 'Paradiso', lat: '200', lon: '4.9',
    })).expect(400)
  })

  it('returns the bounded-collection envelope echoing the applied limit', async () => {
    stubFetch({ results: [PARADISO_SUGGESTION] })
    const res = await asUserA(
      request(app).get('/api/places/search').query({ q: 'Paradiso', limit: '3' }),
    ).expect(200)

    expect(res.body.meta).toEqual({ limit: 3, returned: 1 })
  })

  it('bounds the outbound request with an abort signal', async () => {
    const fetchMock = stubFetch({ results: [] })
    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(200)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('serves a repeated query from cache without a second upstream call', async () => {
    const fetchMock = stubFetch({ results: [PARADISO_SUGGESTION] })
    const query = { q: 'Paradiso', sessionId: SESSION_ID }
    await asUserA(request(app).get('/api/places/search').query(query)).expect(200)
    await asUserA(request(app).get('/api/places/search').query(query)).expect(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps timeouts, network faults, and upstream failures to retryable 502s', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
    })
    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(502)

    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNRESET') })
    await asUserA(request(app).get('/api/places/search').query({ q: 'Melkweg' })).expect(502)

    stubFetch({}, { ok: false, status: 500 })
    await asUserA(request(app).get('/api/places/search').query({ q: 'Ziggo Dome' })).expect(502)
  })

  it('requires an authenticated tenant member', async () => {
    stubFetch({ results: [] })
    await request(app).get('/api/places/search').query({ q: 'Paradiso' }).expect(401)
  })
})

describe('GET /api/places/details/:id', () => {
  it('follows a selected suggestion with one v3 Details request', async () => {
    const fetchMock = stubFetch(PARADISO_DETAILS)
    const res = await asUserA(request(app).get('/api/places/details/poi-paradiso').query({
      sessionId: SESSION_ID,
    })).expect(200)

    expect(res.body).toMatchObject({
      name: 'Paradiso', website: 'https://www.paradiso.nl', latitude: 52.3624,
    })
    const [url, options] = fetchMock.mock.calls[0]
    const headers = new Headers(options.headers)
    expect(url).toBe('https://api.tomtom.com/maps/orbis/places/details/pois/poi-paradiso')
    expect(options.method).toBe('GET')
    expect(headers.get('Session-Id')).toBe(SESSION_ID)
    expect(headers.get('Attributes')).toBe('id,type,title,subtitles,position,address,contacts,poiTypes')
  })

  it('rejects malformed ids without contacting TomTom', async () => {
    const fetchMock = stubFetch(PARADISO_DETAILS)
    await asUserA(request(app).get('/api/places/details/not%20valid')).expect(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a Details provider failure to 502', async () => {
    stubFetch({}, { ok: false, status: 403 })
    await asUserA(request(app).get('/api/places/details/poi-paradiso')).expect(502)
  })
})
