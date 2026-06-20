// Authoritative iCalendar (RFC 5545) serializer shared by the server and the
// frontend. Pure ESM — no DOM, no Node APIs — so both runtimes can import it
// (the frontend month export in src/utils/shareUtils.ts and the server calendar
// feed in server/services/calendarFeedService.js).
//
// The seam: this module owns serialization only (escaping, line folding, date /
// time formatting, the VCALENDAR/VEVENT structure). Each caller maps its own
// domain objects into the normalized `IcsEvent` shape below; descriptions,
// summaries and deep-link URLs are built caller-side.
//
// IcsEvent: {
//   uid:         string                 // globally stable, e.g. "gigbuddy-gig-12@gigbuddy"
//   summary:     string
//   description?: string
//   location?:   string
//   url?:        string
//   startDate:   string                 // "YYYY-MM-DD"
//   startTime?:  string | null          // "HH:MM" / "HH:MM:SS"; absent => all-day
//   endDate?:    string | null          // "YYYY-MM-DD"; defaults to startDate
//   endTime?:    string | null          // defaults to startTime when timed
// }

function icsDateUTC(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
}

export function escapeICS(text) {
  return String(text)
    .replaceAll('\\', '\\\\')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;')
    .replaceAll('\n', '\\n')
}

// Fold lines longer than 75 octets per RFC 5545: a continuation line starts with
// a single space. Works on byte length so multi-byte characters never split a
// line over the limit.
export function foldICSLine(line) {
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
  const byteLen = (s) => (encoder ? encoder.encode(s).length : s.length)
  if (byteLen(line) <= 75) return line
  let result = ''
  let lineBytes = 0
  let first = true
  for (const char of line) {
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
  return isoStr.replaceAll('-', '')
}

function timeToICS(timeStr) {
  // "HH:MM:SS" or "HH:MM" -> "HHMMSS"
  return timeStr.replaceAll(':', '').slice(0, 6).padEnd(6, '0')
}

// Pushes DTSTART/DTEND for one event. A timed event uses TZID=Europe/Amsterdam
// (the app stores naive local DATE/TIME); an all-day event uses VALUE=DATE with
// an exclusive DTEND (end_date + 1 day) as the iCalendar spec requires.
function pushDtStartEnd(lines, isoDate, startTime, endTime, endIsoDate) {
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

/**
 * @typedef {object} IcsEvent
 * @property {string} uid
 * @property {string} summary
 * @property {string} [description]
 * @property {string} [location]
 * @property {string} [url]
 * @property {string} startDate
 * @property {string | null} [startTime]
 * @property {string | null} [endDate]
 * @property {string | null} [endTime]
 */

// Builds a complete VCALENDAR string from normalized events. `meta.calName`,
// when provided, is emitted as X-WR-CALNAME (escaped/folded like any text value);
// omit it for no calendar name. Lines use CRLF endings per the spec.
/**
 * @param {IcsEvent[]} events
 * @param {{ prodId?: string, calName?: string }} [meta]
 * @returns {string}
 */
export function buildIcsCalendar(events, { prodId = '-//GigBuddy//EN', calName } = {}) {
  const dtstamp = icsDateUTC(new Date())

  const out = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  if (calName) out.push(`X-WR-CALNAME:${escapeICS(calName)}`)

  for (const ev of events) {
    out.push('BEGIN:VEVENT')
    pushDtStartEnd(out, ev.startDate, ev.startTime, ev.endTime, ev.endDate)
    out.push(`DTSTAMP:${dtstamp}`, `SUMMARY:${escapeICS(ev.summary)}`)
    if (ev.description) out.push(`DESCRIPTION:${escapeICS(ev.description)}`)
    if (ev.location) out.push(`LOCATION:${escapeICS(ev.location)}`)
    if (ev.url) out.push(`URL:${ev.url}`)
    out.push(`UID:${ev.uid}`, 'END:VEVENT')
  }

  out.push('END:VCALENDAR')
  return out.map(foldICSLine).join('\r\n')
}
