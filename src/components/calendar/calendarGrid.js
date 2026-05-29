// Pure date/grid helpers and per-cell view-model construction for the
// availability calendar. No React or theme dependencies.
import { toIsoDate } from '../../utils/availabilityUtils.js'

export const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleString('en', { month: 'long' }),
)

export function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
}

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function inRange(dateStr, start, end) {
  return dateStr >= start && dateStr <= end
}

export function buildCalendarCells(year, month) {
  const firstOfMonth = new Date(year, month - 1, 1)
  // day-of-week Monday=0, Sunday=6
  let dow = firstOfMonth.getDay() - 1
  if (dow < 0) dow = 6
  const start = addDays(firstOfMonth, -dow)
  return Array.from({ length: 42 }, (_, i) => {
    const d = addDays(start, i)
    return { date: d, iso: toIsoDate(d), inMonth: d.getMonth() === month - 1 }
  })
}

// Groups single-date items (gigs, rehearsals) by their ISO date.
export function indexByDate(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item)
    if (!key) return acc
    acc[key] ||= []
    acc[key].push(item)
    return acc
  }, {})
}

// Buckets range items (slots, band events) into each visible cell date they
// cover. Computed once per render instead of filtering the full list per cell.
export function indexByDateRange(items, getStart, getEnd, cells) {
  const byDate = {}
  for (const c of cells) byDate[c.iso] = []
  for (const item of items) {
    const start = getStart(item)
    if (start == null) continue
    const end = getEnd(item)
    for (const c of cells) {
      if (inRange(c.iso, start, end)) byDate[c.iso].push(item)
    }
  }
  return byDate
}

export function getCalendarCellBackground({ mobile, isSelected, inMonth }) {
  if (mobile) return 'transparent'
  if (isSelected) return 'action.selected'
  if (!inMonth) return 'action.hover'
  return 'background.paper'
}

// Derives everything a cell needs to render from the indexed event lookups.
export function buildCalendarCellViewModel(cell, idx, ctx) {
  const { iso, date, inMonth } = cell
  const { slotsByDate, gigsByDate, rehearsalsByDate, bandEventsByDate, selectionStart, selectedDay, mobile, today } = ctx
  const isSelected = selectionStart === iso || (mobile && selectedDay === iso)
  const dow = date.getDay()
  return {
    iso,
    date,
    inMonth,
    isRowStart: idx % 7 === 0,
    week: getISOWeek(date),
    cellSlots: slotsByDate[iso] || [],
    cellGigs: gigsByDate[iso] || [],
    cellRehearsals: rehearsalsByDate[iso] || [],
    cellBandEvents: bandEventsByDate[iso] || [],
    isSelected,
    isToday: iso === today,
    isWeekend: dow === 0 || dow === 6,
    bgcolor: getCalendarCellBackground({ mobile, isSelected, inMonth }),
  }
}
