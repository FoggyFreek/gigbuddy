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
//
// A list feed summarizes ONE matrix once per row, so the matrix is normalized
// and indexed a single time (prepareMatrix) and every row reuses that index.
// Passing a raw matrix still works and simply prepares it on the way in.
import { toDateStr } from '../utils/dateOnly.js'

export const STATUS_AVAILABLE = 'available'
export const STATUS_TRAVEL_MARGIN = 'travel_margin'

const SEVERITY = { unavailable: 2, [STATUS_TRAVEL_MARGIN]: 1, available: 0 }

const DAY_MS = 86400000
const CALCULATION_FALLBACK_START_TIME = '06:00'

// A band event's end_date is user input, so a typo ('3099-01-01') must not turn
// into a million-entry day array. A year of detail is far past useful.
export const MAX_SPAN_DAYS = 366

// How far beyond its own span a booking can still reach. The travel margin is
// capped at 24h by the schema, and an event can start no earlier than 00:00, so
// a booking one clear day away is exactly at the boundary and never conflicts.
const BOOKING_REACH_DAYS = 1

// Bookings longer than this are kept in a small always-checked list rather than
// written into every day of the index. Multi-week events are rare; a stray
// decade-long one must not blow up the index.
const MAX_INDEXED_BOOKING_DAYS = 31

const AVAILABLE_ENTRY = { status: STATUS_AVAILABLE, reason: null, source: 'default' }
const NO_BOOKINGS = []

const PREPARED = Symbol('preparedAvailabilityMatrix')

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

function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + (days * DAY_MS)).toISOString().slice(0, 10)
}

function normalizeSlot(raw) {
  const start = toDateStr(raw.start_date)
  if (!start) return null
  const end = toDateStr(raw.end_date)
  return {
    band_member_id: raw.band_member_id ?? null,
    start,
    end: end && end >= start ? end : start,
    status: raw.status,
    reason: raw.reason ?? null,
    source: raw.source ?? 'slot',
    bookingType: raw.bookingType ?? raw.booking_type ?? null,
    sourceId: raw.source_id ?? null,
    startTime: raw.start_time ?? null,
    endTime: raw.end_time ?? null,
    travelMarginHours: Number(raw.travel_margin_hours ?? 2),
    // Filled in lazily by bookingIntervals — the same booking is tested against
    // many days and many members, and its own intervals never change.
    intervals: null,
  }
}

function pushInto(map, key, value) {
  const existing = map.get(key)
  if (existing) existing.push(value)
  else map.set(key, [value])
}

function bookingBucket(bookingsByMember, memberId) {
  let bucket = bookingsByMember.get(memberId)
  if (!bucket) {
    bucket = { byDate: new Map(), long: [] }
    bookingsByMember.set(memberId, bucket)
  }
  return bucket
}

function indexBooking(bookingsByMember, booking) {
  const bucket = bookingBucket(bookingsByMember, booking.band_member_id)
  const days = eachDay(
    shiftDate(booking.start, -BOOKING_REACH_DAYS),
    shiftDate(booking.end, BOOKING_REACH_DAYS),
  )
  if (days.length > MAX_INDEXED_BOOKING_DAYS) {
    bucket.long.push(booking)
    return
  }
  for (const date of days) pushInto(bucket.byDate, date, booking)
}

/**
 * Normalize and index a matrix so it can be summarized many times cheaply.
 * @param matrix { members, slots } — band members and the redacted slot union.
 */
export function prepareMatrix({ members = [], slots = [] }) {
  const index = {
    bandWide: [],
    explicitByMember: new Map(),
    bookingsByMember: new Map(),
  }

  for (const raw of slots) {
    const slot = normalizeSlot(raw)
    if (!slot) continue
    if (slot.source === 'booking') indexBooking(index.bookingsByMember, slot)
    else if (slot.band_member_id === null) index.bandWide.push(slot)
    else pushInto(index.explicitByMember, slot.band_member_id, slot)
  }

  return { [PREPARED]: true, members, index }
}

/** The same prepared index, evaluated for a subset of members (e.g. an event's participants). */
export function withMembers(prepared, members) {
  return { ...prepared, members }
}

function dayMinute(date, time = '00:00') {
  const day = Date.parse(`${date}T00:00:00Z`) / 60000
  const [hours, minutes] = String(time).slice(0, 5).split(':').map(Number)
  return day + (hours * 60) + minutes
}

// An untimed event is treated as occupying the working day, so a date-only
// booking still conflicts with a date-only event.
function intervals(start, end, startTime, endTime) {
  if (startTime && endTime) {
    const timed = { start: dayMinute(start, startTime), end: dayMinute(end, endTime) }
    if (timed.end > timed.start) return [timed]
  }
  return eachDay(start, end).map((date) => ({
    start: dayMinute(date, CALCULATION_FALLBACK_START_TIME),
    end: dayMinute(date) + 1440,
  }))
}

function bookingIntervals(booking) {
  booking.intervals ??= intervals(booking.start, booking.end, booking.startTime, booking.endTime)
  return booking.intervals
}

function conflictStatus(wanted, exclude, booking) {
  if (exclude
      && exclude.type === booking.bookingType
      && Number(exclude.id) === Number(booking.sourceId)) return null

  const occupied = bookingIntervals(booking)
  let smallestGap = Number.POSITIVE_INFINITY
  for (const a of wanted) {
    for (const b of occupied) {
      if (a.start < b.end && b.start < a.end) return 'unavailable'
      const gap = a.end <= b.start ? b.start - a.end : a.start - b.end
      if (gap < smallestGap) smallestGap = gap
    }
  }
  return smallestGap < booking.travelMarginHours * 60 ? STATUS_TRAVEL_MARGIN : null
}

/** The last slot in source order that covers `date` — later entries win. */
function lastCovering(slots, date) {
  if (!slots) return null
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    if (slots[i].start <= date && slots[i].end >= date) return slots[i]
  }
  return null
}

function entryFor(slot, source) {
  return { status: slot.status, reason: slot.reason, source }
}

function escalate(entry, booking, wanted, exclude) {
  const status = conflictStatus(wanted, exclude, booking)
  if (!status) return entry
  if ((SEVERITY[status] ?? 0) <= (SEVERITY[entry.status] ?? 0)) return entry
  return { status, reason: booking.reason, source: 'booking' }
}

function memberEntry(member, date, index, bandWide, wanted, exclude) {
  let entry = AVAILABLE_ENTRY
  if (bandWide) {
    entry = entryFor(bandWide, 'band')
  } else {
    const own = lastCovering(index.explicitByMember.get(member.id), date)
    if (own) entry = entryFor(own, 'member')
  }

  const bucket = index.bookingsByMember.get(member.id)
  if (bucket) {
    for (const booking of bucket.byDate.get(date) ?? NO_BOOKINGS) {
      entry = escalate(entry, booking, wanted, exclude)
    }
    for (const booking of bucket.long) entry = escalate(entry, booking, wanted, exclude)
  }

  return { member_id: member.id, ...entry }
}

function summarizeDay(date, index, members, event) {
  const bandWide = lastCovering(index.bandWide, date)
  const dayStart = dayMinute(date)
  const dayEnd = dayStart + 1440
  const wanted = intervals(
    event.start_date ?? date,
    event.end_date ?? date,
    event.start_time,
    event.end_time,
  ).map((interval) => ({
    start: Math.max(interval.start, dayStart),
    end: Math.min(interval.end, dayEnd),
  })).filter((interval) => interval.end > interval.start)

  return {
    date,
    bandWide: bandWide ? { status: bandWide.status, reason: bandWide.reason } : null,
    members: members.map((member) => memberEntry(member, date, index, bandWide, wanted, event.exclude)),
  }
}

function worstOf(days, position) {
  let worst = null
  for (const day of days) {
    const entry = day.members[position]
    if (!worst || (SEVERITY[entry.status] ?? 0) > (SEVERITY[worst.status] ?? 0)) worst = entry
  }
  return worst ?? { member_id: null, ...AVAILABLE_ENTRY }
}

/**
 * @param matrix a prepared matrix (prepareMatrix) or a raw { members, slots }.
 * @returns { members, days } — `members` carries the worst-day summary per
 *   member (the shape list rows render); `days` the per-day breakdown.
 */
export function summarizeSpan(matrix, from, to, event = null) {
  const { members, index } = matrix[PREPARED] ? matrix : prepareMatrix(matrix)
  const days = eachDay(from, to).map((date) => summarizeDay(date, index, members, event ?? {}))

  return {
    members: members.map((member, position) => {
      const worst = worstOf(days, position)
      return {
        member_id: member.id,
        name: member.name,
        color: member.color,
        role: member.role,
        position: member.position,
        status: worst.status,
        reason: worst.reason,
        source: worst.source,
      }
    }),
    days,
  }
}
