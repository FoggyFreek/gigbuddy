export const FIELD_SCOPES = Object.freeze({
  BAND: 'band',
  VENUE: 'venue',
  CONTACT: 'contact',
})

const field = (key, scope, format = 'text', options = {}) => Object.freeze({
  key,
  scope,
  format,
  block: false,
  venueSafe: true,
  ...options,
})

const block = (key, scope, options = {}) => field(key, scope, 'html', {
  block: true,
  ...options,
})

export const OUTREACH_FIELDS = Object.freeze([
  field('band.name', FIELD_SCOPES.BAND),
  field('band.short_bio', FIELD_SCOPES.BAND),
  field('band.bio', FIELD_SCOPES.BAND),
  field('band.city', FIELD_SCOPES.BAND),
  field('band.formal_name', FIELD_SCOPES.BAND),
  field('band.kvk', FIELD_SCOPES.BAND),
  field('band.tax_id', FIELD_SCOPES.BAND),
  field('band.spotify_handle', FIELD_SCOPES.BAND),
  field('band.youtube_handle', FIELD_SCOPES.BAND),
  field('band.tiktok_handle', FIELD_SCOPES.BAND),
  field('band.instagram_handle', FIELD_SCOPES.BAND),
  field('band.facebook_handle', FIELD_SCOPES.BAND),
  field('band.bandsintown_artist_id', FIELD_SCOPES.BAND),
  block('band.address', FIELD_SCOPES.BAND),
  field('venue.name', FIELD_SCOPES.VENUE),
  field('venue.city', FIELD_SCOPES.VENUE),
  field('venue.country', FIELD_SCOPES.VENUE),
  field('venue.category', FIELD_SCOPES.VENUE),
  field('venue.organization_name', FIELD_SCOPES.VENUE),
  field('venue.kvk_number', FIELD_SCOPES.VENUE),
  field('venue.tax_id', FIELD_SCOPES.VENUE),
  block('venue.address', FIELD_SCOPES.VENUE),
  field('contact.name', FIELD_SCOPES.CONTACT),
  field('contact.first_name', FIELD_SCOPES.CONTACT),
])

export function fieldsForTemplate() {
  return OUTREACH_FIELDS.filter((entry) => entry.venueSafe !== false)
}

export function fieldByToken(token) {
  const key = String(token).replace(/^#/, '')
  return OUTREACH_FIELDS.find((entry) => entry.key === key) ?? null
}
