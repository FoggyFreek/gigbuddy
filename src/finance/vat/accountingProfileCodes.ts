// Typed frontend accessor over shared/accountingProfileCodes.js — the accounting
// profile's per-country code tables. Drives the local-legal-form and
// reporting-framework dropdowns, which are country-filtered so a tenant can never
// pick another jurisdiction's form.
import {
  getLocalLegalForms as getLocalLegalFormsJs,
  getReportingFrameworks as getReportingFrameworksJs,
  legalFormForLocalCode as legalFormForLocalCodeJs,
  defaultBaseCurrency as defaultBaseCurrencyJs,
} from '../../../shared/accountingProfileCodes.js'
import type { LegalForm } from '../../utils/businessRegistry.ts'

export interface LocalLegalFormOption {
  code: string
  label: string
  legalForm: LegalForm
}

export interface ReportingFrameworkOption {
  code: string
  label: string
}

export function getLocalLegalForms(country: string | null | undefined): readonly LocalLegalFormOption[] {
  return getLocalLegalFormsJs(country ?? undefined) as readonly LocalLegalFormOption[]
}

export function getReportingFrameworks(country: string | null | undefined): readonly ReportingFrameworkOption[] {
  return getReportingFrameworksJs(country ?? undefined) as readonly ReportingFrameworkOption[]
}

export function legalFormForLocalCode(
  country: string | null | undefined,
  code: string | null | undefined,
): LegalForm | null {
  return legalFormForLocalCodeJs(country ?? undefined, code ?? undefined) as LegalForm | null
}

export function defaultBaseCurrency(country: string | null | undefined): string {
  return defaultBaseCurrencyJs(country ?? undefined) as string
}
