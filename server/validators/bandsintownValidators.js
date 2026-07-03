// Input parsing and pure mapping helpers for the Bandsintown integration.
// No DB or network access here.

export const VALID_IMPORT_STATUSES = ['option', 'confirmed', 'announced']
export const VALID_IMPORT_CATEGORIES = new Set(['venue', 'festival'])

// Bandsintown artist ids are numeric strings (e.g. "15556138").
export function parseArtistId(value) {
  const s = String(value ?? '').trim()
  return /^\d{1,20}$/.test(s) ? s : null
}

// Maps a Bandsintown `links` array onto the tenant profile social handle
// fields. Handles are stored without the site prefix, matching the profile
// form (`instagram.com/<handle>`, `tiktok.com/@<handle>`, `youtube.com/<handle>`,
// `open.spotify.com/artist/<id>`).
const LINK_EXTRACTORS = [
  { type: 'instagram', field: 'instagram_handle', re: /instagram\.com\/([^/?#]+)/i },
  { type: 'facebook', field: 'facebook_handle', re: /facebook\.com\/([^/?#]+)/i },
  { type: 'tiktok', field: 'tiktok_handle', re: /tiktok\.com\/@?([^/?#]+)/i },
  { type: 'youtube', field: 'youtube_handle', re: /youtube\.com\/([^/?#]+)/i },
  { type: 'spotify', field: 'spotify_handle', re: /open\.spotify\.com\/artist\/([^/?#]+)/i },
]

export function mapArtistLinksToSocials(links) {
  const socials = {}
  if (!Array.isArray(links)) return socials
  for (const link of links) {
    if (!link || typeof link.url !== 'string') continue
    const extractor = LINK_EXTRACTORS.find((e) => e.type === link.type)
    if (!extractor) continue
    const match = extractor.re.exec(link.url)
    if (match) socials[extractor.field] = decodeURIComponent(match[1])
  }
  return socials
}

// Extracts the numeric Bandsintown event id from an event page URL
// (https://www.bandsintown.com/e/108197116?...). Used to dedupe against
// previously imported gigs whose event_link points at the same event.
export function extractEventIdFromLink(url) {
  if (typeof url !== 'string') return null
  const match = /bandsintown\.com\/e\/(\d+)/i.exec(url)
  return match ? match[1] : null
}

function timeFromIso(value) {
  if (typeof value !== 'string') return null
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(value)
  return match ? match[1] : null
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// Normalizes one Bandsintown event payload into an import candidate the
// review UI and the import endpoint share. Returns null for rows without a
// usable date.
export function normalizeBandsintownEvent(event) {
  if (!event || typeof event !== 'object') return null
  const datetime = trimmed(event.starts_at) || trimmed(event.datetime)
  const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(datetime)
  if (!dateMatch) return null

  const venue = event.venue && typeof event.venue === 'object' ? event.venue : {}
  const offers = Array.isArray(event.offers) ? event.offers : []
  const description = trimmed(event.title) || trimmed(event.description) || trimmed(venue.name)
  if (!description) return null

  return {
    bandsintown_event_id: trimmed(event.id) || extractEventIdFromLink(event.url),
    event_date: dateMatch[1],
    event_description: description,
    start_time: timeFromIso(trimmed(event.starts_at) || trimmed(event.datetime)),
    end_time: timeFromIso(trimmed(event.ends_at)),
    event_link: trimmed(event.url) || null,
    ticket_link: offers.map((o) => trimmed(o?.url)).find(Boolean) || null,
    admission: event.free === true ? 'free' : 'paid',
    is_festival: Boolean(trimmed(event.festival_start_date)),
    venue: {
      name: trimmed(venue.name),
      city: trimmed(venue.city),
      region: trimmed(venue.region),
      country: trimmed(venue.country),
      postal_code: trimmed(venue.postal_code),
      street_address: trimmed(venue.street_address),
      location: trimmed(venue.location),
      latitude: trimmed(venue.latitude) || null,
      longitude: trimmed(venue.longitude) || null,
    },
  }
}

// venues.country is a CHAR(2) ISO code; Bandsintown sends full English
// country names. Codes pass through; unknown names map to null.
const COUNTRY_CODES = {
  netherlands: 'NL', 'the netherlands': 'NL', belgium: 'BE', germany: 'DE',
  france: 'FR', luxembourg: 'LU', 'united kingdom': 'GB', ireland: 'IE',
  spain: 'ES', portugal: 'PT', italy: 'IT', austria: 'AT', switzerland: 'CH',
  denmark: 'DK', sweden: 'SE', norway: 'NO', finland: 'FI', poland: 'PL',
  'czech republic': 'CZ', czechia: 'CZ', hungary: 'HU', greece: 'GR',
  'united states': 'US', canada: 'CA', australia: 'AU', 'new zealand': 'NZ',
  japan: 'JP', brazil: 'BR', mexico: 'MX', 'south africa': 'ZA',
}

export function countryToIso2(value) {
  const s = String(value ?? '').trim()
  if (!s) return null
  if (/^[a-z]{2}$/i.test(s)) return s.toUpperCase()
  return COUNTRY_CODES[s.toLowerCase()] ?? null
}

const norm = (v) => String(v ?? '').trim().toLowerCase()
const normPostal = (v) => norm(v).replace(/\s+/g, '')

function nameTokens(value) {
  return new Set(
    norm(value)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  )
}

function tokenOverlap(a, b) {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (!ta.size || !tb.size) return 0
  const intersection = [...ta].filter((t) => tb.has(t)).length
  const union = new Set([...ta, ...tb]).size
  return union === 0 ? 0 : intersection / union
}

// Scores how likely a Bandsintown event venue and an existing venue row are
// the same place, using name, city, street address and postal code.
export function scoreVenueMatch(eventVenue, dbVenue) {
  const sameCity = Boolean(norm(eventVenue.city)) && norm(eventVenue.city) === norm(dbVenue.city)
  const nameScore = tokenOverlap(eventVenue.name, dbVenue.name)

  if (nameScore === 1 && sameCity) return 1
  if (
    normPostal(eventVenue.postal_code) &&
    normPostal(eventVenue.postal_code) === normPostal(dbVenue.postal_code) &&
    nameScore >= 0.3
  ) return 0.9
  if (
    norm(eventVenue.street_address) &&
    norm(eventVenue.street_address) === norm(dbVenue.street_and_number) &&
    sameCity
  ) return 0.85
  if (nameScore >= 0.5 && sameCity) return 0.7
  if (nameScore >= 0.8) return 0.6
  return 0
}

export const VENUE_MATCH_THRESHOLD = 0.6

// Picks the best-matching existing venue for an event, or null.
export function findBestVenueMatch(eventVenue, dbVenues) {
  let best = null
  let bestScore = 0
  for (const venue of dbVenues) {
    const score = scoreVenueMatch(eventVenue, venue)
    if (score > bestScore) {
      best = venue
      bestScore = score
    }
  }
  return bestScore >= VENUE_MATCH_THRESHOLD ? { venue: best, score: bestScore } : null
}

// A real calendar date in YYYY-MM-DD form (rejects e.g. 2026-99-99, 2026-02-30).
export function isValidCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// HH:MM (24h), optionally with seconds.
export function isValidTimeOfDay(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)
}

// Validates one row of the import request body. Returns { error } | { row }.
export function normalizeImportEventRow(item) {
  if (!item || typeof item !== 'object') return { error: 'Invalid event row' }
  if (!isValidCalendarDate(item.event_date)) return { error: 'Invalid event_date' }
  if (item.start_time && !isValidTimeOfDay(item.start_time)) return { error: 'Invalid start_time' }
  if (item.end_time && !isValidTimeOfDay(item.end_time)) return { error: 'Invalid end_time' }
  const normalized = normalizeBandsintownEvent({
    id: item.bandsintown_event_id,
    starts_at: `${item.event_date}T${item.start_time || '00:00'}`,
    ends_at: item.end_time ? `${item.event_date}T${item.end_time}` : '',
    title: item.event_description,
    url: item.event_link,
    offers: item.ticket_link ? [{ url: item.ticket_link }] : [],
    free: item.admission !== 'paid',
    venue: item.venue,
  })
  if (!normalized) return { error: 'event_date and event_description are required' }
  normalized.start_time = item.start_time || null

  const status = item.status && VALID_IMPORT_STATUSES.includes(item.status) ? item.status : 'confirmed'
  const category = VALID_IMPORT_CATEGORIES.has(item.category) ? item.category : 'venue'

  const venueId = item.venue_id ?? null
  if (venueId !== null && (!Number.isInteger(Number(venueId)) || Number(venueId) <= 0)) {
    return { error: 'Invalid venue_id' }
  }

  return { row: { ...normalized, status, category, venue_id: venueId === null ? null : Number(venueId) } }
}
