// Input parsing and validation for the tax-scheme-enrolment routes. No DB access.
//
// Returns column -> value objects rather than SQL fragments, matching the
// contract accountingProfileValidators uses.
import { getTaxScheme, isKnownTaxScheme } from '../../shared/taxSchemes.js'
import { isIsoDate } from '../utils/periodQuery.js'
// The existing date-only normalizer (Postgres hands a DATE back as a Date). Its
// name is UBL-flavoured but the behavior is generic, and a second copy would give
// the same normalization two owners.
import { toUblDate as toDateOnly } from '../../shared/peppol.js'

const VOID_REASON_MAX = 200

export const PATCHABLE_ENROLMENT_FIELDS = Object.freeze([
  'valid_from',
  'valid_to',
  'source_confirmation_date',
])

export function parseId(raw) {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

function validateDate(key, raw, { nullable }) {
  if (raw === null || raw === undefined || raw === '') {
    return nullable ? { value: null } : { error: `invalid_${key}` }
  }
  if (typeof raw !== 'string' || !isIsoDate(raw)) return { error: `invalid_${key}` }
  return { value: raw }
}

export function validateVoidReason(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null }
  if (typeof raw !== 'string') return { error: 'invalid_void_reason' }
  const trimmed = raw.trim()
  if (trimmed.length > VOID_REASON_MAX) return { error: 'invalid_void_reason' }
  return { value: trimmed || null }
}

// The country an enrolment is recorded against. A national scheme is always the
// tenant's own accounting country — accepting one from the body would let a
// caller record a Dutch KOR against a German profile. A per-destination scheme
// (EU SME) is the one case where the client picks the country, because the
// exemption is granted by the destination member state.
function resolveCountry(body, schemeCode, homeCountry) {
  const scheme = getTaxScheme(schemeCode)
  if (!scheme) return { error: 'invalid_scheme_code' }
  if (!scheme.perDestination) {
    if ('country_code' in body && body.country_code && body.country_code !== homeCountry) {
      return { error: 'scheme_country_mismatch' }
    }
    return { value: homeCountry, scheme }
  }
  const raw = body.country_code
  if (typeof raw !== 'string' || !raw) return { error: 'invalid_country_code' }
  const country = raw.trim().toLowerCase()
  // A destination exemption in your own country is not the cross-border scheme —
  // that is the national one, and recording it here would double-count.
  if (country === homeCountry) return { error: 'scheme_country_mismatch' }
  if (!isKnownTaxScheme(country, schemeCode)) return { error: 'scheme_country_mismatch' }
  return { value: country, scheme }
}

// Builds the row for a new enrolment. `homeCountry` is the accounting profile's
// immutable country. Returns { enrolment } or { error: '<code>' }.
export function buildEnrolmentInsert(body, { homeCountry }) {
  const schemeCode = typeof body.scheme_code === 'string' ? body.scheme_code : null
  if (!schemeCode) return { error: 'invalid_scheme_code' }

  const country = resolveCountry(body, schemeCode, homeCountry)
  if (country.error) return { error: country.error }
  if (!isKnownTaxScheme(country.value, schemeCode)) return { error: 'scheme_country_mismatch' }

  const from = validateDate('valid_from', body.valid_from, { nullable: false })
  if (from.error) return { error: from.error }

  const to = validateDate('valid_to', body.valid_to, { nullable: true })
  if (to.error) return { error: to.error }
  if (to.value !== null && to.value < from.value) return { error: 'valid_to_before_valid_from' }

  const confirmed = validateDate('source_confirmation_date', body.source_confirmation_date, { nullable: true })
  if (confirmed.error) return { error: confirmed.error }

  return {
    enrolment: {
      country_code: country.value,
      scheme_code: schemeCode,
      scheme_scope: country.scheme.scope,
      valid_from: from.value,
      valid_to: to.value,
      // A row a human created and dated is confirmed by definition; only the
      // migration's inferences carry the other status.
      status: 'confirmed',
      source_confirmation_date: confirmed.value,
    },
  }
}

// Builds the UPDATE payload for an existing enrolment. Only the dates are
// editable: changing the scheme or the country of a recorded enrolment is not a
// correction of that enrolment, it is a different one.
//
// Returns { updates } or { error: '<code>' }. The effective range is validated
// against the stored row so sending only one end cannot produce an inverted one.
export function buildEnrolmentUpdate(body, { current }) {
  const updates = {}

  for (const key of PATCHABLE_ENROLMENT_FIELDS) {
    if (!(key in body)) continue
    const result = validateDate(key, body[key], { nullable: key !== 'valid_from' })
    if (result.error) return { error: result.error }
    updates[key] = result.value
  }

  if (Object.keys(updates).length === 0) return { error: 'nothing_to_update' }

  const from = 'valid_from' in updates ? updates.valid_from : toDateOnly(current.valid_from)
  const to = 'valid_to' in updates ? updates.valid_to : toDateOnly(current.valid_to)
  if (to !== null && from !== null && to < from) return { error: 'valid_to_before_valid_from' }

  // Confirming the dates is what promotes an inference: the migration could
  // prove the band is on the scheme, never since when, so a human supplying the
  // range is the only thing that makes the row an assertion rather than a guess.
  if (current.status === 'legacy_inferred') updates.status = 'confirmed'

  return { updates, effectiveRange: { from, to } }
}
