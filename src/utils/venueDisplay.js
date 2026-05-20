export function venueHeadline(v) {
  if (!v) return ''
  return v.category === 'festival' && v.festival_name ? v.festival_name : v.name || ''
}

export function venueCity(v) {
  return v?.city ?? ''
}

export function venueOptionLabel(v) {
  if (!v) return ''
  const head = venueHeadline(v)
  return v.city ? `${head} — ${v.city}` : head
}
