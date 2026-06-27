export function formatShortDate(value: string | Date | null | undefined, locale = 'nl-NL'): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
}
