export const FIELD_SCOPES = Object.freeze({
  BAND: 'band',
  VENUE: 'venue',
  CONTACT: 'contact',
  INVOICE: 'invoice',
  CUSTOMER: 'customer',
})

// `required` drives recipient skipping: an empty value for a required field makes
// the email unsendable, while an optional one (no payment link, a blank message)
// merges to nothing and the send proceeds.
const field = (key, scope, format = 'text', options = {}) => Object.freeze({
  key,
  scope,
  format,
  block: false,
  venueSafe: true,
  required: true,
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
  field('invoice.number', FIELD_SCOPES.INVOICE),
  field('invoice.issue_date', FIELD_SCOPES.INVOICE, 'date'),
  field('invoice.due_date', FIELD_SCOPES.INVOICE, 'date', { required: false }),
  field('invoice.total', FIELD_SCOPES.INVOICE, 'money'),
  field('invoice.total_excl_vat', FIELD_SCOPES.INVOICE, 'money'),
  field('invoice.vat_amount', FIELD_SCOPES.INVOICE, 'money'),
  field('invoice.payment_url', FIELD_SCOPES.INVOICE, 'text', { required: false }),
  field('invoice.event_date', FIELD_SCOPES.INVOICE, 'date', { required: false }),
  field('invoice.event_description', FIELD_SCOPES.INVOICE, 'text', { required: false }),
  block('invoice.payment_block', FIELD_SCOPES.INVOICE, { required: false }),
  field('customer.name', FIELD_SCOPES.CUSTOMER),
  field('customer.email', FIELD_SCOPES.CUSTOMER, 'text', { required: false }),
  field('customer.contact_title', FIELD_SCOPES.CUSTOMER, 'text', { required: false }),
  field('customer.contact_family_name', FIELD_SCOPES.CUSTOMER, 'text', { required: false }),
  field('customer.greeting', FIELD_SCOPES.CUSTOMER),
  block('message', FIELD_SCOPES.CUSTOMER, { required: false }),
])

export function fieldByToken(token) {
  const key = String(token).replace(/^#/, '')
  return OUTREACH_FIELDS.find((entry) => entry.key === key) ?? null
}
