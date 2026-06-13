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
  return s ? s : null
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
