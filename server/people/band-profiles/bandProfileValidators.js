// Input parsing for global band profiles. No DB access here.
//
// Two link fields, two different jobs. The Spotify URL yields an artist id,
// which is a canonical global identity and therefore the one hard dedup key.
// The website yields a normalized key that is advisory only — it powers a "did
// you mean this one?" suggestion and is never a constraint, because normalizing
// an arbitrary URL into a global identity is not safely decidable.
import { normalizeOptionalUrl, WEB_URL_PROTOCOLS } from '../../utils/urls.js'
import { isValidEmail, MAX_EMAIL_LENGTH } from '../../utils/email.js'
import { isKnownCountryCode } from '../../../shared/countries.js'
import {
  MAX_BAND_PROFILE_NAME_LENGTH,
  MAX_BAND_PROFILE_URL_LENGTH,
  MAX_CLAIM_MESSAGE_LENGTH,
  MAX_DECISION_REASON_LENGTH,
  MY_BAND_REMOVAL_MODES,
  DEFAULT_REMOVAL_MODE,
} from '../../domain/bandProfiles.js'

// Query parameters that identify a referrer or a campaign rather than the page.
// Anything not listed here is kept: some sites really do put the page identity
// in the query string, and dropping it would merge two different bands.
const TRACKING_PARAMS = new Set([
  'si', 'fbclid', 'igshid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'referrer',
])
const isTrackingParam = (key) => TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')

const SPOTIFY_HOSTS = new Set(['open.spotify.com', 'play.spotify.com'])
const SPOTIFY_ARTIST_PATH = /^(?:\/intl-[a-z]{2})?\/artist\/([0-9A-Za-z]{22})$/
const SPOTIFY_URI = /^spotify:artist:([0-9A-Za-z]{22})$/

const absent = (value) => value === undefined || value === null || value === ''

// Returns { error } | { url: null } | { url, artistId }.
export function parseSpotifyArtistUrl(value) {
  if (absent(value)) return { url: null, artistId: null }
  if (typeof value !== 'string') return { error: 'invalid_spotify_url' }

  const trimmed = value.trim()
  if (trimmed === '') return { url: null, artistId: null }

  const uri = SPOTIFY_URI.exec(trimmed)
  if (uri) return canonicalSpotify(uri[1])

  let url
  try {
    url = new URL(trimmed)
  } catch {
    return { error: 'invalid_spotify_url' }
  }
  if (!WEB_URL_PROTOCOLS.has(url.protocol)) return { error: 'invalid_spotify_url' }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!SPOTIFY_HOSTS.has(host)) return { error: 'invalid_spotify_url' }

  const match = SPOTIFY_ARTIST_PATH.exec(url.pathname)
  if (!match) return { error: 'invalid_spotify_url' }

  // Rebuilt from the id alone, so the stored URL never carries a `?si=` share
  // token or a locale prefix that would make two links to one artist look
  // different.
  return canonicalSpotify(match[1])
}

function canonicalSpotify(artistId) {
  return { url: `https://open.spotify.com/artist/${artistId}`, artistId }
}

// Returns { error } | { url: null } | { url, key }.
export function parseWebsiteUrl(value) {
  if (absent(value)) return { url: null, key: null }
  if (typeof value !== 'string') return { error: 'invalid_website_url' }
  if (value.trim() === '') return { url: null, key: null }

  let href
  try {
    href = normalizeOptionalUrl(value, { allowedProtocols: WEB_URL_PROTOCOLS })
  } catch {
    return { error: 'invalid_website_url' }
  }
  if (href === null) return { url: null, key: null }
  if (href.length > MAX_BAND_PROFILE_URL_LENGTH) return { error: 'website_url_too_long' }

  const key = websiteKey(href)
  if (key.length > MAX_BAND_PROFILE_URL_LENGTH) return { error: 'website_url_too_long' }
  return { url: href, key }
}

// Host + path, NOT the bare domain: a band's only web presence is often a page
// on a shared platform, where facebook.com/bandA and facebook.com/bandB are
// different bands behind one domain.
//
// The host is case-insensitive by definition so it is lowercased; the path is
// NOT, because plenty of servers serve /MyBand and /myband differently, and
// folding them would merge two bands that are genuinely distinct.
export function websiteKey(href) {
  const url = new URL(href)
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname.replace(/\/+$/, '')

  const params = [...url.searchParams.entries()].filter(([key]) => !isTrackingParam(key))
  params.sort(([a], [b]) => a.localeCompare(b))
  const query = params.length
    ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}`
    : ''

  // The fragment is never part of what the server serves.
  return `${host}${path}${query}`
}

function parseName(value) {
  if (typeof value !== 'string') return { error: 'name_required' }
  const name = value.trim()
  if (name === '') return { error: 'name_required' }
  if (name.length > MAX_BAND_PROFILE_NAME_LENGTH) return { error: 'name_too_long' }
  return { name }
}

function parseCountry(value) {
  if (typeof value !== 'string') return { error: 'invalid_country' }
  const code = value.trim().toLowerCase()
  if (!isKnownCountryCode(code)) return { error: 'invalid_country' }
  return { code }
}

function parseContactEmail(value) {
  if (absent(value)) return { email: null }
  if (typeof value !== 'string') return { error: 'invalid_email' }
  const email = value.trim()
  if (email === '') return { email: null }
  if (email.length > MAX_EMAIL_LENGTH || !isValidEmail(email)) return { error: 'invalid_email' }
  return { email }
}

// Returns { error } | { profile } with every column resolved, including the
// derived dedup keys. The caller still owns the at-least-one-link rule, which
// is checked against the merged row (see hasLink).
export function parseBandProfileCreate(body) {
  const name = parseName(body?.name)
  if (name.error) return name

  const country = parseCountry(body?.countryCode ?? body?.country_code)
  if (country.error) return country

  const spotify = parseSpotifyArtistUrl(body?.spotifyUrl ?? body?.spotify_url)
  if (spotify.error) return spotify

  const website = parseWebsiteUrl(body?.websiteUrl ?? body?.website_url)
  if (website.error) return website

  const contact = parseContactEmail(body?.contactEmail ?? body?.contact_email)
  if (contact.error) return contact

  const profile = {
    name: name.name,
    country_code: country.code,
    spotify_url: spotify.url,
    spotify_artist_id: spotify.artistId,
    website_url: website.url,
    website_key: website.key,
    contact_email: contact.email,
  }
  if (!hasLink(profile)) return { error: 'band_profile_needs_link' }
  return { profile }
}

const FIELD_ALIASES = Object.freeze({
  name: ['name'],
  country_code: ['countryCode', 'country_code'],
  spotify_url: ['spotifyUrl', 'spotify_url'],
  website_url: ['websiteUrl', 'website_url'],
  contact_email: ['contactEmail', 'contact_email'],
})

const present = (body, field) => FIELD_ALIASES[field].some((alias) => Object.hasOwn(body, alias))
const valueOf = (body, field) => FIELD_ALIASES[field].map((alias) => body[alias]).find((v) => v !== undefined)

// Returns { error } | { patch }. Only the fields the body actually mentions are
// present, and a URL always drags its derived dedup key along — a stored key
// without its URL would silently stop matching, and the DB pair CHECKs refuse
// it outright.
export function parseBandProfilePatch(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' }

  const patch = {}

  if (present(body, 'name')) {
    const name = parseName(valueOf(body, 'name'))
    if (name.error) return name
    patch.name = name.name
  }

  if (present(body, 'country_code')) {
    const country = parseCountry(valueOf(body, 'country_code'))
    if (country.error) return country
    patch.country_code = country.code
  }

  if (present(body, 'spotify_url')) {
    const spotify = parseSpotifyArtistUrl(valueOf(body, 'spotify_url'))
    if (spotify.error) return spotify
    patch.spotify_url = spotify.url
    patch.spotify_artist_id = spotify.artistId
  }

  if (present(body, 'website_url')) {
    const website = parseWebsiteUrl(valueOf(body, 'website_url'))
    if (website.error) return website
    patch.website_url = website.url
    patch.website_key = website.key
  }

  if (present(body, 'contact_email')) {
    const contact = parseContactEmail(valueOf(body, 'contact_email'))
    if (contact.error) return contact
    patch.contact_email = contact.email
  }

  if (Object.keys(patch).length === 0) return { error: 'no_fields_to_update' }
  return { patch }
}

// The at-least-one-link rule is a POST-MERGE invariant, not a payload one: a
// PATCH that clears the last link is only detectable against the stored row,
// which no validator can see. Callers apply this to { ...current, ...patch }
// inside the transaction that writes.
export function hasLink(profile) {
  return profile.spotify_url !== null || profile.website_url !== null
}

// Returns { error } | { mode }. Absent means keep: removing a band from a
// collection must never delete a musician's events by default.
export function parseRemovalMode(value) {
  if (absent(value)) return { mode: DEFAULT_REMOVAL_MODE }
  if (!Object.values(MY_BAND_REMOVAL_MODES).includes(value)) return { error: 'invalid_mode' }
  return { mode: value }
}

// Plain text, trimmed, capped; never rendered as HTML or markdown.
function parseCappedText(value, max, code, { required = false } = {}) {
  if (absent(value)) return required ? { error: code } : { text: null }
  if (typeof value !== 'string') return { error: code }
  const text = value.trim()
  if (text === '') return required ? { error: code } : { text: null }
  if (text.length > max) return { error: code }
  return { text }
}

export const parseClaimMessage = (value) =>
  parseCappedText(value, MAX_CLAIM_MESSAGE_LENGTH, 'invalid_claim_message')

// A rejection without a reason is unactionable for the band that has to fix it.
export const parseDecisionReason = (value, { required }) =>
  parseCappedText(value, MAX_DECISION_REASON_LENGTH, 'invalid_decision_reason', { required })
