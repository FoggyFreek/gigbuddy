// Input parsing and validation for song routes. No DB access here.

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Coerce a body value to a non-negative integer or null.
export function toIntOrNull(val) {
  if (val === null || val === undefined || val === '') return null
  const n = Number(val)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export function trimOrNull(val) {
  const s = String(val ?? '').trim()
  return s || null
}

const TEXT_FIELDS = ['artist', 'song_key', 'lyrics_html', 'notes']
const INT_FIELDS = ['tempo', 'duration_seconds']

// Builds SET fragments ($1..$N) from the allowed song PATCH fields. Returns
// { error } when a provided value is invalid (a blank title).
export function buildSongUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1

  if ('title' in body) {
    const title = trimOrNull(body.title)
    if (!title) return { error: 'title is required' }
    fields.push(`title = $${idx++}`)
    values.push(title)
  }
  for (const key of TEXT_FIELDS) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(key === 'lyrics_html' ? (body[key] ?? null) : trimOrNull(body[key]))
    }
  }
  for (const key of INT_FIELDS) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(toIntOrNull(body[key]))
    }
  }
  return { fields, values }
}

// Builds SET fragments for a song-link PATCH. Returns { error } on invalid input.
export function buildSongLinkUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  if ('label' in body) { fields.push(`label = $${idx++}`); values.push(trimOrNull(body.label)) }
  if ('url' in body) {
    const url = trimOrNull(body.url)
    if (!url) return { error: 'url cannot be empty' }
    fields.push(`url = $${idx++}`); values.push(url)
  }
  if ('sort_order' in body) {
    const so = toIntOrNull(body.sort_order)
    if (so === null) return { error: 'Invalid sort_order' }
    fields.push(`sort_order = $${idx++}`); values.push(so)
  }
  return { fields, values }
}

// Dedupes and trims tag names, dropping blanks. Used by PUT /:id/tags.
export function normalizeTagNames(tags) {
  return [...new Set(tags.map((t) => String(t ?? '').trim()).filter(Boolean))]
}

// ChordPro source can legitimately be large (lyrics + chords + directives); cap
// it to keep a single row sane. 256 KiB of UTF-8 text is far beyond any chart.
export const CHART_SOURCE_MAX = 256 * 1024
const CHART_NAME_MAX = 120

// Reject content that isn't plain-text ChordPro: NUL/C0 control bytes (tab \x09,
// LF \x0A, CR \x0D are allowed) or U+FFFD, the replacement char a failed decode
// leaves behind. Their presence means the upload is really binary (an image/PDF/
// exe renamed .cho) rather than a chart. The .cho/.pro extension is the only
// other gate, so this is what stops a renamed binary from being stored.
// eslint-disable-next-line no-control-regex -- matching control chars is the intent
const RE_NON_PLAINTEXT = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD]/

// True when `source` is plain text safe to store as a ChordPro chart.
export function isPlainTextChartSource(source) {
  return !RE_NON_PLAINTEXT.test(source)
}

// Coerce a chart name to a trimmed, length-capped string, or '' when blank.
export function normalizeChartName(val) {
  return String(val ?? '').trim().slice(0, CHART_NAME_MAX)
}

// Normalize ChordPro source: a string, with CRLF folded to LF so stored source
// is consistent regardless of the uploading platform.
export function normalizeChartSource(val) {
  return String(val ?? '').replace(/\r\n?/g, '\n')
}

// Builds SET fragments for a chart PATCH. Returns { error } on invalid input.
export function buildSongChartUpdateFields(body) {
  const fields = []
  const values = []
  let idx = 1
  if ('name' in body) {
    const name = normalizeChartName(body.name)
    if (!name) return { error: 'name cannot be empty' }
    fields.push(`name = $${idx++}`); values.push(name)
  }
  if ('source' in body) {
    const source = normalizeChartSource(body.source)
    if (source.length > CHART_SOURCE_MAX) return { error: 'source is too large' }
    if (!isPlainTextChartSource(source)) return { error: 'source is not valid ChordPro text' }
    fields.push(`source = $${idx++}`); values.push(source)
  }
  return { fields, values }
}

export function normalizeImportRow(row) {
  return {
    title: String(row.title ?? '').trim(),
    artist: String(row.artist ?? '').trim(),
    song_key: String(row.song_key ?? row.key ?? '').trim(),
    tempo: toIntOrNull(row.tempo),
    duration_seconds: toIntOrNull(row.duration_seconds ?? row.duration),
    tags: String(row.tags ?? '')
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean),
  }
}
