// Pure date/grid helpers and per-cell view-model construction for the
// availability calendar. No React or theme dependencies.
import { toIsoDate } from '../../utils/availabilityUtils.ts'
import type { Slot, Gig, Rehearsal, BandEvent, CalendarCell } from '../../types/entities.ts'

// Day/month names are formatted via Intl for the active locale rather than
// hardcoded English. 2024-01-01 is a Monday, so the 7-day walk yields the
// Monday-first short weekday headers the grid expects.
export function getDayHeaders(locale: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }),
  )
}

export function getMonthNames(locale: string): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleString(locale, { month: 'long' }),
  )
}

export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function inRange(dateStr: string, start: string, end: string): boolean {
  return dateStr >= start && dateStr <= end
}

interface CalendarCellBase {
  date: Date
  iso: string
  inMonth: boolean
}

export function buildCalendarCells(year: number, month: number): CalendarCellBase[] {
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
export function indexByDate<T>(
  items: T[],
  getKey: (item: T) => string | null | undefined,
): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = getKey(item)
    if (!key) return acc
    acc[key] ||= []
    acc[key].push(item)
    return acc
  }, {})
}

// Buckets range items (slots, band events) into each visible cell date they
// cover. Computed once per render instead of filtering the full list per cell.
export function indexByDateRange<T>(
  items: T[],
  getStart: (item: T) => string | null | undefined,
  getEnd: (item: T) => string | null | undefined,
  cells: CalendarCellBase[],
): Record<string, T[]> {
  const byDate: Record<string, T[]> = {}
  for (const c of cells) byDate[c.iso] = []
  for (const item of items) {
    const start = getStart(item)
    if (start == null) continue
    const end = getEnd(item) ?? start
    for (const c of cells) {
      if (inRange(c.iso, start, end)) byDate[c.iso].push(item)
    }
  }
  return byDate
}

const SLOT_SEVERITY: Record<string, number> = { available: 0, unavailable: 1 }

function bookingStatusOnDay(slot: Slot, date: string): 'unavailable' | null {
  const start = slot.start_date
  if (!start) return null
  const end = slot.end_date || start
  return inRange(date, start, end) ? 'unavailable' : null
}

/** One availability block per member/day for the month view. */
export function summarizeCalendarSlots(slots: Slot[], days: string[]): Record<string, Slot[]> {
  const result: Record<string, Slot[]> = Object.fromEntries(days.map((day) => [day, []]))
  for (const date of days) {
    const explicit = new Map<string, Slot[]>()
    const bookings: { slot: Slot; status: 'unavailable' }[] = []
    for (const slot of slots) {
      const key = slot.band_member_id == null ? 'band' : String(slot.band_member_id)
      if (slot.source === 'booking') {
        const status = bookingStatusOnDay(slot, date)
        if (status) bookings.push({ slot, status })
      } else if (slot.start_date && inRange(date, slot.start_date, slot.end_date || slot.start_date)) {
        const entries = explicit.get(key) ?? []
        entries.push(slot)
        explicit.set(key, entries)
      }
    }

    const groups = new Map<string, {
      memberId: Slot['band_member_id']
      status: string
      details: string[]
      ids: NonNullable<Slot['id']>[]
      editableSlot: Slot | null
      bookingCount: number
    }>()
    for (const [key, entries] of explicit) {
      const status = entries.some((slot) => slot.status === 'unavailable') ? 'unavailable' : 'available'
      const editableSlot = entries.findLast((slot) =>
        (slot.status === 'unavailable' ? 'unavailable' : 'available') === status) ?? entries.at(-1)!
      groups.set(key, {
        memberId: entries[0].band_member_id ?? null,
        status,
        details: entries.flatMap((slot) => slot.reason ? [slot.reason] : []),
        ids: entries.flatMap((slot) => slot.id === undefined ? [] : [slot.id]),
        editableSlot,
        bookingCount: 0,
      })
    }
    for (const { slot, status } of bookings) {
      const key = slot.band_member_id == null ? 'band' : String(slot.band_member_id)
      const current = groups.get(key)
      const detail = slot.description || slot.reason || slot.title || ''
      if (!current) {
        groups.set(key, {
          memberId: slot.band_member_id ?? null,
          status,
          details: detail ? [detail] : [],
          ids: slot.id === undefined ? [] : [slot.id],
          editableSlot: null,
          bookingCount: 1,
        })
      } else {
        current.bookingCount += 1
        if ((SLOT_SEVERITY[status] ?? 0) > (SLOT_SEVERITY[current.status] ?? 0)) current.status = status
        if (detail && !current.details.includes(detail)) current.details.push(detail)
        if (slot.id !== undefined && !current.ids.includes(slot.id)) current.ids.push(slot.id)
      }
    }

    result[date] = [...groups.entries()].map(([key, group]) => {
      if (group.editableSlot && group.bookingCount === 0) {
        return { ...group.editableSlot, status: group.status, calendar_summary: true }
      }
      return {
        id: group.ids.length === 1 ? group.ids[0] : `summary-${date}-${key}`,
        source: 'summary',
        band_member_id: group.memberId,
        start_date: date,
        end_date: date,
        status: group.status,
        description: group.details.join(' — ') || null,
        calendar_summary: true,
      }
    })
  }
  return result
}

interface CellBgArgs {
  mobile: boolean
  isSelected: boolean
  inMonth: boolean
}

export function getCalendarCellBackground({ mobile, isSelected, inMonth }: CellBgArgs): string {
  if (mobile) return 'transparent'
  if (isSelected) return 'action.selected'
  if (!inMonth) return 'action.hover'
  return 'background.paper'
}

interface CalendarContext {
  slotsByDate: Record<string, Slot[]>
  gigsByDate: Record<string, Gig[]>
  rehearsalsByDate: Record<string, Rehearsal[]>
  bandEventsByDate: Record<string, BandEvent[]>
  selectionStart: string | null
  selectedDay: string | null
  mobile: boolean
  today: string
}

// Derives everything a cell needs to render from the indexed event lookups.
export function buildCalendarCellViewModel(
  cell: CalendarCellBase,
  idx: number,
  ctx: CalendarContext,
): CalendarCell {
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
