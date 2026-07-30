// Single source of truth for the stable per-country codes on a tenant's
// accounting profile: the exact LOCAL legal form and the applicable REPORTING
// FRAMEWORK. Consumed by the backend (profile validation) and the frontend
// (dropdown options) via the typed wrapper in src/utils/accountingProfileCodes.ts.
//
// Why codes and not free text: both fields are meant to drive later behavior
// (statutory report templates, legal-form chart overlays, filing populations).
// Free text cannot be switched on. The label is display-only.
//
// `legal_form` on the profile stays the cross-country abstraction
// (sole_trader | partnership | company | association | other, see
// shared/businessRegistry.js). These codes are the local form UNDER that
// abstraction, so each entry declares which abstraction it belongs to and the UI
// can offer a coherent pair.
//
// Labels are the local legal/official term — proper nouns, shown as-is and not
// translated, the same convention shared/businessRegistry.js uses for register
// names. Framework labels name the standard, not a marketing tier.
//
// These tables become country-pack-owned when the pack registry lands; the codes
// are chosen now so they survive that move unchanged. Selecting a code asserts
// nothing about eligibility — that remains the user's or their accountant's
// statement.

import { DEFAULT_VAT_COUNTRY, normalizeVatCountry } from './vatRates.js'

// country -> { localLegalForms: [{ code, label, legalForm }], reportingFrameworks: [{ code, label }] }
export const ACCOUNTING_PROFILE_CODES = Object.freeze({
  nl: {
    localLegalForms: [
      { code: 'nl_eenmanszaak', label: 'Eenmanszaak', legalForm: 'sole_trader' },
      { code: 'nl_vof', label: 'VOF', legalForm: 'partnership' },
      { code: 'nl_maatschap', label: 'Maatschap', legalForm: 'partnership' },
      { code: 'nl_bv', label: 'BV', legalForm: 'company' },
      { code: 'nl_vereniging', label: 'Vereniging', legalForm: 'association' },
      { code: 'nl_stichting', label: 'Stichting', legalForm: 'association' },
    ],
    reportingFrameworks: [
      { code: 'nl_bw2t9_micro', label: 'BW 2 Titel 9 — micro' },
      { code: 'nl_bw2t9_small', label: 'BW 2 Titel 9 — klein' },
    ],
  },
  be: {
    localLegalForms: [
      { code: 'be_eenmanszaak', label: 'Eenmanszaak / Entreprise individuelle', legalForm: 'sole_trader' },
      { code: 'be_vof', label: 'VOF / SNC', legalForm: 'partnership' },
      { code: 'be_bv', label: 'BV / SRL', legalForm: 'company' },
      { code: 'be_vzw', label: 'VZW / ASBL', legalForm: 'association' },
    ],
    reportingFrameworks: [
      { code: 'be_nbb_micro', label: 'NBB/BNB — microschema' },
      { code: 'be_nbb_abbreviated', label: 'NBB/BNB — verkort schema' },
      { code: 'be_association_simplified', label: 'Vereenvoudigde verenigingsboekhouding' },
    ],
  },
  de: {
    localLegalForms: [
      { code: 'de_einzelunternehmen', label: 'Einzelunternehmen', legalForm: 'sole_trader' },
      { code: 'de_gbr', label: 'GbR', legalForm: 'partnership' },
      { code: 'de_gmbh', label: 'GmbH', legalForm: 'company' },
      { code: 'de_ug', label: 'UG (haftungsbeschränkt)', legalForm: 'company' },
      { code: 'de_ev', label: 'e.V.', legalForm: 'association' },
    ],
    reportingFrameworks: [
      { code: 'de_eur', label: 'Einnahmen-Überschuss-Rechnung (§4(3) EStG)' },
      { code: 'de_hgb_micro', label: 'HGB — Kleinstkapitalgesellschaft' },
      { code: 'de_hgb_small', label: 'HGB — kleine Kapitalgesellschaft' },
    ],
  },
  fr: {
    localLegalForms: [
      { code: 'fr_entrepreneur_individuel', label: 'Entrepreneur individuel', legalForm: 'sole_trader' },
      { code: 'fr_micro_entrepreneur', label: 'Micro-entrepreneur', legalForm: 'sole_trader' },
      { code: 'fr_snc', label: 'SNC', legalForm: 'partnership' },
      { code: 'fr_sarl', label: 'SARL / EURL', legalForm: 'company' },
      { code: 'fr_sas', label: 'SAS / SASU', legalForm: 'company' },
      { code: 'fr_association', label: 'Association loi 1901', legalForm: 'association' },
    ],
    reportingFrameworks: [
      { code: 'fr_pcg_micro', label: 'PCG — système abrégé' },
      { code: 'fr_pcg_simplified', label: 'PCG — système de base' },
      { code: 'fr_pcg_normal', label: 'PCG — système développé' },
    ],
  },
  lu: {
    localLegalForms: [
      { code: 'lu_entreprise_individuelle', label: 'Entreprise individuelle', legalForm: 'sole_trader' },
      { code: 'lu_sencs', label: 'SENC / SECS', legalForm: 'partnership' },
      { code: 'lu_sarl', label: 'SARL / SARL-S', legalForm: 'company' },
      { code: 'lu_asbl', label: 'ASBL', legalForm: 'association' },
    ],
    reportingFrameworks: [
      { code: 'lu_ecdf_abbreviated', label: 'eCDF — comptes abrégés' },
      { code: 'lu_ecdf_standard', label: 'eCDF — comptes complets' },
    ],
  },
  at: {
    localLegalForms: [
      { code: 'at_einzelunternehmen', label: 'Einzelunternehmen', legalForm: 'sole_trader' },
      { code: 'at_gesbr', label: 'GesbR', legalForm: 'partnership' },
      { code: 'at_og', label: 'OG / KG', legalForm: 'partnership' },
      { code: 'at_gmbh', label: 'GmbH / FlexKapG', legalForm: 'company' },
      { code: 'at_verein', label: 'Verein', legalForm: 'association' },
    ],
    reportingFrameworks: [
      { code: 'at_eur', label: 'Einnahmen-Ausgaben-Rechnung' },
      { code: 'at_ugb_small', label: 'UGB — kleine Kapitalgesellschaft' },
    ],
  },
  es: {
    localLegalForms: [
      { code: 'es_autonomo', label: 'Autónomo', legalForm: 'sole_trader' },
      { code: 'es_sociedad_civil', label: 'Sociedad civil', legalForm: 'partnership' },
      { code: 'es_sl', label: 'SL / SLU', legalForm: 'company' },
      { code: 'es_asociacion', label: 'Asociación', legalForm: 'association' },
    ],
    reportingFrameworks: [
      { code: 'es_pgc_pymes', label: 'PGC de PYMES' },
      { code: 'es_pgc', label: 'Plan General de Contabilidad' },
    ],
  },
  it: {
    localLegalForms: [
      { code: 'it_ditta_individuale', label: 'Ditta individuale', legalForm: 'sole_trader' },
      { code: 'it_professionista', label: 'Libero professionista', legalForm: 'sole_trader' },
      { code: 'it_snc', label: 'SNC / SAS', legalForm: 'partnership' },
      { code: 'it_srl', label: 'SRL / SRLS', legalForm: 'company' },
      { code: 'it_associazione', label: 'Associazione', legalForm: 'association' },
    ],
    reportingFrameworks: [
      { code: 'it_oic_micro', label: 'OIC — micro-imprese (art. 2435-ter)' },
      { code: 'it_oic_abbreviated', label: 'OIC — bilancio abbreviato (art. 2435-bis)' },
    ],
  },
  ie: {
    localLegalForms: [
      { code: 'ie_sole_trader', label: 'Sole trader', legalForm: 'sole_trader' },
      { code: 'ie_partnership', label: 'Partnership', legalForm: 'partnership' },
      { code: 'ie_ltd', label: 'Private company limited by shares (LTD)', legalForm: 'company' },
      { code: 'ie_clg', label: 'Company limited by guarantee (CLG) / charity', legalForm: 'association' },
    ],
    reportingFrameworks: [
      { code: 'ie_frs105', label: 'FRS 105 — micro-entities' },
      { code: 'ie_frs102_1a', label: 'FRS 102 Section 1A — small entities' },
    ],
  },
  gb: {
    localLegalForms: [
      { code: 'gb_sole_trader', label: 'Sole trader', legalForm: 'sole_trader' },
      { code: 'gb_partnership', label: 'Partnership', legalForm: 'partnership' },
      { code: 'gb_ltd', label: 'Private limited company (Ltd)', legalForm: 'company' },
      { code: 'gb_cio', label: 'Charity / CIO', legalForm: 'association' },
    ],
    reportingFrameworks: [
      { code: 'gb_frs105', label: 'FRS 105 — micro-entities' },
      { code: 'gb_frs102_1a', label: 'FRS 102 Section 1A — small entities' },
    ],
  },
})

function codesFor(country) {
  return ACCOUNTING_PROFILE_CODES[normalizeVatCountry(country) ?? DEFAULT_VAT_COUNTRY]
}

// The local legal forms selectable for a country, in display order.
export function getLocalLegalForms(country) {
  return codesFor(country).localLegalForms
}

// The reporting frameworks selectable for a country, in display order
// (smallest/simplest first — that is the realistic case for a band).
export function getReportingFrameworks(country) {
  return codesFor(country).reportingFrameworks
}

// True when `code` is a local legal form of that exact country. There is NO
// fallback to the default country: an unknown jurisdiction must never borrow
// another country's forms and pass validation.
export function isKnownLocalLegalForm(country, code) {
  const cfg = ACCOUNTING_PROFILE_CODES[normalizeVatCountry(country)]
  if (!cfg || typeof code !== 'string') return false
  return cfg.localLegalForms.some((f) => f.code === code)
}

export function isKnownReportingFramework(country, code) {
  const cfg = ACCOUNTING_PROFILE_CODES[normalizeVatCountry(country)]
  if (!cfg || typeof code !== 'string') return false
  return cfg.reportingFrameworks.some((f) => f.code === code)
}

// The cross-country abstraction a local form belongs to, or null when unknown.
// Lets the UI keep `legal_form` and `local_legal_form_code` consistent.
export function legalFormForLocalCode(country, code) {
  const cfg = ACCOUNTING_PROFILE_CODES[normalizeVatCountry(country)]
  return cfg?.localLegalForms.find((f) => f.code === code)?.legalForm ?? null
}

// The base currency a country's accounting is kept in. Sterling for the UK,
// euro for the nine euro-area/EU packs.
export function defaultBaseCurrency(country) {
  return normalizeVatCountry(country) === 'gb' ? 'GBP' : 'EUR'
}

// The reporting framework a micro entity in this country falls under, keyed on
// whether it is incorporated. It is DERIVED rather than asked: for a band-sized
// entity the framework follows from the jurisdiction and the legal form, and it is
// not a question most users could answer.
//
// The split that matters is incorporated vs not. An unincorporated German or
// Austrian business keeps an Einnahmen-Überschuss-/Einnahmen-Ausgaben-Rechnung
// rather than HGB/UGB accounts, and a Belgian association has its own simplified
// regime — so those get their own entry. Everywhere else the micro/abbreviated
// scheme covers both.
const DEFAULT_REPORTING_FRAMEWORK = Object.freeze({
  nl: { default: 'nl_bw2t9_micro' },
  be: { default: 'be_nbb_micro', association: 'be_association_simplified' },
  de: { default: 'de_eur', company: 'de_hgb_micro' },
  fr: { default: 'fr_pcg_micro' },
  lu: { default: 'lu_ecdf_abbreviated' },
  at: { default: 'at_eur', company: 'at_ugb_small' },
  es: { default: 'es_pgc_pymes' },
  it: { default: 'it_oic_micro' },
  ie: { default: 'ie_frs105' },
  gb: { default: 'gb_frs105' },
})

// Returns the framework code, or null when the legal form is not yet known (there
// is nothing to derive from, and guessing would state a reporting regime the
// tenant never chose).
export function defaultReportingFramework(country, legalForm) {
  const cfg = DEFAULT_REPORTING_FRAMEWORK[normalizeVatCountry(country)]
  if (!cfg || !legalForm) return null
  return cfg[legalForm] ?? cfg.default
}
