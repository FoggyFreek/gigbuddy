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
    .replace(/[\\"]/g, '_')
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0)
      return code <= 0x1f || code === 0x7f ? '_' : ch
    })
    .join('')
    .trim()
    .slice(0, 255) // cap to filesystem-safe length
  return cleaned || 'download'
}
