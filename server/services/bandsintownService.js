// Bandsintown integration: artist lookup (socials), upcoming-event fetch with
// venue matching + duplicate detection, and the import that creates missing
// venues/festivals and gigs in one transaction. External calls go through the
// public Bandsintown REST API; the app_id comes from the tenant's encrypted
// integration credential (see integrationCredentialService). Pass `fetchImpl`
// to inject a fake in tests.
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { logger } from '../utils/logger.js'
import {
  parseArtistId,
  mapArtistLinksToSocials,
  normalizeBandsintownEvent,
  normalizeImportEventRow,
  findBestVenueMatch,
  extractEventIdFromLink,
  scoreVenueMatch,
  countryToIso2,
} from '../validators/bandsintownValidators.js'
import { venueImportKey } from '../domain/venue.js'
import { insertVenue } from '../repositories/venueRepository.js'
import {
  getLeadMemberIds,
  insertGigForImport,
  insertGigParticipant,
} from '../repositories/gigRepository.js'
import { CREDENTIAL_TYPES } from '../security/integrationSecrets.js'
import { loadIntegrationCredential } from './integrationCredentialService.js'

const API_BASE = 'https://rest.bandsintown.com'

const NOT_CONFIGURED = {
  error: { status: 400, body: { error: 'Bandsintown API key is not configured' } },
}
const ARTIST_NOT_FOUND = {
  error: { status: 404, body: { error: 'Artist not found on Bandsintown' } },
}
const UPSTREAM_FAILED = {
  error: { status: 502, body: { error: 'Bandsintown request failed' } },
}

// The tenant's Bandsintown app_id, stored as an encrypted integration
// credential and managed via /api/profile/bandsintown-key.
async function loadAppId(db, tenantId) {
  const value = await loadIntegrationCredential(db, tenantId, CREDENTIAL_TYPES.BANDSINTOWN_APP_ID)
  return (value || '').trim() || null
}

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

async function bandsintownGet(path, appId, fetchImpl) {
  let res
  try {
    res = await fetchImpl(`${API_BASE}${path}${path.includes('?') ? '&' : '?'}app_id=${encodeURIComponent(appId)}`, {
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    logger.warn('bandsintown.request_failed', { err })
    return { failed: true }
  }
  if (res.status === 404 || res.status === 403) return { notFound: true }
  if (!res.ok) {
    logger.warn('bandsintown.request_failed', { status: res.status })
    return { failed: true }
  }
  try {
    return { json: await res.json() }
  } catch {
    // Bandsintown answers unknown artists with an empty 200 body.
    return { notFound: true }
  }
}

function toArtistPayload(json) {
  return {
    id: String(json.id ?? ''),
    name: String(json.name ?? ''),
    url: typeof json.url === 'string' ? json.url : null,
    image_url: typeof json.image_url === 'string' ? json.image_url : null,
    thumb_url: typeof json.thumb_url === 'string' ? json.thumb_url : null,
    tracker_count: Number.isFinite(json.tracker_count) ? json.tracker_count : null,
    upcoming_event_count: Number.isFinite(json.upcoming_event_count) ? json.upcoming_event_count : null,
    links: Array.isArray(json.links) ? json.links : [],
    socials: mapArtistLinksToSocials(json.links),
  }
}

async function fetchArtistWithAppId(appId, artistIdRaw, fetchImpl) {
  const artistId = parseArtistId(artistIdRaw)
  if (!artistId) return badRequest('Invalid Bandsintown artist ID')

  const result = await bandsintownGet(`/artists/id_${artistId}`, appId, fetchImpl)
  if (result.failed) return UPSTREAM_FAILED
  if (result.notFound || !result.json || typeof result.json !== 'object' || !result.json.name) {
    return ARTIST_NOT_FOUND
  }
  return { artist: toArtistPayload(result.json) }
}

// GET /artists/id_{artist_id} — returns the artist name, images and the
// social links mapped onto profile handle fields.
export async function fetchArtistById(db, tenantId, artistIdRaw, fetchImpl = globalThis.fetch) {
  const appId = await loadAppId(db, tenantId)
  if (!appId) return NOT_CONFIGURED
  return fetchArtistWithAppId(appId, artistIdRaw, fetchImpl)
}

async function loadTenantArtistConfig(db, tenantId) {
  const { rows } = await db.query(
    'SELECT bandsintown_artist_id, bandsintown_artist_name FROM tenants WHERE id = $1',
    [tenantId],
  )
  return rows[0] ?? null
}

// Lean projection of tenant venues for matching (no contacts/years).
async function listVenuesForMatching(db, tenantId) {
  const { rows } = await db.query(
    `SELECT id, category, name, city, region, country, postal_code, street_and_number
       FROM venues WHERE tenant_id = $1`,
    [tenantId],
  )
  return rows
}

// Existing gigs with their venue/festival names, for duplicate detection.
async function listGigsForDuplicateCheck(db, tenantId) {
  const { rows } = await db.query(
    `SELECT g.id, to_char(g.event_date, 'YYYY-MM-DD') AS event_date, g.event_link,
            g.venue_id, g.festival_id,
            COALESCE(v.name, f.name) AS place_name,
            COALESCE(v.city, f.city) AS place_city
       FROM gigs g
       LEFT JOIN venues v ON v.id = g.venue_id AND v.tenant_id = g.tenant_id
       LEFT JOIN venues f ON f.id = g.festival_id AND f.tenant_id = g.tenant_id
      WHERE g.tenant_id = $1`,
    [tenantId],
  )
  return rows
}

function isDuplicateOfExisting(row, matchedVenueId, existingGigs, existingEventIds) {
  const eventId = row.bandsintown_event_id || extractEventIdFromLink(row.event_link)
  if (eventId && existingEventIds.has(String(eventId))) return true

  return existingGigs.some((gig) => {
    if (gig.event_date !== row.event_date) return false
    if (matchedVenueId !== null && (gig.venue_id === matchedVenueId || gig.festival_id === matchedVenueId)) {
      return true
    }
    return scoreVenueMatch(row.venue, { name: gig.place_name, city: gig.place_city }) >= 0.7
  })
}

function collectExistingEventIds(existingGigs) {
  const ids = new Set()
  for (const gig of existingGigs) {
    const id = extractEventIdFromLink(gig.event_link)
    if (id) ids.add(id)
  }
  return ids
}

// Resolves the tenant's Bandsintown artist (id preferred, stored name as
// fallback) and fetches its upcoming events, annotated with the best matching
// existing venue and a duplicate flag. Returns
// { error } | { artist, events }.
export async function fetchArtistEvents(db, tenantId, fetchImpl = globalThis.fetch) {
  const appId = await loadAppId(db, tenantId)
  if (!appId) return NOT_CONFIGURED

  const config = await loadTenantArtistConfig(db, tenantId)
  if (!config) return { error: { status: 404, body: { error: 'Not found' } } }

  let artist = null
  const artistId = parseArtistId(config.bandsintown_artist_id)
  if (artistId) {
    const result = await fetchArtistWithAppId(appId, artistId, fetchImpl)
    if (result.error) return result
    artist = result.artist
  } else if (config.bandsintown_artist_name?.trim()) {
    artist = { name: config.bandsintown_artist_name.trim() }
  } else {
    return badRequest('Set the Bandsintown artist ID in the band profile first')
  }

  const eventsResult = await bandsintownGet(
    `/artists/${encodeURIComponent(artist.name)}/events`,
    appId,
    fetchImpl,
  )
  if (eventsResult.failed) return UPSTREAM_FAILED
  if (eventsResult.notFound) return ARTIST_NOT_FOUND
  const rawEvents = Array.isArray(eventsResult.json) ? eventsResult.json : []

  const [venues, existingGigs] = await Promise.all([
    listVenuesForMatching(db, tenantId),
    listGigsForDuplicateCheck(db, tenantId),
  ])
  const existingEventIds = collectExistingEventIds(existingGigs)

  const events = []
  for (const raw of rawEvents) {
    const normalized = normalizeBandsintownEvent(raw)
    if (!normalized) continue
    const match = findBestVenueMatch(normalized.venue, venues)
    events.push({
      ...normalized,
      matched_venue: match
        ? {
            id: match.venue.id,
            name: match.venue.name,
            category: match.venue.category,
            city: match.venue.city,
            score: match.score,
          }
        : null,
      is_duplicate: isDuplicateOfExisting(
        normalized, match?.venue.id ?? null, existingGigs, existingEventIds,
      ),
    })
  }

  return { artist, events }
}

async function fetchVenueInTenant(client, venueId, tenantId) {
  const { rows } = await client.query(
    'SELECT id, category, name, city FROM venues WHERE id = $1 AND tenant_id = $2',
    [venueId, tenantId],
  )
  return rows[0] ?? null
}

// Looks up the venue for one import row without creating anything: an
// explicit venue_id must exist in the tenant; otherwise reuse an existing
// venue with the same name+city (or one created earlier in this batch).
// Returns { error } | { venue } — venue null means "would need to be created".
async function lookupImportVenue(client, tenantId, row, venuesByKey) {
  if (row.venue_id !== null) {
    const venue = await fetchVenueInTenant(client, row.venue_id, tenantId)
    if (!venue) return { error: 'venue_id not found' }
    return { venue }
  }
  if (!row.venue.name) return { venue: null }
  return { venue: venuesByKey.get(venueImportKey(row.venue.name, row.venue.city)) ?? null }
}

async function createImportVenue(client, tenantId, row, venuesByKey, summary) {
  const created = await insertVenue(client, tenantId, {
    category: row.category,
    name: row.venue.name,
    street_and_number: row.venue.street_address || null,
    postal_code: row.venue.postal_code || null,
    city: row.venue.city || null,
    region: row.venue.region || null,
    country: countryToIso2(row.venue.country),
  })
  venuesByKey.set(venueImportKey(row.venue.name, row.venue.city), created)
  summary.venues_created++
  return created
}

function parseImportRows(items) {
  const rows = []
  for (const item of items) {
    const parsed = normalizeImportEventRow(item)
    if (parsed.error) return { error: parsed.error }
    rows.push(parsed.row)
  }
  return { rows }
}

// Everything one import batch shares: lead members, dedupe state (updated as
// rows import so later rows dedupe against earlier ones), and the summary.
async function loadImportContext(client, tenantId) {
  const venues = await listVenuesForMatching(client, tenantId)
  const existingGigs = await listGigsForDuplicateCheck(client, tenantId)
  const leadIds = await getLeadMemberIds(client, tenantId)
  return {
    leadIds,
    existingGigs,
    existingEventIds: collectExistingEventIds(existingGigs),
    venuesByKey: new Map(
      venues.map((v) => [venueImportKey(v.name ?? '', v.city ?? ''), v]),
    ),
    summary: { created: 0, skipped: 0, venues_created: 0 },
  }
}

async function createImportGig(client, tenantId, userId, row, venue, ctx) {
  const isFestival = venue?.category === 'festival'
  const gigId = await insertGigForImport(client, tenantId, {
    event_date: row.event_date,
    event_description: row.event_description,
    venueId: isFestival ? null : (venue?.id ?? null),
    festivalId: isFestival ? venue.id : null,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    admission: row.admission,
    event_link: row.event_link,
    ticket_link: row.ticket_link,
  })
  for (const memberId of ctx.leadIds) {
    await insertGigParticipant(client, tenantId, gigId, memberId, userId)
  }

  // Make later rows in this batch dedupe against what we just created.
  ctx.existingGigs.push({
    id: gigId,
    event_date: row.event_date,
    event_link: row.event_link,
    venue_id: isFestival ? null : (venue?.id ?? null),
    festival_id: isFestival ? venue.id : null,
    place_name: venue?.name ?? null,
    place_city: venue?.city ?? null,
  })
  const eventId = row.bandsintown_event_id || extractEventIdFromLink(row.event_link)
  if (eventId) ctx.existingEventIds.add(String(eventId))
}

// Imports one parsed row inside the batch transaction. Returns { error } on a
// bad venue reference (caller rolls back), else {} after updating ctx.summary.
async function importEventRow(client, tenantId, userId, row, ctx) {
  // Duplicate check runs against the looked-up (not yet created) venue so
  // a skipped event never leaves an orphan venue behind.
  const resolved = await lookupImportVenue(client, tenantId, row, ctx.venuesByKey)
  if (resolved.error) return { error: resolved.error }
  let venue = resolved.venue

  if (isDuplicateOfExisting(row, venue?.id ?? null, ctx.existingGigs, ctx.existingEventIds)) {
    ctx.summary.skipped++
    return {}
  }

  if (venue === null && row.venue.name) {
    venue = await createImportVenue(client, tenantId, row, ctx.venuesByKey, ctx.summary)
  }

  await createImportGig(client, tenantId, userId, row, venue, ctx)
  ctx.summary.created++
  return {}
}

// Imports selected Bandsintown events: creates venues/festivals that don't
// exist yet, skips duplicates (same Bandsintown event or same date + place),
// inserts gigs with lead members as participants — all in one transaction.
// Returns { error } | { created, skipped, venues_created }.
export async function importEvents(tenantId, userId, body) {
  const items = Array.isArray(body?.events) ? body.events : null
  if (!items || items.length === 0) {
    return badRequest('Expected non-empty events array')
  }
  if (items.length > 200) {
    return badRequest('Maximum 200 events per import')
  }

  const parsed = parseImportRows(items)
  if (parsed.error) return badRequest(parsed.error)

  return withTransaction(async (client) => {
    const ctx = await loadImportContext(client, tenantId)

    for (const row of parsed.rows) {
      const result = await importEventRow(client, tenantId, userId, row, ctx)
      if (result.error) abortTransaction(badRequest(result.error))
    }

    return ctx.summary
  })
}
