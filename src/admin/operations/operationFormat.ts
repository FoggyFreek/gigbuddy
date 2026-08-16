export function formatAdminTimestamp(value: string | null, locale: string | undefined, fallback: string): string {
  if (!value) return fallback
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function userLabel(name: string | null, email: string | null, fallback: string): string {
  return name || email || fallback
}
