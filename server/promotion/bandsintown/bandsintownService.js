// Bandsintown integration: artist lookup (socials), upcoming-event fetch with
// venue matching + duplicate detection, and the import that creates missing
// venues/festivals and gigs in one transaction. External calls go through the
// public Bandsintown REST API; the app_id comes from the tenant's encrypted
// integration credential (see integrationCredentialService). Pass `fetchImpl`
// to inject a fake in tests.
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { logger } from '../../utils/logger.js'
import {
  parseArtistId,
  mapArtistLinksToSocials,
  normalizeBandsintownEvent,
  normalizeImportEventRow,
  findBestVenueMatch,
  extractEventIdFromLink,
  scoreVenueMatch,
  countryToIso2,
} from './bandsintownValidators.js'
import { venueImportKey } from '../../domain/venue.js'
import { badRequest } from '../../platform/http/serviceErrors.js'
import {
  insertVenue,
  fetchVenue,
  listVenuesForImportMatching,
} from '../../people/venues/venueRepository.js'
import {
  getLeadMemberIds,
  insertGigForImport,
  insertGigParticipant,
  listGigsForImportDuplicateCheck,
} from '../../planning/gigs/gigRepository.js'
import { CREDENTIAL_TYPES } from '../../security/integrationSecrets.js'
import { loadIntegrationCredential } from '../../platform/integrations/integrationCredentialService.js'
import { getBandsintownArtistId } from '../integrations/tenantIntegrationRepository.js'

const API_BASE = 'https://rest.bandsintown.com'

const NOT_CONFIGURED = {
  error: { status: 400, body: { error: 'Bandsintown API key is not configured' } },
}
const ARTIST_ID_NOT_CONFIGURED = {
  error: { status: 400, body: { error: 'Bandsintown artist ID is not configured' } },
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

// Both credentials an API call needs: the app_id and the tenant's artist ID
// (set from the band profile or Settings → Integrations — the same stored
// field). Returns { error } | { appId, artistId }.
async function loadApiConfig(db, tenantId) {
  const appId = await loadAppId(db, tenantId)
  if (!appId) return NOT_CONFIGURED
  const artistId = parseArtistId(await getBandsintownArtistId(db, tenantId))
  if (!artistId) return ARTIST_ID_NOT_CONFIGURED
  return { appId, artistId }
}

// GET /artists/id_{artist_id} — returns the artist name, images and the social
// links mapped onto profile handle fields. Takes the id explicitly so the
// profile socials editor can look up the value being typed before it is saved.
export async function fetchArtistById(db, tenantId, artistIdRaw, fetchImpl = globalThis.fetch) {
  const appId = await loadAppId(db, tenantId)
  if (!appId) return NOT_CONFIGURED
  return fetchArtistWithAppId(appId, artistIdRaw, fetchImpl)
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

// Resolves the tenant's configured Bandsintown artist and fetches its upcoming
// events, annotated with the best matching existing venue and a duplicate flag.
// Returns { error } | { artist, events }.
export async function fetchArtistEvents(db, tenantId, fetchImpl = globalThis.fetch) {
  const config = await loadApiConfig(db, tenantId)
  if (config.error) return config

  const { appId } = config
  const result = await fetchArtistWithAppId(appId, config.artistId, fetchImpl)
  if (result.error) return result
  const artist = result.artist

  const eventsResult = await bandsintownGet(
    `/artists/${encodeURIComponent(artist.name)}/events`,
    appId,
    fetchImpl,
  )
  if (eventsResult.failed) return UPSTREAM_FAILED
  if (eventsResult.notFound) return ARTIST_NOT_FOUND
  const rawEvents = Array.isArray(eventsResult.json) ? eventsResult.json : []

  const [venues, existingGigs] = await Promise.all([
    listVenuesForImportMatching(db, tenantId),
    listGigsForImportDuplicateCheck(db, tenantId),
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

// Looks up the venue for one import row without creating anything: an
// explicit venue_id must exist in the tenant; otherwise reuse an existing
// venue with the same name+city (or one created earlier in this batch).
// Returns { error } | { venue } — venue null means "would need to be created".
async function lookupImportVenue(client, tenantId, row, venuesByKey) {
  if (row.venue_id !== null) {
    const venue = await fetchVenue(client, row.venue_id, tenantId)
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
    latitude: row.venue.latitude,
    longitude: row.venue.longitude,
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
  const venues = await listVenuesForImportMatching(client, tenantId)
  const existingGigs = await listGigsForImportDuplicateCheck(client, tenantId)
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
