// Input parsing and validation for contact routes. No DB access here.

export const VALID_CATEGORIES = new Set([
  'press', 'radio & tv', 'booker', 'promotion', 'network', 'supplier',
])

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Normalizes a category query filter. Returns null (no filter), false (invalid
// value → 400 in the service), or the validated category string.
export function parseCategoryFilter(value) {
  if (value == null || value === '') return null
  const category = String(value).trim()
  return VALID_CATEGORIES.has(category) ? category : false
}

export function parseSearchLimit(value) {
  const parsedLimit = Number.parseInt(value, 10)
  return Math.max(
    1,
    Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 10, 25),
  )
}

// Builds SET fragments ($1..$N) for a contact PATCH. Empty strings normalize to
// NULL. Returns { error } on an invalid category, or { fields, values }.
export function buildContactUpdateFields(body) {
  const allowed = ['name', 'email', 'phone', 'category']
  const fields = []
  const values = []
  let idx = 1
  for (const key of allowed) {
    if (!(key in body)) continue
    if (key === 'category' && !VALID_CATEGORIES.has(body[key])) {
      return { error: 'Invalid category value' }
    }
    fields.push(`${key} = $${idx++}`)
    values.push(body[key] || null)
  }
  return { fields, values }
}

export function normalizeImportRow(row) {
  return {
    name: String(row.name ?? '').trim(),
    email: String(row.email ?? '').trim(),
    phone: String(row.phone ?? '').trim(),
    category: VALID_CATEGORIES.has(row.category) ? row.category : 'press',
  }
}
