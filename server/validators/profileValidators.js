// Input parsing and validation for profile routes. No DB access here.
import { normalizeOptionalUrl, PROFILE_LINK_PROTOCOLS } from '../utils/urls.js'

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
  'instagram_handle',
  'facebook_handle',
  'tiktok_handle',
  'youtube_handle',
  'spotify_handle',
  'bandsintown_artist_name',
  'accent_color',
]

export const FINANCIAL_FIELDS = [
  'formal_name',
  'address_street',
  'address_postal_code',
  'address_city',
  'address_country',
  'kvk_number',
  'iban',
  'tax_id',
  'tax_percentage',
  'applies_kor',
]

export const FINANCIAL_FIELDS_SET = new Set(FINANCIAL_FIELDS)

const LINK_FIELDS = ['label', 'url', 'sort_order']

const TEXT_MAX_LENGTHS = {
  formal_name: 200,
  address_street: 200,
  address_postal_code: 10,
  address_city: 200,
  address_country: 200,
}

const KVK_RE = /^\d{8}$/
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/
const TAX_ID_RE = /^NL\d{9}B\d{2}$/

export function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function normalizeRequiredProfileUrl(value) {
  const url = normalizeOptionalUrl(value, { allowedProtocols: PROFILE_LINK_PROTOCOLS })
  if (!url) {
    const err = new Error('Invalid URL')
    err.status = 400
    throw err
  }
  return url
}

function validateAppliesKor(raw) {
  if (raw === null || raw === undefined) return { skip: true }
  if (typeof raw !== 'boolean') return { error: 'invalid_applies_kor' }
  return { value: raw }
}

function validateTaxPercentage(raw) {
  if (raw === null || raw === undefined) return { value: null }
  if (raw === '') return { skip: true }
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 100) return { error: 'invalid_tax_percentage' }
  return { value: n }
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

const FINANCIAL_VALIDATORS = {
  applies_kor: validateAppliesKor,
  tax_percentage: validateTaxPercentage,
  kvk_number: makeStrippedValidator('kvk_number', KVK_RE, false),
  iban: makeStrippedValidator('iban', IBAN_RE, true),
  tax_id: makeStrippedValidator('tax_id', TAX_ID_RE, true),
}

function normalizeFinancialValue(key, raw) {
  const validator = FINANCIAL_VALIDATORS[key]
  return validator ? validator(raw) : validateBoundedText(key, raw)
}

// Builds the tenant-profile UPDATE SET fragments from PROFILE + FINANCIAL fields.
// Returns { error } when a financial value is invalid, otherwise { fields, values }.
export function buildProfileUpdate(body) {
  const fields = []
  const values = []
  let idx = 1

  for (const key of PROFILE_FIELDS) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(body[key])
    }
  }

  for (const key of FINANCIAL_FIELDS) {
    if (!(key in body)) continue
    const result = normalizeFinancialValue(key, body[key])
    if (result.error) return { error: result.error }
    if (result.skip) continue
    fields.push(`${key} = $${idx++}`)
    values.push(result.value)
  }

  return { fields, values }
}

// Builds the profile-link UPDATE SET fragments. Throws (err.status 400) when a
// provided url is invalid. Returns { fields, values }.
export function buildLinkUpdate(body) {
  const fields = []
  const values = []
  let idx = 1
  for (const key of LINK_FIELDS) {
    if (key in body) {
      fields.push(`${key} = $${idx++}`)
      values.push(key === 'url' ? normalizeRequiredProfileUrl(body[key]) : body[key])
    }
  }
  return { fields, values }
}
