const LOCALES = Object.freeze({ nl: 'nl-NL', en: 'en-GB' })

export function formatOutreachValue(value, format, { locale = 'nl', currency = 'EUR' } = {}) {
  if (value === null || value === undefined || value === '') return ''
  const intlLocale = LOCALES[locale] ?? LOCALES.nl
  if (format === 'money') {
    return new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(Number(value) / 100)
  }
  if (format === 'date') {
    const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(intlLocale, {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(date)
  }
  if (format === 'time') return String(value).slice(0, 5)
  if (format === 'percent') return new Intl.NumberFormat(intlLocale, { style: 'percent', maximumFractionDigits: 2 }).format(Number(value) / 100)
  if (format === 'number') return new Intl.NumberFormat(intlLocale).format(Number(value))
  if (format === 'boolean') return value ? (locale === 'nl' ? 'Ja' : 'Yes') : (locale === 'nl' ? 'Nee' : 'No')
  return String(value)
}
