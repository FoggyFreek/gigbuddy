// How a band reads its members' availability over a span of days.
//
// The rules, in one place, so the single-date read (/availability/on/:date) and
// the multi-day reads (band events, gigs) can never drift apart:
//
//   per day    — a band-wide slot beats a member's own slot, which beats
//                'default' (nothing recorded). Later slots win over earlier
//                ones, so an amended slot supersedes the one it replaces.
//   per span   — the WORST day decides. 'unavailable' outranks a day nobody
//                said anything about, which outranks 'available': a member who
//                is free on Monday but unknown on Tuesday reads as unknown, not
//                as free.
//
// Pure: no I/O. It takes the matrix produced by
// availabilityService.loadAvailabilityMatrix — already redacted per viewer, so
// a reason the viewer may not see never reaches this file.
import { toDateStr } from '../utils/dateOnly.js'

/** Nothing recorded for this member on this day. */
export const STATUS_UNKNOWN = 'default'

const SEVERITY = { unavailable: 2, [STATUS_UNKNOWN]: 1, available: 0 }

const DAY_MS = 86400000

// A band event's end_date is user input, so a typo ('3099-01-01') must not turn
// into a million-entry day array. A year of detail is far past useful.
export const MAX_SPAN_DAYS = 366

const UNKNOWN_ENTRY = { status: STATUS_UNKNOWN, reason: null, source: 'default' }

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
      }
    })
    .filter((s) => s.start)
}

function entryFor(slot, source) {
  return { status: slot.status, reason: slot.reason, source }
}

function summarizeDay(date, slots, members) {
  const covering = slots.filter((s) => s.start <= date && s.end >= date)
  const bandWide = covering.findLast((s) => s.band_member_id === null) ?? null

  return {
    date,
    bandWide: bandWide ? { status: bandWide.status, reason: bandWide.reason } : null,
    members: members.map((m) => {
      const own = covering.findLast((s) => s.band_member_id === m.id)
      let entry = UNKNOWN_ENTRY
      if (bandWide) entry = entryFor(bandWide, 'band')
      else if (own) entry = entryFor(own, 'member')
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
  return worst ?? { member_id: null, ...UNKNOWN_ENTRY }
}

/**
 * @param matrix { members, slots } — band members and the redacted slot union.
 * @returns { members, days } — `members` carries the worst-day summary per
 *   member (the shape list rows render); `days` the per-day breakdown.
 */
export function summarizeSpan({ members = [], slots = [] }, from, to) {
  const normalized = normalizeSlots(slots)
  const days = eachDay(from, to).map((date) => summarizeDay(date, normalized, members))

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
