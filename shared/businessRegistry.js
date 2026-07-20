// Single source of truth for company / commercial registration numbers per
// country — the Chamber-of-Commerce equivalent of shared/vatRates.js. Consumed
// by the backend (profile validation) and the frontend (labels, placeholders,
// validation) so a tenant's registration number is stored in the right format
// for its VAT country and printed on invoices with the correct register label.
//
// Selected by the tenant's `vat_country` (same jurisdiction drives VAT and the
// register). Registers and identifier structures per the official national
// registers linked from the EU e-Justice Portal / BRIS (kvk.nl, handelsregister.de,
// INPI/RCS, Firmenbuch, CRO, Companies House, …).
//
// Shape per country:
//   label    — the register's own name (a proper noun; shown as-is, not translated)
//   pattern  — accepted format of the number (case-insensitive; trimmed input)
//   example  — sample number (placeholder / helper text)
//   office   — for court/city/province-scoped registers (DE/FR/AT/IT): the extra
//              identifier legally shown alongside the number, with its own label
//   sameAsVat — true where there is no separate number: the enterprise/tax number
//               IS the registration identifier (Belgium, Spain). No field shown.
import { DEFAULT_VAT_COUNTRY, normalizeVatCountry } from './vatRates.js'

export const BUSINESS_REGISTRY = Object.freeze({
  nl: { label: 'KvK-nummer', pattern: /^\d{8}$/, example: '12345678' },
  be: { sameAsVat: true },
  de: {
    label: 'Handelsregisternummer', pattern: /^HR[AB]\s?\d{1,6}$/i, example: 'HRB 12345',
    office: { label: 'Registergericht', example: 'Amtsgericht München' },
  },
  fr: {
    label: 'SIREN', pattern: /^\d{9}$/, example: '123456789',
    office: { label: 'RCS (ville)', example: 'RCS Paris' },
  },
  lu: { label: 'RCS', pattern: /^B\d{1,7}$/i, example: 'B123456' },
  at: {
    label: 'Firmenbuchnummer', pattern: /^FN\s?\d{1,6}[A-Z]$/i, example: 'FN 123456a',
    office: { label: 'Firmenbuchgericht', example: 'Handelsgericht Wien' },
  },
  es: { sameAsVat: true },
  it: {
    label: 'REA', pattern: /^\d{1,7}$/, example: '1234567',
    office: { label: 'Provincia (REA)', example: 'MI' },
  },
  ie: { label: 'CRO number', pattern: /^\d{5,7}$/, example: '123456' },
  gb: { label: 'Company number', pattern: /^(\d{8}|[A-Z]{2}\d{6})$/i, example: '12345678' },
})

// Legal forms a music group realistically takes. Only `company` (an
// incorporated, limited-liability entity in the commercial register) triggers
// the national company-law invoice disclosures — managing directors and the
// register court/number (Germany GmbHG §35a, France société mentions, …). Sole
// traders and partnerships owe only the EU Art. 226 essentials. Mirrors the
// CHECK in migration 127_tenant_legal_form.sql.
export const LEGAL_FORMS = Object.freeze([
  'sole_trader', 'partnership', 'company', 'association', 'other',
])

export function isKnownLegalForm(form) {
  return typeof form === 'string' && LEGAL_FORMS.includes(form)
}

// True when the legal form owes the company-law disclosures (managing directors,
// register court + number) on its invoices.
export function requiresCompanyDisclosure(legalForm) {
  return legalForm === 'company'
}

function registryFor(country) {
  return BUSINESS_REGISTRY[normalizeVatCountry(country) ?? DEFAULT_VAT_COUNTRY]
}

// Trim and collapse internal whitespace; registration numbers keep their letters
// and case (e.g. Austria's lowercase check letter), so we do not uppercase.
export function normalizeRegistrationNumber(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

// True where the country has no distinct registration number (the enterprise /
// tax number serves as the identifier), so no separate field is shown.
export function registrationSameAsVat(country) {
  return registryFor(country).sameAsVat === true
}

// True where the register is court/city/province-scoped and that office is shown
// alongside the number on invoices (Germany, France, Austria, Italy).
export function registrationUsesOffice(country) {
  return Boolean(registryFor(country).office)
}

export function getRegistrationLabel(country) {
  return registryFor(country).label ?? null
}

export function getRegistrationExample(country) {
  return registryFor(country).example ?? ''
}

export function getRegistrationOfficeLabel(country) {
  return registryFor(country).office?.label ?? null
}

export function getRegistrationOfficeExample(country) {
  return registryFor(country).office?.example ?? ''
}

// Validates a registration number for the country. For sameAsVat countries only
// an empty value is valid (there is no separate number). Input is normalized
// (trim + collapse spaces) before matching.
export function isValidRegistrationNumber(country, value) {
  const cfg = registryFor(country)
  const v = normalizeRegistrationNumber(value)
  if (cfg.sameAsVat) return v === ''
  if (v === '') return true // empty clears the field
  return cfg.pattern.test(v)
}
