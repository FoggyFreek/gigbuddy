// Single source of truth for "enrich, never overwrite" when a place-lookup
// suggestion is applied to a record. Shared by the server
// (`server/services/venueService.js` applies it authoritatively against the DB
// row) and the frontend (`src/utils/placeFill.ts` re-exports this and layers the
// TS types on top; the add-venue dialog and the enrich preview use it for UX).
//
// Plain `.js` because the server runs ESM with no build step — same pattern as
// `shared/permissions.js`. `Object.freeze` lets the frontend's tsc infer the
// precise `PlaceField` string-literal union from this file.
//
// Coordinates are deliberately absent: they are not text fields, are never shown
// in a form, and are written only by the create/enrich routes.

// The text fields a place suggestion can contribute, in the order the enrich
// preview lists them (mirrors the venue form's visual order).
export const PLACE_FILLABLE_FIELDS = Object.freeze([
  'street_and_number',
  'postal_code',
  'city',
  'region',
  'country',
  'website',
  'phone',
])

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

// Returns only the keys where the target is blank and the suggestion has a
// value, so applying the result can never clobber existing data. Callers spread
// it over the record; an empty object means there is nothing to fill.
export function pickFillableUpdates(current, suggestion, fields = PLACE_FILLABLE_FIELDS) {
  if (!suggestion) return {}
  const updates = {}
  for (const field of fields) {
    if (!isBlank(current?.[field])) continue
    const incoming = suggestion[field]
    if (isBlank(incoming)) continue
    updates[field] = String(incoming).trim()
  }
  return updates
}
