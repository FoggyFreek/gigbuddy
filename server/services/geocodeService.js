const GEOCODING_ENABLED = process.env.GEOCODING_ENABLED !== 'false'

const GEOCODER = {
  buildUrls({ city, region, country, address, postalCode }) {
    const base = 'https://nominatim.openstreetmap.org/search'
    const common = { format: 'jsonv2', limit: '1' }

    const structured = new URLSearchParams({ ...common, city })
    if (address) structured.set('street', address)
    if (postalCode) structured.set('postalcode', postalCode)
    if (region) structured.set('state', region)
    if (country) {
      if (/^[a-z]{2}$/i.test(country)) {
        structured.set('countrycodes', country.toLowerCase())
      } else {
        structured.set('country', country)
      }
    }

    const free = new URLSearchParams({
      ...common,
      q: [address, postalCode, city, region, country].filter(Boolean).join(', '),
    })

    return [`${base}?${structured}`, `${base}?${free}`]
  },
  parse(json) {
    if (!Array.isArray(json) || json.length === 0) return null
    const lat = Number(json[0]?.lat)
    const lon = Number(json[0]?.lon)
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
  },
}

const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
const GAP_MS = 1000
const USER_AGENT = process.env.GEOCODER_USER_AGENT || 'gigbuddy-server-geocoder/1.0'

const norm = (v) => String(v ?? '').trim().toLowerCase()

function cacheKey({ city, region, country, address, postalCode }) {
  const base = `${norm(city)}|${norm(region)}|${norm(country)}`
  // Keep the three-part key when no refinement is present so pre-existing
  // city-level cache entries stay reusable; only widen when we actually
  // geocode at street/postal precision.
  if (!norm(address) && !norm(postalCode)) return base
  return `${base}|${norm(postalCode)}|${norm(address)}`
}

const cache = new Map()
const inflight = new Map()

function readCache(key) {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.status === 'empty') {
    return Date.now() - entry.ts < MISS_TTL_MS ? { status: 'empty' } : undefined
  }
  if (entry.status === 'hit') {
    return { status: 'hit', coords: entry.coords }
  }
  return undefined
}

function writeHit(key, coords) {
  cache.set(key, { status: 'hit', coords })
}

function writeMiss(key) {
  cache.set(key, { status: 'empty', ts: Date.now() })
}

const noop = () => {}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let chain = Promise.resolve()
let lastCallAt = 0

function enqueue(task) {
  const run = async () => {
    const wait = GAP_MS - (Date.now() - lastCallAt)
    if (wait > 0) await delay(wait)
    lastCallAt = Date.now()
    return task()
  }
  const result = chain.then(run, run)
  chain = result.then(noop, noop)
  return result
}

async function runQuery(url, fetchImpl) {
  return enqueue(async () => {
    try {
      const res = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
      })
      if (!res.ok) return { status: 'fail' }
      const coords = GEOCODER.parse(await res.json())
      return coords ? { status: 'hit', coords } : { status: 'empty' }
    } catch {
      return { status: 'fail' }
    }
  })
}

async function fetchAndCache(key, place, fetchImpl) {
  const [structuredUrl, fallbackUrl] = GEOCODER.buildUrls(place)

  const structured = await runQuery(structuredUrl, fetchImpl)
  if (structured.status === 'hit') {
    writeHit(key, structured.coords)
    return structured
  }
  if (structured.status === 'fail') return structured

  const fallback = await runQuery(fallbackUrl, fetchImpl)
  if (fallback.status === 'hit') {
    writeHit(key, fallback.coords)
    return fallback
  }
  if (fallback.status === 'fail') return fallback

  writeMiss(key)
  return { status: 'empty' }
}

export async function geocodePlace(place = {}, { fetchImpl = globalThis.fetch } = {}) {
  const normalized = {
    city: String(place.city ?? '').trim(),
    region: String(place.region ?? '').trim(),
    country: String(place.country ?? '').trim(),
    address: String(place.address ?? '').trim(),
    postalCode: String(place.postalCode ?? '').trim(),
  }
  if (!GEOCODING_ENABLED || !normalized.city || typeof fetchImpl !== 'function') {
    return { status: 'fail' }
  }

  const key = cacheKey(normalized)
  const cached = readCache(key)
  if (cached !== undefined) return cached

  if (inflight.has(key)) return inflight.get(key)

  const promise = fetchAndCache(key, normalized, fetchImpl).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, promise)
  return promise
}

export function resetGeocodeCacheForTests() {
  cache.clear()
  inflight.clear()
  chain = Promise.resolve()
  lastCallAt = 0
}
