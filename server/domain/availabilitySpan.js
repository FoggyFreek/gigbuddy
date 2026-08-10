// How a band reads its members' availability over a span of days.
//
// The rules, in one place, so the single-date read (/availability/on/:date) and
// the multi-day reads (band events, gigs) can never drift apart:
//
//   per day    — explicit unavailability or a booking overlap is red; a
//                booking inside the configured travel gap is orange; otherwise
//                the member is available. Band-wide slots override a member's
//                explicit slot, while bookings always remain conflicts.
//   per span   — the WORST day decides: unavailable, travel margin, available.
//
// Pure: no I/O. It takes the matrix produced by
// availabilityService.loadAvailabilityMatrix — already redacted per viewer, so
// a reason the viewer may not see never reaches this file.
import { toDateStr } from '../utils/dateOnly.js'

export const STATUS_AVAILABLE = 'available'
export const STATUS_TRAVEL_MARGIN = 'travel_margin'

const SEVERITY = { unavailable: 2, [STATUS_TRAVEL_MARGIN]: 1, available: 0 }

const DAY_MS = 86400000
const CALCULATION_FALLBACK_START_TIME = '06:00'

// A band event's end_date is user input, so a typo ('3099-01-01') must not turn
// into a million-entry day array. A year of detail is far past useful.
export const MAX_SPAN_DAYS = 366

const AVAILABLE_ENTRY = { status: STATUS_AVAILABLE, reason: null, source: 'default' }

/** Inclusive list of ISO days from `from` to `to`, capped at MAX_SPAN_DAYS. */
export function eachDay(from, to) {
  const start = toDateStr(from)
  if (!start) return []
  const startMs = Date.parse(`${start}T00:00:00Z`)
  if (Number.isNaN(startMs)) return []

  const end = toDateStr(to)
  const endMs = end ? Date.parse(`${end}T00:00:00Z`) : startMs
  const lastMs = Number.isNaN(endMs) || endMs < startMs ? startMs : endMs

  const days = []
  for (let ms = startMs; ms <= lastMs && days.length < MAX_SPAN_DAYS; ms += DAY_MS) {
    days.push(new Date(ms).toISOString().slice(0, 10))
  }
  return days
}

function normalizeSlots(slots) {
  return slots
    .map((s) => {
      const start = toDateStr(s.start_date)
      return {
        band_member_id: s.band_member_id ?? null,
        start,
        end: toDateStr(s.end_date) ?? start,
        status: s.status,
        reason: s.reason ?? null,
        source: s.source ?? 'slot',
        bookingType: s.bookingType ?? s.booking_type ?? null,
        sourceId: s.source_id ?? null,
        startTime: s.start_time ?? null,
        endTime: s.end_time ?? null,
        travelMarginHours: Number(s.travel_margin_hours ?? 2),
      }
    })
    .filter((s) => s.start)
}

function entryFor(slot, source) {
  return { status: slot.status, reason: slot.reason, source }
}

function dayMinute(date, time = '00:00') {
  const day = Date.parse(`${date}T00:00:00Z`) / 60000
  const [hours, minutes] = String(time).slice(0, 5).split(':').map(Number)
  return day + (hours * 60) + minutes
}

function intervalsFor(event) {
  const start = toDateStr(event?.start_date)
  if (!start) return []
  const end = toDateStr(event?.end_date) ?? start
  const timed = !!event.start_time && !!event.end_time && event.end_time > event.start_time
  return eachDay(start, end).map((date) => timed
    ? { start: dayMinute(date, event.start_time), end: dayMinute(date, event.end_time) }
    : { start: dayMinute(date, CALCULATION_FALLBACK_START_TIME), end: dayMinute(date) + 1440 })
}

function conflictStatus(candidate, booking) {
  if (candidate?.exclude
      && candidate.exclude.type === booking.bookingType
      && Number(candidate.exclude.id) === Number(booking.sourceId)) return null

  const wanted = intervalsFor(candidate)
  const occupied = intervalsFor({
    start_date: booking.start,
    end_date: booking.end,
    start_time: booking.startTime,
    end_time: booking.endTime,
  })
  let smallestGap = Number.POSITIVE_INFINITY
  for (const a of wanted) {
    for (const b of occupied) {
      if (a.start < b.end && b.start < a.end) return 'unavailable'
      const gap = a.end <= b.start ? b.start - a.end : a.start - b.end
      smallestGap = Math.min(smallestGap, gap)
    }
  }
  return smallestGap < booking.travelMarginHours * 60 ? STATUS_TRAVEL_MARGIN : null
}

function summarizeDay(date, slots, members, event) {
  const covering = slots.filter((s) => s.start <= date && s.end >= date)
  const explicit = covering.filter((s) => s.source !== 'booking')
  const bookings = slots.filter((s) => s.source === 'booking')
  const bandWide = explicit.findLast((s) => s.band_member_id === null) ?? null
  const dayEvent = { ...event, start_date: date, end_date: date }

  return {
    date,
    bandWide: bandWide ? { status: bandWide.status, reason: bandWide.reason } : null,
    members: members.map((m) => {
      const own = explicit.findLast((s) => s.band_member_id === m.id)
      let entry = AVAILABLE_ENTRY
      if (bandWide) entry = entryFor(bandWide, 'band')
      else if (own) entry = entryFor(own, 'member')
      for (const booking of bookings.filter((s) => s.band_member_id === m.id)) {
        const status = conflictStatus(dayEvent, booking)
        if (!status) continue
        const candidate = { status, reason: booking.reason, source: 'booking' }
        if ((SEVERITY[candidate.status] ?? 0) > (SEVERITY[entry.status] ?? 0)) entry = candidate
      }
      return { member_id: m.id, ...entry }
    }),
  }
}

function worstOf(days, index) {
  let worst = null
  for (const day of days) {
    const entry = day.members[index]
    if (!worst || (SEVERITY[entry.status] ?? 0) > (SEVERITY[worst.status] ?? 0)) worst = entry
  }
  return worst ?? { member_id: null, ...AVAILABLE_ENTRY }
}

/**
 * @param matrix { members, slots } — band members and the redacted slot union.
 * @returns { members, days } — `members` carries the worst-day summary per
 *   member (the shape list rows render); `days` the per-day breakdown.
 */
export function summarizeSpan({ members = [], slots = [] }, from, to, event = null) {
  const normalized = normalizeSlots(slots)
  const evaluatedEvent = event ?? { start_date: from, end_date: to }
  const days = eachDay(from, to).map((date) => summarizeDay(date, normalized, members, evaluatedEvent))

  return {
    members: members.map((m, index) => {
      const worst = worstOf(days, index)
      return {
        member_id: m.id,
        name: m.name,
        color: m.color,
        role: m.role,
        position: m.position,
        status: worst.status,
        reason: worst.reason,
        source: worst.source,
      }
    }),
    days,
  }
}
