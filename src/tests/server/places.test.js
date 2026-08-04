// The service reads TOMTOM_API_KEY at module load, so set it before anything
// imports it. globalThis.fetch is stubbed per test — no request ever leaves.
process.env.TOMTOM_API_KEY = 'test-key'

import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, afterEach, expect, vi } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let mapPoiResult, resetPlaceSearchCacheForTests, searchPlaces
let seed
const realFetch = globalThis.fetch

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const svc = await import('../../../server/services/placeService.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  mapPoiResult = svc.mapPoiResult
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

const PARADISO = {
  id: 'NL/POI/p0/12345',
  poi: {
    name: 'Paradiso',
    phone: '+31 20 626 4521',
    url: 'www.paradiso.nl',
    categories: ['nightlife', 'concert hall'],
  },
  address: {
    streetName: 'Weteringschans',
    streetNumber: '6-8',
    municipality: 'Amsterdam',
    countrySubdivision: 'Noord-Holland',
    postalCode: '1017SG',
    countryCode: 'NL',
    freeformAddress: 'Weteringschans 6-8, 1017SG Amsterdam',
  },
  position: { lat: 52.3624, lon: 4.8838 },
}

function stubFetch(body, { ok = true, status = 200 } = {}) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  }))
  globalThis.fetch = fetchMock
  return fetchMock
}

describe('mapPoiResult', () => {
  it('maps a POI onto the app field names', () => {
    expect(mapPoiResult(PARADISO)).toEqual({
      id: 'NL/POI/p0/12345',
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
      freeform_address: 'Weteringschans 6-8, 1017SG Amsterdam',
      categories: ['nightlife', 'concert hall'],
    })
  })

  it('gives a scheme-less url an https prefix so the venue url normalizer accepts it', () => {
    expect(mapPoiResult({ poi: { name: 'X', url: 'www.x.nl' } }).website).toBe('https://www.x.nl')
  })

  it('leaves an already-absolute url alone', () => {
    expect(mapPoiResult({ poi: { name: 'X', url: 'http://x.nl/live' } }).website).toBe('http://x.nl/live')
  })

  it('joins street and number, and copes with either one missing', () => {
    expect(mapPoiResult({ poi: { name: 'A' }, address: { streetName: 'Dam' } }).street_and_number).toBe('Dam')
    expect(mapPoiResult({ poi: { name: 'A' }, address: { streetNumber: '5' } }).street_and_number).toBe('5')
  })

  it('upper-cases the 2-letter country code for the CHAR(2) column', () => {
    expect(mapPoiResult({ poi: { name: 'A' }, address: { countryCode: 'nl' } }).country).toBe('NL')
  })

  it('drops a half or out-of-range coordinate pair', () => {
    expect(mapPoiResult({ poi: { name: 'A' }, position: { lat: 52.1 } }).latitude).toBeNull()
    expect(mapPoiResult({ poi: { name: 'A' }, position: { lat: 999, lon: 4.8 } }).longitude).toBeNull()
  })

  it('falls back to the freeform address when the POI has no name', () => {
    expect(mapPoiResult({ address: { freeformAddress: 'Dam 1, Amsterdam' } }).name).toBe('Dam 1, Amsterdam')
  })

  it('returns nulls rather than throwing on an empty result', () => {
    const mapped = mapPoiResult({})
    expect(mapped.name).toBeNull()
    expect(mapped.categories).toEqual([])
  })
})

describe('searchPlaces — validation lives at the service boundary', () => {
  it('rejects a short query without contacting the upstream, even called directly', async () => {
    const fetchImpl = vi.fn()
    const result = await searchPlaces({ q: 'ab' }, { fetchImpl })

    expect(result.error.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('clamps a direct caller\'s oversized limit rather than passing it upstream', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }))
    const result = await searchPlaces({ q: 'Paradiso', limit: 999 }, { fetchImpl })

    expect(fetchImpl.mock.calls[0][0]).toContain('limit=10')
    expect(result.meta.limit).toBe(10)
  })
})

describe('GET /api/places/search', () => {
  it('returns mapped suggestions', async () => {
    stubFetch({ results: [PARADISO] })

    const res = await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(200)

    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({
      name: 'Paradiso',
      city: 'Amsterdam',
      country: 'NL',
      website: 'https://www.paradiso.nl',
    })
  })

  it('calls poiSearch with typeahead and never sends countrySet', async () => {
    const fetchMock = stubFetch({ results: [] })

    await asUserA(request(app).get('/api/places/search').query({ q: 'Melkweg' })).expect(200)

    const url = fetchMock.mock.calls[0][0]
    expect(url).toContain('/search/2/poiSearch/Melkweg.json')
    expect(url).toContain('typeahead=true')
    expect(url).not.toContain('countrySet')
  })

  it('400s on a query under 3 characters', async () => {
    const fetchMock = stubFetch({ results: [] })
    await asUserA(request(app).get('/api/places/search').query({ q: 'ab' })).expect(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400s on a query over the length cap', async () => {
    await asUserA(request(app).get('/api/places/search').query({ q: 'x'.repeat(121) })).expect(400)
  })

  it('clamps limit to the upstream ceiling', async () => {
    const fetchMock = stubFetch({ results: [] })

    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso', limit: '500' })).expect(200)

    expect(fetchMock.mock.calls[0][0]).toContain('limit=10')
  })

  it('returns the bounded-collection envelope echoing the applied limit', async () => {
    stubFetch({ results: [PARADISO] })

    const res = await asUserA(
      request(app).get('/api/places/search').query({ q: 'Paradiso', limit: '3' }),
    ).expect(200)

    expect(res.body.meta).toEqual({ limit: 3, returned: 1 })
    expect(res.body.meta.returned).toBe(res.body.items.length)
  })

  it('bounds the outbound request with an abort signal', async () => {
    const fetchMock = stubFetch({ results: [] })

    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(200)

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('502s when the upstream request times out', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
    })
    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(502)
  })

  it('passes a complete lat/lon bias through and ignores a half pair', async () => {
    const withBias = stubFetch({ results: [] })
    await asUserA(
      request(app).get('/api/places/search').query({ q: 'Paradiso', lat: '52.3', lon: '4.9' }),
    ).expect(200)
    expect(withBias.mock.calls[0][0]).toContain('lat=52.3')

    resetPlaceSearchCacheForTests()
    const halfPair = stubFetch({ results: [] })
    await asUserA(
      request(app).get('/api/places/search').query({ q: 'Paradiso', lat: '52.3' }),
    ).expect(200)
    expect(halfPair.mock.calls[0][0]).not.toContain('lat=')
  })

  it('400s on an out-of-range bias coordinate', async () => {
    await asUserA(
      request(app).get('/api/places/search').query({ q: 'Paradiso', lat: '200', lon: '4.9' }),
    ).expect(400)
  })

  it('serves a repeated query from cache without a second upstream call', async () => {
    const fetchMock = stubFetch({ results: [PARADISO] })

    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(200)
    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(200)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps an upstream failure to 502 and does not cache it', async () => {
    const failing = stubFetch({}, { ok: false, status: 500 })
    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(502)
    expect(failing).toHaveBeenCalledTimes(1)

    // A transient failure must stay retryable.
    stubFetch({ results: [PARADISO] })
    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(200)
  })

  it('502s when the upstream connection throws rather than 500ing the SPA', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNRESET') })
    await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(502)
  })

  it('drops results with no usable name', async () => {
    stubFetch({ results: [{ id: 'x', address: {} }, PARADISO] })

    const res = await asUserA(request(app).get('/api/places/search').query({ q: 'Paradiso' })).expect(200)

    expect(res.body.items).toHaveLength(1)
  })

  it('requires an authenticated tenant member', async () => {
    stubFetch({ results: [] })
    await request(app).get('/api/places/search').query({ q: 'Paradiso' }).expect(401)
  })
})
