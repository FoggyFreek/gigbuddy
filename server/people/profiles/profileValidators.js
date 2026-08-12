// Input parsing and validation for profile routes. No DB access here.
import { parsePositiveId as parseId } from '../../platform/http/requestValidators.js'
import { normalizeOptionalUrl, PROFILE_LINK_PROTOCOLS } from '../../utils/urls.js'
import { EMAIL_RE } from '../../utils/email.js'
import { DEFAULT_VAT_COUNTRY, isValidVatId, normalizeVatNumber } from '../../../shared/vatRates.js'
import { isValidRegistrationNumber, normalizeRegistrationNumber } from '../../../shared/businessRegistry.js'
import { parseArtistId } from '../../promotion/bandsintown/bandsintownValidators.js'

// Mollie API keys: live_<alphanum 25+> or test_<alphanum 25+>
export const MOLLIE_KEY_RE = /^(live|test)_[A-Za-z0-9]{25,}$/

export function isValidMollieKey(key) {
  return typeof key === 'string' && MOLLIE_KEY_RE.test(key)
}

// Shopify app credentials (Dev Dashboard). Used with the client_credentials
// grant to mint a short-lived Admin API access token at request time. The
// Client ID (API key) is a 32+ char hex string; the Client Secret carries an
// "shpss_" prefix followed by 32 hex chars, e.g.
export const SHOPIFY_CLIENT_ID_RE = /^[a-fA-F0-9]{32,}$/
export const SHOPIFY_CLIENT_SECRET_RE = /^shpss_[a-fA-F0-9]{32}$/

export function isValidShopifyClientId(value) {
  return typeof value === 'string' && SHOPIFY_CLIENT_ID_RE.test(value.trim())
}

export function isValidShopifyClientSecret(value) {
  return typeof value === 'string' && SHOPIFY_CLIENT_SECRET_RE.test(value.trim())
}

// Bandsintown API key (app_id): a short opaque token, no whitespace.
export const BANDSINTOWN_APP_ID_RE = /^\S{1,200}$/

export function isValidBandsintownAppId(value) {
  return typeof value === 'string' && BANDSINTOWN_APP_ID_RE.test(value.trim())
}

// Resend API keys are opaque tokens with a stable re_ prefix. Keep validation
// permissive enough for future token alphabets while bounding stored input.
export const RESEND_API_KEY_RE = /^re_\S{1,197}$/

export function isValidResendApiKey(value) {
  return typeof value === 'string' && RESEND_API_KEY_RE.test(value.trim())
}

// Shopify store domain, e.g. "yourband.myshopify.com" — the Admin REST API host.
export const SHOPIFY_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i

export function isValidShopifyDomain(domain) {
  return typeof domain === 'string' && SHOPIFY_DOMAIN_RE.test(domain.trim())
}

// Trims and lowercases a valid domain to the canonical form used for storage.
export function normalizeShopifyDomain(domain) {
  return domain.trim().toLowerCase()
}

export const PROFILE_FIELDS = [
  'band_name',
  'bio',
  'short_bio',
  'instagram_handle',
  'facebook_handle',
  'tiktok_handle',
  'youtube_handle',
  'spotify_handle',
  'bandsintown_artist_name',
  'bandsintown_artist_id',
  'accent_color',
]

// Capped to what the public link page layout holds; long-form `bio` is unbounded.
const SHORT_BIO_MAX = 150

function validateShortBio(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null }
  if (typeof raw !== 'string') return { error: 'invalid_short_bio' }
  if (raw.length > SHORT_BIO_MAX) return { error: 'invalid_short_bio' }
  return { value: raw }
}

// The same column Settings → Integrations writes, so the shape is enforced here
// too — the integration cannot call the API with a non-numeric id.
function validateBandsintownArtistId(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null }
  const artistId = parseArtistId(raw)
  return artistId ? { value: artistId } : { error: 'invalid_bandsintown_artist_id' }
}

// Per-key validators for PROFILE_FIELDS. Keys absent here are stored as sent.
const PROFILE_VALIDATORS = {
  short_bio: validateShortBio,
  bandsintown_artist_id: validateBandsintownArtistId,
}

// Dashboard memory tile (customization data). The caption is free text; the gig
// reference is a gig id (tenant ownership is verified in the service, not here).
export const MEMORY_FIELDS = ['memory_caption', 'memory_gig_id']

const MEMORY_CAPTION_MAX = 500

function validateMemoryCaption(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null }
  if (typeof raw !== 'string') return { error: 'invalid_memory_caption' }
  if (raw.length > MEMORY_CAPTION_MAX) return { error: 'invalid_memory_caption' }
  return { value: raw }
}

function validateMemoryGigId(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null }
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return { error: 'invalid_memory_gig_id' }
  return { value: n }
}

const MEMORY_VALIDATORS = {
  memory_caption: validateMemoryCaption,
  memory_gig_id: validateMemoryGigId,
}

// Seller-identity fields printed on invoices (EN 16931 BT-27..BT-43).
//
// The REGIME is deliberately absent — country, legal form, default VAT rate and
// the scheme exemption belong to the accounting profile and its enrolments, which
// carry immutability, dates and confirmations this endpoint cannot express. A
// stale client still sending one has the field ignored rather than rejected.
export const FINANCIAL_FIELDS = [
  'formal_name',
  'address_street',
  'address_postal_code',
  'address_city',
  'address_country',
  'kvk_number',
  'registration_office',
  'directors',
  'email',
  'phone',
  'iban',
  'tax_id',
]

export const FINANCIAL_FIELDS_SET = new Set(FINANCIAL_FIELDS)

const LINK_FIELDS = ['label', 'url', 'sort_order']

const TEXT_MAX_LENGTHS = {
  formal_name: 200,
  address_street: 200,
  address_postal_code: 10,
  address_city: 200,
  address_country: 200,
  // Court / city / province the registration number is scoped to (DE/FR/AT/IT).
  registration_office: 120,
  // Managing directors / board, disclosed on invoices by incorporated bands.
  directors: 300,
  email: 254,
  phone: 40,
}

const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/

// Business contact address (EN 16931 BT-43). Shared with the invoice mailer's
// header check, so a value accepted here cannot be rejected there.

// Telephone (BT-42). Digits with the punctuation people actually type; kept
// permissive because international formats vary far more than validators assume.
const PHONE_RE = /^\+?[\d\s().-]{4,}$/

export { parseId }

export function normalizeRequiredProfileUrl(value) {
  const url = normalizeOptionalUrl(value, { allowedProtocols: PROFILE_LINK_PROTOCOLS })
  if (!url) {
    const err = new Error('Invalid URL')
    err.status = 400
    throw err
  }
  return url
}

// Registration number (KvK/Handelsregister/SIREN/…), format per VAT country.
// Where the tax number IS the register id (BE, ES) only empty is accepted.
function validateKvkNumber(raw, vatCountry) {
  if (raw === null || raw === undefined) return { value: null }
  if (typeof raw !== 'string') return { error: 'invalid_kvk_number' }
  const v = normalizeRegistrationNumber(raw)
  if (!isValidRegistrationNumber(vatCountry, v)) return { error: 'invalid_kvk_number' }
  return { value: v }
}

// VAT id, validated against the tenant's VAT country (DE… vs NL…B..).
// Whitespace stripped and uppercased first.
function validateTaxId(raw, vatCountry) {
  if (raw === null || raw === undefined) return { value: null }
  if (typeof raw !== 'string') return { error: 'invalid_tax_id' }
  const stripped = normalizeVatNumber(raw)
  if (stripped === '') return { value: '' }
  if (!isValidVatId(vatCountry, stripped)) return { error: 'invalid_tax_id' }
  return { value: stripped }
}

// Builds a validator for whitespace-stripped, regex-checked fields (kvk/iban/tax_id).
function makeStrippedValidator(key, re, upper) {
  return (raw) => {
    if (raw === null || raw === undefined) return { value: null }
    if (typeof raw !== 'string') return { error: `invalid_${key}` }
    let stripped = raw.replace(/\s+/g, '')
    if (upper) stripped = stripped.toUpperCase()
    if (stripped === '') return { value: '' }
    if (!re.test(stripped)) return { error: `invalid_${key}` }
    return { value: stripped }
  }
}

function validateBoundedText(key, raw) {
  if (raw === null || raw === undefined) return { value: null }
  if (typeof raw !== 'string') return { error: `invalid_${key}` }
  const max = TEXT_MAX_LENGTHS[key]
  if (max != null && raw.length > max) return { error: `invalid_${key}` }
  return { value: raw }
}

// Trimmed, length-bounded, and pattern-checked only when non-empty — clearing
// the field is always allowed.
function makeOptionalPatternValidator(key, re) {
  return (raw) => {
    if (raw === null || raw === undefined) return { value: null }
    if (typeof raw !== 'string') return { error: `invalid_${key}` }
    const trimmed = raw.trim()
    if (trimmed === '') return { value: '' }
    if (trimmed.length > TEXT_MAX_LENGTHS[key]) return { error: `invalid_${key}` }
    if (!re.test(trimmed)) return { error: `invalid_${key}` }
    return { value: trimmed }
  }
}

const FINANCIAL_VALIDATORS = {
  email: makeOptionalPatternValidator('email', EMAIL_RE),
  phone: makeOptionalPatternValidator('phone', PHONE_RE),
  iban: makeStrippedValidator('iban', IBAN_RE, true),
}

function normalizeFinancialValue(key, raw, vatCountry) {
  // tax_id/kvk_number formats are country-dependent, so no fixed regex above.
  if (key === 'tax_id') return validateTaxId(raw, vatCountry)
  if (key === 'kvk_number') return validateKvkNumber(raw, vatCountry)
  const validator = FINANCIAL_VALIDATORS[key]
  return validator ? validator(raw) : validateBoundedText(key, raw)
}

// Accumulates `col = $n` fragments + values, numbering in push order.
function createSetBuilder() {
  const fields = []
  const values = []
  const updates = []
  return {
    fields,
    values,
    updates,
    push(key, value) {
      fields.push(`${key} = $${fields.length + 1}`)
      values.push(value)
      updates.push({ field: key, value })
    },
  }
}

// Runs one field group into `builder`. `resolveValidator` returns undefined for
// keys stored exactly as sent. Returns an error string, or null when valid.
function collectFieldGroup(body, keys, resolveValidator, builder) {
  for (const key of keys) {
    if (!(key in body)) continue
    const validator = resolveValidator(key)
    if (!validator) {
      builder.push(key, body[key])
      continue
    }
    const result = validator(body[key])
    if (result.error) return result.error
    if (result.skip) continue
    builder.push(key, result.value)
  }
  return null
}

// Builds the tenant-profile UPDATE SET fragments. `vatCountry` is the effective
// VAT country (the value being set, else the stored one), used for tax_id.
export function buildProfileUpdate(body, { vatCountry = DEFAULT_VAT_COUNTRY } = {}) {
  const builder = createSetBuilder()
  const groups = [
    [PROFILE_FIELDS, (key) => PROFILE_VALIDATORS[key]],
    [FINANCIAL_FIELDS, (key) => (raw) => normalizeFinancialValue(key, raw, vatCountry)],
    [MEMORY_FIELDS, (key) => MEMORY_VALIDATORS[key]],
  ]

  for (const [keys, resolveValidator] of groups) {
    const error = collectFieldGroup(body, keys, resolveValidator, builder)
    if (error) return { error }
  }

  return { fields: builder.fields, values: builder.values, updates: builder.updates }
}

// Builds the profile-link UPDATE SET fragments. Throws (err.status 400) when a
// provided url is invalid. Returns { fields, values }.
export function buildLinkUpdate(body) {
  const builder = createSetBuilder()
  for (const key of LINK_FIELDS) {
    if (key in body) {
      builder.push(key, key === 'url' ? normalizeRequiredProfileUrl(body[key]) : body[key])
    }
  }
  return { fields: builder.fields, values: builder.values }
}
