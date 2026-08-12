// Inclusive calendar-month day window for windowed collection reads
// (`?from=&to=`). A true month, unlike the availability calendar's grid bounds
// which deliberately include the leading/trailing days of adjacent months.
export interface DayWindow {
  from: string
  to: string
}

const iso = (date: Date) => date.toISOString().slice(0, 10)

/** `month` is 1-based, matching the rest of the app's month handling. */
export function monthWindow(year: number, month: number): DayWindow {
  return {
    from: iso(new Date(Date.UTC(year, month - 1, 1))),
    // Day 0 of the next month is the last day of this one.
    to: iso(new Date(Date.UTC(year, month, 0))),
  }
}

export function yearWindow(year: number): DayWindow {
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}
