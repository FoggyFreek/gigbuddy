// Canonical IBAN/account form for storage and matching: no whitespace,
// upper-case. Returns null for nullish or blank input. This intentionally does
// not validate the checksum; a malformed value simply will not match.
export function normalizeIban(value) {
  if (value == null) return null
  const cleaned = String(value).replace(/\s+/g, '').toUpperCase()
  return cleaned === '' ? null : cleaned
}
