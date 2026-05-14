/**
 * Strips characters from a user-supplied filename that can break the
 * Content-Disposition header value (CRLF injection / response splitting,
 * unbalanced quotes, backslash escapes).
 *
 * RFC 6266 §4.1: the filename token must not contain control characters,
 * double-quotes, or backslashes when used inside a quoted-string.
 */
export function sanitizeFilename(name) {
  if (typeof name !== 'string' || !name.trim()) return 'download'
  const cleaned = name
    .replace(/[\x00-\x1f\x7f"\\]/g, '_') // control chars, double-quote, backslash
    .trim()
    .slice(0, 255) // cap to filesystem-safe length
  return cleaned || 'download'
}
