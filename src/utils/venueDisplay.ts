import type { Venue } from '../types/entities.ts'

export function venueHeadline(v: Venue | null | undefined): string {
  if (!v) return ''
  return v.name || ''
}

export function venueCity(v: Venue | null | undefined): string {
  return v?.city ?? ''
}

export function venueOptionLabel(v: Venue | null | undefined): string {
  if (!v) return ''
  const head = venueHeadline(v)
  return v.city ? `${head} — ${v.city}` : head
}
