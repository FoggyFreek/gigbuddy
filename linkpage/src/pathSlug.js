// Parse a public URL path into a page slug, or null when it isn't a valid page
// path. One segment is a main page (/foo); two are a release page (/foo/bar).
// decodeURIComponent throws a URIError on malformed percent-encoding (e.g.
// /%E0%A4%A), so decoding is guarded — a bad path resolves to null (not-found)
// instead of crashing the render.
export function slugFromPath(pathname) {
  const rest = pathname.replace(/\/+$/, '').replace(/^\/+/, '')
  if (!rest) return null
  const segments = rest.split('/')
  if (segments.length > 2) return null
  try {
    return segments.map(decodeURIComponent).join('/').toLowerCase()
  } catch {
    return null
  }
}
