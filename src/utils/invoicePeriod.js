// Returns true when the invoice's issue_date falls inside the given period.
// Invoices without an issue_date are always excluded.
export function invoiceInPeriod(inv, period) {
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
      // Parse dates at noon local to avoid UTC-midnight timezone edge cases.
      const from = new Date(period.from + 'T00:00:00')
      const to = new Date(period.to + 'T23:59:59')
      const date = new Date(inv.issue_date + 'T12:00:00')
      return date >= from && date <= to
    }
    default:
      return false
  }
}

// Returns the human-readable label shown on the picker trigger button.
export function periodLabel(period) {
  switch (period.mode) {
    case 'fiscal_year':
      return `FY ${period.year}`
    case 'month': {
      const d = new Date(period.year, period.month, 1)
      return d.toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' })
    }
    case 'quarter':
      return `Q${period.quarter} ${period.year}`
    case 'all_time':
      return 'All Time'
    case 'custom': {
      const fmt = (s) =>
        new Date(s + 'T12:00:00').toLocaleDateString('nl-NL', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      return `${fmt(period.from)} – ${fmt(period.to)}`
    }
    default:
      return 'Period'
  }
}

// Returns the appropriate default period given a list of invoices:
// defaults to the current fiscal year; if it has no invoices, falls back to
// the most recent year that does.
export function defaultPeriod(invoices) {
  const currentYear = new Date().getFullYear()
  const years = invoices
    .filter((inv) => inv.issue_date)
    .map((inv) => new Date(inv.issue_date).getFullYear())
  if (!years.length || years.includes(currentYear)) {
    return { mode: 'fiscal_year', year: currentYear }
  }
  return { mode: 'fiscal_year', year: Math.max(...years) }
}
