// Typed frontend accessor over shared/businessRegistry.js — the company /
// commercial registration counterpart of src/utils/vatRates.ts. Drives the
// per-country label, placeholder and validation of the registration-number field
// and its court/city/province companion.
import {
  getRegistrationLabel as getRegistrationLabelJs,
  getRegistrationExample as getRegistrationExampleJs,
  getRegistrationOfficeLabel as getRegistrationOfficeLabelJs,
  getRegistrationOfficeExample as getRegistrationOfficeExampleJs,
  registrationSameAsVat as registrationSameAsVatJs,
  registrationUsesOffice as registrationUsesOfficeJs,
  isValidRegistrationNumber as isValidRegistrationNumberJs,
} from '../../shared/businessRegistry.js'

export function getRegistrationLabel(country: string | null | undefined): string | null {
  return getRegistrationLabelJs(country ?? undefined) as string | null
}

export function getRegistrationExample(country: string | null | undefined): string {
  return getRegistrationExampleJs(country ?? undefined) as string
}

export function getRegistrationOfficeLabel(country: string | null | undefined): string | null {
  return getRegistrationOfficeLabelJs(country ?? undefined) as string | null
}

export function getRegistrationOfficeExample(country: string | null | undefined): string {
  return getRegistrationOfficeExampleJs(country ?? undefined) as string
}

export function registrationSameAsVat(country: string | null | undefined): boolean {
  return registrationSameAsVatJs(country ?? undefined) as boolean
}

export function registrationUsesOffice(country: string | null | undefined): boolean {
  return registrationUsesOfficeJs(country ?? undefined) as boolean
}

export function isValidRegistrationNumber(country: string | null | undefined, value: string): boolean {
  return isValidRegistrationNumberJs(country ?? undefined, value) as boolean
}
