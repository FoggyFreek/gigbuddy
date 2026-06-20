// Domain logic for the per-user iCalendar feed: token lifecycle (describe /
// regenerate / revoke) and building the public read-only .ics document.
//
// Serialization is delegated to shared/ics.js (the same module the frontend
// month export uses), so the feed and the in-app export produce identical
// output. This service only maps DB rows into the normalized IcsEvent shape.

import { randomBytes } from 'node:crypto'
import { buildIcsCalendar } from '../../shared/ics.js'
import {
  getTokenByUserTenant,
  upsertToken,
  deleteToken,
  resolveToken,
  touchToken,
} from '../repositories/calendarFeedRepository.js'
import { listGigsWithTaskCounts } from '../repositories/gigRepository.js'
import { listRehearsals, loadParticipants } from '../repositories/rehearsalRepository.js'
import { listBandEvents } from '../repositories/bandEventRepository.js'

const PROD_ID = '-//GigBuddy//EN'

function appBase() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
}

function generateToken() {
  return randomBytes(32).toString('base64url')
}

// Absolute URL an external calendar app subscribes to. Token lives in the path
// so the URL ends in .ics, which some clients require.
function feedUrl(token) {
  return `${appBase()}/api/public/calendar/${token}/feed.ics`
}

function shapeFeed(row) {
  return {
    url: feedUrl(row.token),
    created_at: row.created_at,
    last_accessed_at: row.last_accessed_at,
  }
}

export async function getOrDescribeFeed(pool, userId, tenantId) {
  const row = await getTokenByUserTenant(pool, userId, tenantId)
  return row ? shapeFeed(row) : null
}

export async function regenerateFeed(pool, userId, tenantId) {
  const row = await upsertToken(pool, userId, tenantId, generateToken())
  return shapeFeed(row)
}

export async function revokeFeed(pool, userId, tenantId) {
  await deleteToken(pool, userId, tenantId)
}

const notFound = { error: { status: 404, body: { error: 'Not found' } } }

function venueHeadline(v) {
  return v?.name || ''
}

function venueCity(v) {
  return v?.city || ''
}

function gigEvent(gig, base) {
  const calVenue = gig.venue ?? gig.festival
  const summary = [gig.event_description, venueHeadline(calVenue)].filter(Boolean).join(' @ ') || 'Gig'
  const desc = [gig.status, venueCity(calVenue)].filter(Boolean).join(', ')
  const url = `${base}/gigs?open=${gig.id}`
  const location = [venueHeadline(calVenue), venueCity(calVenue)].filter(Boolean).join(', ')
  return {
    uid: `gigbuddy-gig-${gig.id}@gigbuddy`,
    summary: 'Gig: ' + summary,
    description: [desc, `Open in GigBuddy: ${url}`].filter(Boolean).join('\n'),
    location: location || undefined,
    url,
    startDate: gig.event_date,
    startTime: gig.start_time,
    endTime: gig.end_time,
  }
}

function rehearsalEvent(reh, base) {
  const yes = reh.participants?.filter((p) => p.vote === 'yes').length ?? 0
  const total = reh.participants?.length ?? 0
  const desc = [reh.location, `${yes}/${total} yes`, reh.notes].filter(Boolean).join(' — ')
  const url = `${base}/rehearsals?open=${reh.id}`
  return {
    uid: `gigbuddy-rehearsal-${reh.id}@gigbuddy`,
    summary: `Rehearsal${reh.status ? ` (${reh.status})` : ''}`,
    description: [desc, `Open in GigBuddy: ${url}`].filter(Boolean).join('\n'),
    location: reh.location || undefined,
    url,
    startDate: reh.proposed_date,
    startTime: reh.start_time,
    endTime: reh.end_time,
  }
}

function bandEvent(ev, base) {
  const url = `${base}/events?open=${ev.id}`
  return {
    uid: `gigbuddy-bandevent-${ev.id}@gigbuddy`,
    summary: ev.title || 'Band Event',
    description: [ev.notes, `Open in GigBuddy: ${url}`].filter(Boolean).join('\n'),
    location: ev.location || undefined,
    url,
    startDate: ev.start_date,
    startTime: ev.start_time,
    endTime: ev.end_time,
    endDate: ev.end_date,
  }
}

// Validates the token and returns { ics } or { error } (always 404 on any
// failure so token validity isn't leaked). Access is revoked the moment the
// user/membership is no longer approved or the tenant is archived.
export async function buildFeed(pool, token) {
  const ctx = await resolveToken(pool, token)
  if (!ctx) return notFound
  if (ctx.user_status !== 'approved') return notFound
  if (ctx.membership_status !== 'approved') return notFound
  if (ctx.tenant_archived_at) return notFound

  const tenantId = ctx.tenant_id
  const base = appBase()

  const [gigs, rehearsals, bandEvents] = await Promise.all([
    listGigsWithTaskCounts(pool, tenantId),
    listRehearsals(pool, tenantId),
    listBandEvents(pool, tenantId),
  ])

  const byRehearsal = await loadParticipants(pool, rehearsals.map((r) => r.id), tenantId)
  const rehearsalsWithVotes = rehearsals.map((r) => ({ ...r, participants: byRehearsal.get(r.id) || [] }))

  const events = [
    ...gigs.map((g) => gigEvent(g, base)),
    ...rehearsalsWithVotes.map((r) => rehearsalEvent(r, base)),
    ...bandEvents.map((e) => bandEvent(e, base)),
  ]

  const ics = buildIcsCalendar(events, { prodId: PROD_ID, calName: ctx.band_name || undefined })

  await touchToken(pool, token)
  return { ics }
}
