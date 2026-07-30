// Typed frontend accessor over shared/taxSchemes.js — the VAT scheme registry.
// Drives the scheme dropdown in the accounting-profile settings section, which is
// country-filtered so a tenant can never enrol in another jurisdiction's scheme.
//
// The frontend only ever reads the registry for LABELS and for what is
// selectable. Treatment resolution is a server concern: the outcome is persisted
// on the document, never re-derived in the browser.
import {
  getTaxScheme as getTaxSchemeJs,
  getTaxSchemes as getTaxSchemesJs,
  isKnownTaxScheme as isKnownTaxSchemeJs,
} from '../../shared/taxSchemes.js'

export type TaxTreatment =
  | 'standard'
  | 'reduced'
  | 'zero_rated'
  | 'exempt_no_credit'
  | 'outside_scope'
  | 'reverse_charge'
  | 'small_business_exempt'

export type SchemeScope = 'national_home' | 'eu_sme_destination'

export interface TaxScheme {
  country: string
  scope: SchemeScope
  label: string
  salesTreatment: TaxTreatment
  inputVatRecoverable: boolean
  implemented: boolean
  perDestination?: boolean
}

export interface TaxSchemeOption extends TaxScheme {
  code: string
}

export function getTaxScheme(code: string | null | undefined): TaxScheme | null {
  return getTaxSchemeJs(code ?? undefined) as TaxScheme | null
}

export function getTaxSchemes(country: string | null | undefined): readonly TaxSchemeOption[] {
  return getTaxSchemesJs(country ?? undefined) as readonly TaxSchemeOption[]
}

export function isKnownTaxScheme(
  country: string | null | undefined,
  code: string | null | undefined,
): boolean {
  return isKnownTaxSchemeJs(country ?? undefined, code ?? undefined) as boolean
}
