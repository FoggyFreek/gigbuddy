// Single source of truth for VAT SCHEMES: the small-business and cross-border
// regimes a tenant can be enrolled in, and the treatment each one produces.
// Consumed by the backend (enrolment validation, VAT-treatment resolution) and
// the frontend (scheme dropdown) via the typed wrapper in src/utils/taxSchemes.ts.
//
// Not yet part of the versioned country pack; folding it in is one of the
// expansions listed in shared/countryPack.js.
//
// Why a registry and not a boolean: ten country packs need their own national
// exemptions, and the cross-border EU SME scheme is per-DESTINATION, so several
// enrolments coexist. Which is why every entry declares a `scope`: only a
// `national_home` scheme governs the tenant's domestic VAT treatment and its
// filing obligation. A destination-country EU SME exemption must never stop the
// home returns — the two regimes are deliberately separate.
//
// ---------------------------------------------------------------------------
// The immutability argument, because it is easy to get wrong:
//
// This module is MUTABLE. A country pack will later flip `implemented` from
// false to true, add schemes, and retire codes. That must not move a document
// issued years earlier. The guarantee therefore does NOT come from versioning
// the rules — it comes from PERSISTING THE OUTCOME: an issued invoice and an
// approved purchase store the resolved treatment on the row, and no read of a
// historical document ever calls back into this module.
//
// `TAX_TREATMENT_VERSION` records WHICH rule set decided a stored outcome, for
// audit and for explaining a past resolution. Nothing renders from it.
// `resolveVatTreatment` throws on any version but the current one, so bumping it
// is an explicit act rather than a silent reinterpretation.
// ---------------------------------------------------------------------------
//
// Treatment vocabulary is the country-pack spec's (§5.4). `small_business_exempt`
// is deliberately NOT `zero_rated`: a zero rate keeps the input-VAT credit, an
// exemption does not, and the two land in different return boxes.
//
// Labels are the local legal term — proper nouns, shown as-is and never
// translated, the same convention shared/accountingProfileCodes.js uses.

import { isEuVatCountry, normalizeVatCountry } from './vatRates.js'
// The existing date-only normalizer (Postgres hands a DATE back as a Date). Its
// name is UBL-flavoured but the behavior is generic, and duplicating it would
// give the same normalization two owners.
import { toUblDate as toDateOnly } from './peppol.js'

export const TAX_TREATMENTS = Object.freeze([
  'standard',
  'reduced',
  'zero_rated',
  'exempt_no_credit',
  'outside_scope',
  'reverse_charge',
  'small_business_exempt',
])

export const SCHEME_SCOPES = Object.freeze(['national_home', 'eu_sme_destination'])

// Seeded conservatively: a country gets an entry only where a scheme you
// actually ENROL IN exists. ES/IE/GB are absent on purpose — below the
// registration threshold you are simply not registered, which is a different
// fact and already expressed by `vat_registered` on the accounting profile.
// Widening this list is a country-pack decision, not a guess made here.
//
// `implemented: false` means RECORDED, NO BEHAVIOR: the enrolment is stored and
// shown, the snapshot keeps the code as provenance, and the invoice code does
// nothing differently. Only nl_kor is implemented, matching korApplies() in
// shared/vatRates.js. The UI states this plainly rather than implying coverage.
export const TAX_SCHEMES = Object.freeze({
  nl_kor: {
    country: 'nl',
    scope: 'national_home',
    label: 'Kleineondernemersregeling (KOR)',
    salesTreatment: 'small_business_exempt',
    inputVatRecoverable: false,
    implemented: true,
  },
  be_franchise: {
    country: 'be',
    scope: 'national_home',
    label: 'Vrijstellingsregeling kleine ondernemingen / Régime de la franchise',
    salesTreatment: 'small_business_exempt',
    inputVatRecoverable: false,
    implemented: false,
  },
  de_kleinunternehmer: {
    country: 'de',
    scope: 'national_home',
    label: 'Kleinunternehmerregelung (§19 UStG)',
    salesTreatment: 'small_business_exempt',
    inputVatRecoverable: false,
    implemented: false,
  },
  at_kleinunternehmer: {
    country: 'at',
    scope: 'national_home',
    label: 'Kleinunternehmerregelung (§6 Abs 1 Z 27 UStG)',
    salesTreatment: 'small_business_exempt',
    inputVatRecoverable: false,
    implemented: false,
  },
  fr_franchise_en_base: {
    country: 'fr',
    scope: 'national_home',
    label: 'Franchise en base de TVA',
    salesTreatment: 'small_business_exempt',
    inputVatRecoverable: false,
    implemented: false,
  },
  lu_franchise: {
    country: 'lu',
    scope: 'national_home',
    label: 'Régime de franchise',
    salesTreatment: 'small_business_exempt',
    inputVatRecoverable: false,
    implemented: false,
  },
  it_forfettario: {
    country: 'it',
    scope: 'national_home',
    label: 'Regime forfettario',
    salesTreatment: 'small_business_exempt',
    inputVatRecoverable: false,
    implemented: false,
  },
  // Cross-border, per destination member state, and NOT a normal VAT
  // registration. Its enrolment row carries the DESTINATION country, which is
  // why the open-enrolment key includes country_code.
  eu_sme: {
    country: '*',
    scope: 'eu_sme_destination',
    perDestination: true,
    label: 'EU SME scheme (Directive (EU) 2020/285)',
    salesTreatment: 'small_business_exempt',
    inputVatRecoverable: false,
    implemented: false,
  },
})

export const TAX_TREATMENT_VERSION = 1

// The registry entry for a code, or null. Never throws: a historical row may
// reference a code a later pack retired.
export function getTaxScheme(code) {
  if (typeof code !== 'string') return null
  return TAX_SCHEMES[code] ?? null
}

// The schemes selectable for a country, in display order: its own national
// scheme first, then the per-destination EU SME scheme for EU countries.
export function getTaxSchemes(country) {
  const normalized = normalizeVatCountry(country)
  if (!normalized) return []
  const entries = []
  for (const [code, scheme] of Object.entries(TAX_SCHEMES)) {
    if (scheme.scope === 'national_home' && scheme.country === normalized) {
      entries.push({ code, ...scheme })
    }
  }
  if (isEuVatCountry(normalized)) {
    for (const [code, scheme] of Object.entries(TAX_SCHEMES)) {
      if (scheme.scope === 'eu_sme_destination') entries.push({ code, ...scheme })
    }
  }
  return entries
}

// True when `code` is enrollable for that exact country. There is NO fallback to
// the default country: an unknown jurisdiction must never borrow another
// country's schemes and pass validation.
export function isKnownTaxScheme(country, code) {
  const normalized = normalizeVatCountry(country)
  if (!normalized) return false
  return getTaxSchemes(normalized).some((scheme) => scheme.code === code)
}

// The JS mirror of the repository's SQL predicate. `valid_to` is INCLUSIVE —
// tax authorities state end dates inclusively ("your KOR ends 31 December
// 2025"), and a half-open column would silently mistranslate the date every user
// types off their letter. A voided enrolment is never resolved through:
// corrections are forward-only.
//
// A test asserts this and the SQL agree on both boundary days. Change neither
// alone.
export function enrolmentCoversDate(enrolment, date) {
  if (!enrolment || enrolment.voided_at) return false
  const on = toDateOnly(date)
  const from = toDateOnly(enrolment.valid_from)
  if (!on || !from || from > on) return false
  const to = toDateOnly(enrolment.valid_to)
  return to === null || to >= on
}

// Decides the VAT treatment of ONE document from the home-national enrolment in
// force at its tax point. The caller persists the result on the document; this
// is never re-run to read a historical row (see the module header).
//
// `homeEnrolment` is the national_home enrolment or null. A destination-scoped
// enrolment is a programming error here: EU SME exemptions depend on the
// customer's country and never govern domestic treatment.
export function resolveVatTreatment({ version = TAX_TREATMENT_VERSION, homeEnrolment = null, reverseCharge = false } = {}) {
  if (version !== TAX_TREATMENT_VERSION) {
    throw new Error(`unknown_vat_treatment_version: ${version}`)
  }
  if (homeEnrolment && homeEnrolment.scheme_scope !== 'national_home') {
    throw new Error('resolveVatTreatment requires a national_home enrolment')
  }

  const scheme = homeEnrolment ? getTaxScheme(homeEnrolment.scheme_code) : null
  // An unimplemented scheme has no effect at all. The snapshot still records the
  // code, so the fact survives; recording a treatment the invoice code does not
  // perform would misstate what the document actually was.
  const active = Boolean(scheme?.implemented)
  const schemeExempt = active && scheme.salesTreatment === 'small_business_exempt'

  let salesTreatment = 'standard'
  if (reverseCharge) salesTreatment = 'reverse_charge'
  else if (active) salesTreatment = scheme.salesTreatment

  return {
    schemeCode: homeEnrolment?.scheme_code ?? null,
    salesTreatment,
    // Whether the SCHEME alone suppresses output VAT — this is what feeds
    // computeInvoiceTotals' `appliesKor` argument, which takes reverse charge as
    // its own separate input.
    schemeExempt,
    // The EFFECTIVE outcome, reverse charge included. This is the persisted one.
    chargesOutputVat: !schemeExempt && !reverseCharge,
    // A separate fact from the sales side: under an exemption the supplier still
    // charges VAT and the buyer simply cannot deduct it. Reverse charge on our
    // own sales says nothing about our purchases.
    inputVatRecoverable: active ? scheme.inputVatRecoverable : true,
    version,
  }
}
