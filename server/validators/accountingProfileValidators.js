// Input parsing and validation for the accounting-profile routes. No DB access.
//
// Returns an `updates` object (column -> value) rather than SQL fragments, the
// same contract accountService/patchSettings uses for tenant_accounting_settings.
import {
  isKnownLocalLegalForm,
  legalFormForLocalCode,
  defaultReportingFramework,
} from '../../shared/accountingProfileCodes.js'
import { isKnownVatRate } from '../../shared/vatRates.js'

// entity_size and financial_accounting_basis are deliberately NOT patchable — see
// migration 137. Both record what this application is and does (micro-entity
// reporting, revenue posted on the invoice date) rather than a tenant preference,
// so offering them as fields would let a band state something the software does
// not deliver. These lists remain the documented domain for whatever future work
// widens either one.
export const ENTITY_SIZES = Object.freeze(['micro', 'small', 'other', 'unknown'])
export const FINANCIAL_ACCOUNTING_BASES = Object.freeze(['accrual', 'cash', 'simplified', 'unknown'])
export const VAT_ACCOUNTING_BASES = Object.freeze(['invoice', 'cash', 'not_applicable', 'unknown'])
export const VAT_FILING_FREQUENCIES = Object.freeze([
  'monthly', 'quarterly', 'yearly', 'authority_assigned',
  'exempt', 'not_applicable', 'unconfigured',
])

// The answers that are only coherent for a band that has confirmed it is VAT
// registered. 'exempt' belongs here: a small-business-scheme participant (the Dutch
// KOR and its equivalents) is registered and holds a VAT number, but the scheme
// relieves it of filing — which is a different statement from 'not_applicable',
// meaning not registered at all.
export const REGISTERED_VAT_ACCOUNTING_BASES = Object.freeze(['invoice', 'cash'])
export const REGISTERED_VAT_FILING_FREQUENCIES = Object.freeze([
  'monthly', 'quarterly', 'yearly', 'authority_assigned', 'exempt',
])

// Fields a client may send — deliberately only the facts a band actually knows
// about itself. Everything else on the row is either immutable, a product fact or
// derived from these:
//   country_code / base_currency    fixed at band creation, currency follows country
//   entity_size / financial_accounting_basis
//                                   product facts (see above)
//   legal_form                      derived from local_legal_form_code
//   reporting_framework_code        derived from country + legal form
//   vat_accounting_basis            derived from vat_registered
//   profile_status / profile_source / reviewed_*
//                                   server-computed
export const PATCHABLE_PROFILE_FIELDS = Object.freeze([
  'local_legal_form_code',
  'local_legal_form_label',
  'vat_registered',
  'vat_filing_frequency',
  'financial_year_start_month',
  'financial_year_start_day',
  'default_vat_rate',
])

const LOCAL_LEGAL_FORM_LABEL_MAX = 120

// Highest day number that exists in `month` in EVERY year. February caps at 28
// so a financial year can never start on a date that some years lack; mirrors
// the tap_financial_year_start_valid CHECK in migration 137.
export function maxDayForMonth(month) {
  if (month === 2) return 28
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

function makeEnumValidator(key, allowed) {
  return (raw) => {
    if (raw === null || raw === undefined || raw === '') return { skip: true }
    if (!allowed.includes(raw)) return { error: `invalid_${key}` }
    return { value: raw }
  }
}

function validateVatRegistered(raw) {
  if (raw === null) return { value: null }
  if (raw === undefined || raw === '') return { skip: true }
  if (typeof raw !== 'boolean') return { error: 'invalid_vat_registered' }
  return { value: raw }
}

function validateLocalLegalFormLabel(raw) {
  if (raw === null || raw === undefined) return { value: null }
  if (typeof raw !== 'string') return { error: 'invalid_local_legal_form_label' }
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null }
  if (trimmed.length > LOCAL_LEGAL_FORM_LABEL_MAX) return { error: 'invalid_local_legal_form_label' }
  return { value: trimmed }
}

// The two code fields are country-dependent, so they take the profile's country
// rather than a fixed list.
function validateLocalLegalFormCode(raw, countryCode) {
  if (raw === null || raw === undefined || raw === '') return { value: null }
  if (!isKnownLocalLegalForm(countryCode, raw)) return { error: 'invalid_local_legal_form_code' }
  return { value: raw }
}

const SIMPLE_VALIDATORS = {
  local_legal_form_label: validateLocalLegalFormLabel,
  vat_filing_frequency: makeEnumValidator('vat_filing_frequency', VAT_FILING_FREQUENCIES),
  vat_registered: validateVatRegistered,
  default_vat_rate: (raw) => isKnownVatRate(raw)
    ? { value: Number(raw) }
    : { error: 'invalid_default_vat_rate' },
}

function parseFiscalPart(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) ? n : NaN
}

// The financial-year start is one fact in two columns, so it is validated as a
// pair against the effective (sent, else stored) values of both. Sending only
// the month must not leave a stored day-31 behind on a 30-day month.
function collectFiscalYearStart(body, current, updates) {
  const hasMonth = 'financial_year_start_month' in body
  const hasDay = 'financial_year_start_day' in body
  if (!hasMonth && !hasDay) return null

  const month = hasMonth ? parseFiscalPart(body.financial_year_start_month) : current.financial_year_start_month
  const day = hasDay ? parseFiscalPart(body.financial_year_start_day) : current.financial_year_start_day

  if (month === null || Number.isNaN(month) || month < 1 || month > 12) {
    return 'invalid_financial_year_start_month'
  }
  if (day === null || Number.isNaN(day) || day < 1 || day > 31) {
    return 'invalid_financial_year_start_day'
  }
  if (day > maxDayForMonth(month)) return 'invalid_financial_year_start'

  if (hasMonth) updates.financial_year_start_month = month
  if (hasDay) updates.financial_year_start_day = day
  return null
}

// Builds the accounting-profile UPDATE payload. `countryCode` and `current` come
// from the stored row (country is immutable, so it is never taken from the body).
// Returns { updates } or { error: '<code>' }.
export function buildAccountingProfileUpdate(body, { countryCode, current }) {
  const updates = {}

  for (const key of PATCHABLE_PROFILE_FIELDS) {
    if (!(key in body)) continue
    if (key === 'financial_year_start_month' || key === 'financial_year_start_day') continue

    const result = key === 'local_legal_form_code'
      ? validateLocalLegalFormCode(body[key], countryCode)
      : SIMPLE_VALIDATORS[key](body[key])

    if (result.error) return { error: result.error }
    if (result.skip) continue
    updates[key] = result.value
  }

  const fiscalError = collectFiscalYearStart(body, current, updates)
  if (fiscalError) return { error: fiscalError }

  return { updates }
}

// The local legal form is the one thing the tenant states here; the cross-country
// category and the reporting framework both follow from it, so both are DERIVED
// rather than trusted from the client. Otherwise a caller could pair `nl_bv` with
// `sole_trader` and the invoice disclosures would follow the wrong one.
//
// The framework is recomputed from the EFFECTIVE legal form on every patch, not
// only when the form changes. That is what backfills it for a legacy row whose
// legal_form was inherited from the old tenants column but which has no framework
// yet — the first save the tenant makes fills it in, with one owner for the rule.
//
// Mutates `updates`.
export function applyDerivedFields(updates, current, countryCode) {
  if ('local_legal_form_code' in updates) {
    updates.legal_form = updates.local_legal_form_code
      ? legalFormForLocalCode(countryCode, updates.local_legal_form_code)
      : null
  }

  const legalForm = 'legal_form' in updates ? updates.legal_form : current.legal_form
  const framework = defaultReportingFramework(countryCode, legalForm)
  if (framework !== current.reporting_framework_code) {
    updates.reporting_framework_code = framework
  }
}

// VAT rules. Only two things are asked: whether the band is VAT registered (a
// legal fact) and, if so, the filing period the tax authority assigned it.
//
// The VAT accounting basis is DERIVED, not asked: this application recognises VAT
// on the invoice date, so a registered band is on the invoice basis by
// construction. Offering 'cash' would record a tax point the ledger does not use.
// Supporting a cash VAT scheme (the Dutch kasstelsel and its equivalents) is a
// change to how VAT is posted, and that change would set this column.
//
// Mutates `updates` and returns an error code, or null when consistent.
export function applyVatDependencyRules(updates, current) {
  const registered = 'vat_registered' in updates ? updates.vat_registered : current.vat_registered

  const derivedBasis = vatBasisFor(registered)
  if (derivedBasis !== current.vat_accounting_basis) {
    updates.vat_accounting_basis = derivedBasis
  }

  if ('vat_registered' in updates) {
    if (registered === false) {
      // Confirmed not registered: there is no filing period to state.
      if (!('vat_filing_frequency' in updates)) updates.vat_filing_frequency = 'not_applicable'
    } else if (current.vat_filing_frequency === 'not_applicable'
      && !('vat_filing_frequency' in updates)) {
      // Registered, or back to unconfirmed: "not applicable" is no longer true, so
      // it goes back to unanswered rather than being guessed at.
      updates.vat_filing_frequency = 'unconfigured'
    }
  }

  const frequency = 'vat_filing_frequency' in updates ? updates.vat_filing_frequency : current.vat_filing_frequency

  if (REGISTERED_VAT_FILING_FREQUENCIES.includes(frequency) && registered !== true) {
    return 'vat_fields_require_registration'
  }
  if (frequency === 'not_applicable' && registered === true) {
    return 'vat_fields_required_when_registered'
  }

  return null
}

// The VAT tax point that matches how this application posts VAT, per registration
// state. NULL registration means the question is still open.
function vatBasisFor(registered) {
  if (registered === true) return 'invoice'
  if (registered === false) return 'not_applicable'
  return 'unknown'
}

// Field completeness: only the questions a tenant actually has to answer. The
// derived and product-fact columns are excluded because they are always set and
// were never asked (base_currency, entity_size, financial_accounting_basis,
// legal_form, reporting_framework_code, vat_accounting_basis). The filing
// frequency is conditional on the registration state, so a band that is not VAT
// registered is never made to claim one.
export function isProfileComplete(profile) {
  if (!profile.local_legal_form_code) return false
  if (profile.vat_registered === null || profile.vat_registered === undefined) return false

  return profile.vat_registered === true
    ? REGISTERED_VAT_FILING_FREQUENCIES.includes(profile.vat_filing_frequency)
    : profile.vat_filing_frequency === 'not_applicable'
}

// The state the UI renders. Completeness and provenance are separate columns, so
// the presentation state is derived once here rather than in each consumer.
export function profilePresentationState(profile) {
  if (profile.profile_status !== 'complete') return 'incomplete'
  return profile.reviewed_at ? 'complete' : 'needs_review'
}
