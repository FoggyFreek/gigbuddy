import type { Gig, Rehearsal, BandEvent } from '../types/entities.ts'
import { normalizeIsoDate } from './availabilityUtils.ts'
import { venueHeadline, venueCity } from './venueDisplay.ts'
import { buildIcsCalendar } from '../../shared/ics.js'

const APP_URL = window.location.origin

function formatDate(val: string | Date | null | undefined): string {
  if (!val) return '?'
  return new Date(val).toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatTime(val: string | null | undefined): string | null {
  if (!val) return null
  return String(val).slice(0, 5)
}

function buildWhatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export function gigShareUrl(gig: Gig): string {
  const deepLink = `${APP_URL}/gigs?open=${gig.id}`
  const start = formatTime(gig.start_time)
  const end = formatTime(gig.end_time)
  let timeStr: string | null
  if (!start) {
    timeStr = null
  } else if (end) {
    timeStr = `${start} – ${end}`
  } else {
    timeStr = start
  }
  const displayVenue = gig.venue ?? gig.festival
  const venueLine = [venueHeadline(displayVenue), venueCity(displayVenue)].filter(Boolean).join(', ')

  const lines = [
    `*Gig*`,
    `${formatDate(gig.event_date)}`,
    gig.event_description ? `${gig.event_description}` : null,
    timeStr ? `Time: ${timeStr}` : null,
    venueLine ? `Venue: ${venueLine}` : null,
    gig.status ? `Status: ${gig.status}` : null,
    ``,
    `Open in gigBuddy: ${deepLink}`,
  ].filter((l) => l !== null)

  return buildWhatsAppUrl(lines.join('\n'))
}

// --- ICS calendar export ---
//
// Serialization (escaping, line folding, date/time, VCALENDAR/VEVENT) lives in
// shared/ics.js so the server calendar feed produces identical output. Here we
// only filter to the chosen month, map to the normalized IcsEvent shape, and
// trigger the browser download.

interface IcsEvent {
  uid: string
  summary: string
  description?: string
  location?: string
  url?: string
  startDate: string
  startTime?: string | null
  endDate?: string | null
  endTime?: string | null
}

// Rehearsal has optional extra fields used for ICS (start_time, end_time, notes)
interface RehearsalWithTimes extends Rehearsal {
  start_time?: string
  end_time?: string
  notes?: string
}

// BandEvent has optional extra fields used for ICS
interface BandEventWithTimes extends BandEvent {
  start_time?: string
  end_time?: string
  notes?: string
}

export function exportMonthToICS(
  gigs: Gig[],
  rehearsals: RehearsalWithTimes[],
  bandEvents: BandEventWithTimes[],
  year: number,
  month: number,
  calName?: string,
): void {
  const p = (n: number) => String(n).padStart(2, '0')
  const monthStr = `${year}-${p(month)}`
  const monthStart = `${monthStr}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${monthStr}-${p(lastDay)}`

  const events: IcsEvent[] = []

  for (const gig of gigs) {
    const d = normalizeIsoDate(gig.event_date as string | undefined)
    if (!d || d < monthStart || d > monthEnd) continue
    const calVenue = gig.venue ?? gig.festival
    const summary = [gig.event_description, venueHeadline(calVenue)].filter(Boolean).join(' @ ') || 'Gig'
    const desc = [gig.status, venueCity(calVenue)].filter(Boolean).join(', ')
    const gigUrl = `${APP_URL}/gigs?open=${gig.id}`
    const location = [venueHeadline(calVenue), venueCity(calVenue)].filter(Boolean).join(', ')
    events.push({
      uid: `gigbuddy-gig-${gig.id}@gigbuddy`,
      summary: 'Gig: ' + summary,
      description: [desc, `Open in GigBuddy: ${gigUrl}`].filter(Boolean).join('\n'),
      location: location || undefined,
      url: gigUrl,
      startDate: d,
      startTime: gig.start_time,
      endTime: gig.end_time,
    })
  }

  for (const reh of rehearsals) {
    const d = normalizeIsoDate(reh.proposed_date)
    if (!d || d < monthStart || d > monthEnd) continue
    const yes = reh.participants?.filter((q) => q.vote === 'yes').length ?? 0
    const total = reh.participants?.length ?? 0
    const desc = [reh.location, `${yes}/${total} yes`, reh.notes].filter(Boolean).join(' — ')
    const rehUrl = `${APP_URL}/rehearsals?open=${reh.id}`
    const statusSuffix = reh.status ? ` (${reh.status})` : ''
    events.push({
      uid: `gigbuddy-rehearsal-${reh.id}@gigbuddy`,
      summary: `Rehearsal${statusSuffix}`,
      description: [desc, `Open in GigBuddy: ${rehUrl}`].filter(Boolean).join('\n'),
      location: reh.location || undefined,
      url: rehUrl,
      startDate: d,
      startTime: reh.start_time,
      endTime: reh.end_time,
    })
  }

  for (const ev of bandEvents) {
    const start = normalizeIsoDate(ev.start_date)
    const end = normalizeIsoDate(ev.end_date) || start
    if (!start || end < monthStart || start > monthEnd) continue
    const evUrl = `${APP_URL}/events?open=${ev.id}`
    events.push({
      uid: `gigbuddy-bandevent-${ev.id}@gigbuddy`,
      summary: ev.title || 'Band Event',
      description: [ev.notes, `Open in GigBuddy: ${evUrl}`].filter(Boolean).join('\n'),
      location: ev.location || undefined,
      url: evUrl,
      startDate: start,
      startTime: ev.start_time,
      endTime: ev.end_time,
      endDate: end,
    })
  }

  const icsContent = buildIcsCalendar(events, { calName })

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gigbuddy-${year}-${p(month)}.ics`
  a.click()
  URL.revokeObjectURL(url)
}

export function rehearsalShareUrl(rehearsal: RehearsalWithTimes): string {
  const deepLink = `${APP_URL}/rehearsals?open=${rehearsal.id}`
  const start = formatTime(rehearsal.start_time)
  const end = formatTime(rehearsal.end_time)
  let timeStr: string | null
  if (!start) {
    timeStr = null
  } else if (end) {
    timeStr = `${start} – ${end}`
  } else {
    timeStr = start
  }

  const lines = [
    `*Rehearsal*`,
    `${formatDate(rehearsal.proposed_date)}`,
    timeStr ? `Time: ${timeStr}` : null,
    rehearsal.location ? `Venue: ${rehearsal.location}` : null,
    rehearsal.notes ? `Notes: ${rehearsal.notes}` : null,
    rehearsal.status ? `Status: ${rehearsal.status}` : null,
    ``,
    `Open in gigBuddy: ${deepLink}`,
  ].filter((l) => l !== null)

  return buildWhatsAppUrl(lines.join('\n'))
}

export function bandEventShareUrl(event: BandEventWithTimes): string {
  const deepLink = `${APP_URL}/events?open=${event.id}`
  const startDate = formatDate(event.start_date)
  const endDate = event.end_date && event.end_date !== event.start_date
    ? formatDate(event.end_date)
    : null
  const dateStr = endDate ? `${startDate} – ${endDate}` : startDate
  const startTime = formatTime(event.start_time)
  const endTime = formatTime(event.end_time)
  let timeStr: string | null
  if (!startTime) {
    timeStr = null
  } else if (endTime) {
    timeStr = `${startTime} – ${endTime}`
  } else {
    timeStr = startTime
  }

  const lines = [
    `*Band Event*`,
    event.title ? `${event.title}` : null,
    `Date: ${dateStr}`,
    timeStr ? `Time: ${timeStr}` : null,
    event.location ? `Venue: ${event.location}` : null,
    event.notes ? `Notes: ${event.notes}` : null,
    ``,
    `Open in gigBuddy: ${deepLink}`,
  ].filter((l) => l !== null)

  return buildWhatsAppUrl(lines.join('\n'))
}
