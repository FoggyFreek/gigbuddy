import type { Invoice, Period } from '../types/entities.ts'

// Returns true when the invoice's issue_date falls inside the given period.
// Invoices without an issue_date are always excluded.
export function invoiceInPeriod(inv: Invoice, period: Period): boolean {
  if (!inv.issue_date) return false
  const d = new Date(inv.issue_date)
  const y = d.getFullYear()
  const m = d.getMonth()
  switch (period.mode) {
    case 'fiscal_year':
      return y === period.year
    case 'month':
      return y === period.year && m === period.month
    case 'quarter':
      return y === period.year && Math.floor(m / 3) + 1 === period.quarter
    case 'all_time':
      return true
    case 'custom': {
      const from = new Date(`${period.from}T00:00:00`)
      const to = new Date(`${period.to}T23:59:59`)
      const date = new Date(`${inv.issue_date}T12:00:00`)
      return date >= from && date <= to
    }
    default:
      return false
  }
}

export function periodQueryString(period: Period | null | undefined): string {
  if (!period?.mode) return ''

  const params = new URLSearchParams({ mode: period.mode })
  if (period.year !== undefined) params.set('year', String(period.year))
  if (period.month !== undefined) params.set('month', String(period.month))
  if (period.quarter !== undefined) params.set('quarter', String(period.quarter))
  if (period.from) params.set('from', period.from)
  if (period.to) params.set('to', period.to)

  const query = params.toString()
  return query ? `?${query}` : ''
}

export function periodDatesFromRecords<T>(records: T[], dateField = 'issue_date'): string[] {
  return records.map((record) => (record as Record<string, unknown>)?.[dateField] as string).filter(Boolean)
}

// Returns the human-readable label shown on the picker trigger button.
export function periodLabel(period: Period): string {
  switch (period.mode) {
    case 'fiscal_year':
      return `FY ${period.year}`
    case 'month': {
      const d = new Date(period.year ?? 0, period.month ?? 0, 1)
      return d.toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' })
    }
    case 'quarter':
      return `Q${period.quarter} ${period.year}`
    case 'all_time':
      return 'All Time'
    case 'custom': {
      const fmt = (s: string) =>
        new Date(`${s}T12:00:00`).toLocaleDateString('nl-NL', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      return `${fmt(period.from ?? '')} - ${fmt(period.to ?? '')}`
    }
    default:
      return 'Period'
  }
}

export function defaultPeriodForDates(dates: string[]): Period {
  const currentYear = new Date().getFullYear()
  const years = dates
    .filter(Boolean)
    .map((date) => new Date(`${String(date).slice(0, 10)}T12:00:00`).getFullYear())
    .filter((year) => !Number.isNaN(year))
  if (!years.length || years.includes(currentYear)) {
    return { mode: 'fiscal_year', year: currentYear }
  }
  return { mode: 'fiscal_year', year: Math.max(...years) }
}

// Returns the appropriate default period given a list of invoices:
// defaults to the current fiscal year; if it has no invoices, falls back to
// the most recent year that does.
export function defaultPeriod(invoices: Invoice[]): Period {
  return defaultPeriodForDates(periodDatesFromRecords(invoices))
}
