export function formatShortDate(value: string | Date | null | undefined, locale = 'nl-NL'): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
}

// Whole-day distance from `today` to a 'YYYY-MM-DD' (or ISO) date, using UTC
// midnights so DST/time-of-day never shift the count. Negative = past (overdue),
// 0 = today. null when the date is missing or unparseable.
export function daysUntil(value: string | null | undefined, today = new Date()): number | null {
  if (!value) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  const dueUtc = Date.UTC(year, month - 1, day)
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((dueUtc - todayUtc) / 86_400_000)
}

// Compact relative timestamp for feeds ("5 minutes ago", "yesterday"); falls
// back to an absolute short date beyond a week. Localized via Intl.
export function formatRelativeTime(value: string | Date, locale: string, now = new Date()): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const minutes = Math.round((d.getTime() - now.getTime()) / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return rtf.format(days, 'day')
  return formatShortDate(d, locale)
}

// A due date as a relative label ("today"/"tomorrow"/"in 3 days") when it lands
// within the coming week, otherwise an absolute short date. Localized via Intl.
export function formatDueDate(date: string, locale: string): string {
  const days = daysUntil(date)
  if (days != null && days >= 0 && days < 7) {
    const numeric = days <= 1 ? 'auto' : 'always'
    return new Intl.RelativeTimeFormat(locale, { numeric }).format(days, 'day')
  }
  return formatShortDate(date)
}
