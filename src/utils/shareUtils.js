import { normalizeIsoDate } from './availabilityUtils.js'

const APP_URL = window.location.origin

function formatDate(val) {
  if (!val) return '?'
  return new Date(val).toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatTime(val) {
  if (!val) return null
  return String(val).slice(0, 5)
}

function buildWhatsAppUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export function gigShareUrl(gig) {
  const deepLink = `${APP_URL}/gigs?open=${gig.id}`
  const start = formatTime(gig.start_time)
  const end = formatTime(gig.end_time)
  const timeStr = start ? (end ? `${start} – ${end}` : start) : null
  const venueLine = [gig.venue, gig.city].filter(Boolean).join(', ')

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

function icsDateUTC(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
}

function escapeICS(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
}

function foldICSLine(line) {
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
  const byteLen = (s) => (encoder ? encoder.encode(s).length : s.length)
  if (byteLen(line) <= 75) return line
  let result = ''
  let lineBytes = 0
  let first = true
  for (const char of [...line]) {
    const cb = byteLen(char)
    const limit = first ? 75 : 74
    if (lineBytes + cb > limit) {
      result += '\r\n '
      lineBytes = 1
      first = false
    }
    result += char
    lineBytes += cb
  }
  return result
}

function isoToICSDate(isoStr) {
  return isoStr.replace(/-/g, '')
}

function timeToICS(timeStr) {
  // "HH:MM:SS" or "HH:MM" → "HHMMSS"
  return timeStr.replace(/:/g, '').slice(0, 6).padEnd(6, '0')
}

function dtStartEnd(lines, isoDate, startTime, endTime, endIsoDate) {
  if (startTime) {
    lines.push(`DTSTART;TZID=Europe/Amsterdam:${isoToICSDate(isoDate)}T${timeToICS(startTime)}`)
    const endT = endTime || startTime
    const endD = endIsoDate || isoDate
    lines.push(`DTEND;TZID=Europe/Amsterdam:${isoToICSDate(endD)}T${timeToICS(endT)}`)
  } else {
    lines.push(`DTSTART;VALUE=DATE:${isoToICSDate(isoDate)}`)
    const afterEnd = new Date((endIsoDate || isoDate) + 'T00:00:00')
    afterEnd.setDate(afterEnd.getDate() + 1)
    const p = (n) => String(n).padStart(2, '0')
    lines.push(`DTEND;VALUE=DATE:${afterEnd.getFullYear()}${p(afterEnd.getMonth() + 1)}${p(afterEnd.getDate())}`)
  }
}

export function exportMonthToICS(gigs, rehearsals, bandEvents, year, month) {
  const p = (n) => String(n).padStart(2, '0')
  const monthStr = `${year}-${p(month)}`
  const monthStart = `${monthStr}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = `${monthStr}-${p(lastDay)}`
  const dtstamp = icsDateUTC(new Date())

  const out = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GigBuddy//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const gig of gigs) {
    const d = normalizeIsoDate(gig.event_date)
    if (!d || d < monthStart || d > monthEnd) continue
    const summary = [gig.event_description, gig.venue].filter(Boolean).join(' @ ') || 'Gig'
    const desc = [gig.status, gig.city].filter(Boolean).join(', ')
    out.push('BEGIN:VEVENT')
    dtStartEnd(out, d, gig.start_time, gig.end_time, null)
    out.push(`DTSTAMP:${dtstamp}`)
    out.push(`SUMMARY:${escapeICS('Gig: ' + summary)}`)
    const gigUrl = `${APP_URL}/gigs?open=${gig.id}`
    const gigDesc = [desc, `Open in GigBuddy: ${gigUrl}`].filter(Boolean).join('\n')
    out.push(`DESCRIPTION:${escapeICS(gigDesc)}`)
    const location = [gig.venue, gig.city].filter(Boolean).join(', ')
    if (location) out.push(`LOCATION:${escapeICS(location)}`)
    out.push(`URL:${gigUrl}`)
    out.push(`UID:gigbuddy-gig-${gig.id}@gigbuddy`)
    out.push('END:VEVENT')
  }

  for (const reh of rehearsals) {
    const d = normalizeIsoDate(reh.proposed_date)
    if (!d || d < monthStart || d > monthEnd) continue
    const yes = reh.participants?.filter((q) => q.vote === 'yes').length ?? 0
    const total = reh.participants?.length ?? 0
    const desc = [reh.location, `${yes}/${total} yes`, reh.notes].filter(Boolean).join(' — ')
    out.push('BEGIN:VEVENT')
    dtStartEnd(out, d, reh.start_time, reh.end_time, null)
    out.push(`DTSTAMP:${dtstamp}`)
    out.push(`SUMMARY:${escapeICS('Rehearsal' + (reh.status ? ` (${reh.status})` : ''))}`)
    const rehUrl = `${APP_URL}/rehearsals?open=${reh.id}`
    const rehDesc = [desc, `Open in GigBuddy: ${rehUrl}`].filter(Boolean).join('\n')
    out.push(`DESCRIPTION:${escapeICS(rehDesc)}`)
    if (reh.location) out.push(`LOCATION:${escapeICS(reh.location)}`)
    out.push(`URL:${rehUrl}`)
    out.push(`UID:gigbuddy-rehearsal-${reh.id}@gigbuddy`)
    out.push('END:VEVENT')
  }

  for (const ev of bandEvents) {
    const start = normalizeIsoDate(ev.start_date)
    const end = normalizeIsoDate(ev.end_date) || start
    if (!start || end < monthStart || start > monthEnd) continue
    out.push('BEGIN:VEVENT')
    dtStartEnd(out, start, ev.start_time, ev.end_time, end)
    out.push(`DTSTAMP:${dtstamp}`)
    out.push(`SUMMARY:${escapeICS(ev.title || 'Band Event')}`)
    const evUrl = `${APP_URL}/events?open=${ev.id}`
    const evDesc = [ev.notes, `Open in GigBuddy: ${evUrl}`].filter(Boolean).join('\n')
    out.push(`DESCRIPTION:${escapeICS(evDesc)}`)
    if (ev.location) out.push(`LOCATION:${escapeICS(ev.location)}`)
    out.push(`URL:${evUrl}`)
    out.push(`UID:gigbuddy-bandevent-${ev.id}@gigbuddy`)
    out.push('END:VEVENT')
  }

  out.push('END:VCALENDAR')
  const icsContent = out.map(foldICSLine).join('\r\n')

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gigbuddy-${year}-${p(month)}.ics`
  a.click()
  URL.revokeObjectURL(url)
}

export function rehearsalShareUrl(rehearsal) {
  const deepLink = `${APP_URL}/rehearsals?open=${rehearsal.id}`
  const start = formatTime(rehearsal.start_time)
  const end = formatTime(rehearsal.end_time)
  const timeStr = start ? (end ? `${start} – ${end}` : start) : null

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

export function bandEventShareUrl(event) {
  const deepLink = `${APP_URL}/events?open=${event.id}`
  const startDate = formatDate(event.start_date)
  const endDate = event.end_date && event.end_date !== event.start_date
    ? formatDate(event.end_date)
    : null
  const dateStr = endDate ? `${startDate} – ${endDate}` : startDate
  const startTime = formatTime(event.start_time)
  const endTime = formatTime(event.end_time)
  const timeStr = startTime ? (endTime ? `${startTime} – ${endTime}` : startTime) : null

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
