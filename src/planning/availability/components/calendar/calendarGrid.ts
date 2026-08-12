// Pure date/grid helpers and per-cell view-model construction for the
// availability calendar. No React or theme dependencies.
import { toIsoDate } from '../../availabilityUtils.ts'
import type { Slot, Gig, Rehearsal, BandEvent, CalendarCell } from '../../../../types/entities.ts'

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

interface CalendarSlotGroup {
  memberId: Slot['band_member_id']
  status: string
  details: string[]
  ids: NonNullable<Slot['id']>[]
  editableSlot: Slot | null
  bookingCount: number
}

interface SlotsForDay {
  explicitByMember: Map<string, Slot[]>
  bookings: Slot[]
}

function slotGroupKey(slot: Slot): string {
  return slot.band_member_id == null ? 'band' : String(slot.band_member_id)
}

function slotCoversDay(slot: Slot, date: string): boolean {
  const start = slot.start_date
  return Boolean(start && inRange(date, start, slot.end_date || start))
}

function collectSlotsForDay(slots: Slot[], date: string): SlotsForDay {
  const explicitByMember = new Map<string, Slot[]>()
  const bookings: Slot[] = []
  for (const slot of slots) {
    if (!slotCoversDay(slot, date)) continue
    if (slot.source === 'booking') {
      bookings.push(slot)
      continue
    }
    const key = slotGroupKey(slot)
    const entries = explicitByMember.get(key) ?? []
    entries.push(slot)
    explicitByMember.set(key, entries)
  }
  return { explicitByMember, bookings }
}

function normalizedSlotStatus(slot: Slot): string {
  return slot.status === 'unavailable' ? 'unavailable' : 'available'
}

function buildExplicitGroup(entries: Slot[]): CalendarSlotGroup {
  const status = entries.some((slot) => slot.status === 'unavailable') ? 'unavailable' : 'available'
  const editableSlot = entries.findLast((slot) => normalizedSlotStatus(slot) === status) ?? entries.at(-1)!
  return {
    memberId: entries[0].band_member_id ?? null,
    status,
    details: entries.flatMap((slot) => slot.reason ? [slot.reason] : []),
    ids: entries.flatMap((slot) => slot.id === undefined ? [] : [slot.id]),
    editableSlot,
    bookingCount: 0,
  }
}

function buildExplicitGroups(explicitByMember: Map<string, Slot[]>): Map<string, CalendarSlotGroup> {
  return new Map(
    [...explicitByMember].map(([key, entries]) => [key, buildExplicitGroup(entries)]),
  )
}

function bookingDetail(slot: Slot): string {
  return slot.description || slot.reason || slot.title || ''
}

function buildBookingGroup(slot: Slot): CalendarSlotGroup {
  const detail = bookingDetail(slot)
  return {
    memberId: slot.band_member_id ?? null,
    status: 'unavailable',
    details: detail ? [detail] : [],
    ids: slot.id === undefined ? [] : [slot.id],
    editableSlot: null,
    bookingCount: 1,
  }
}

function appendUnique<T>(items: T[], item: T | undefined): void {
  if (item !== undefined && !items.includes(item)) items.push(item)
}

function mergeBooking(groups: Map<string, CalendarSlotGroup>, slot: Slot): void {
  const key = slotGroupKey(slot)
  const current = groups.get(key)
  if (!current) {
    groups.set(key, buildBookingGroup(slot))
    return
  }
  current.bookingCount += 1
  current.status = 'unavailable'
  appendUnique(current.details, bookingDetail(slot) || undefined)
  appendUnique(current.ids, slot.id)
}

function toCalendarSummary(date: string, key: string, group: CalendarSlotGroup): Slot {
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
}

function summarizeSlotsForDay(slots: Slot[], date: string): Slot[] {
  const { explicitByMember, bookings } = collectSlotsForDay(slots, date)
  const groups = buildExplicitGroups(explicitByMember)
  for (const booking of bookings) mergeBooking(groups, booking)
  return [...groups].map(([key, group]) => toCalendarSummary(date, key, group))
}

/** One availability block per member/day for the month view. */
export function summarizeCalendarSlots(slots: Slot[], days: string[]): Record<string, Slot[]> {
  return Object.fromEntries(days.map((date) => [date, summarizeSlotsForDay(slots, date)]))
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
