import { normalizeRegistrationNumber } from '../../shared/businessRegistry.js'
import { normalizeVatNumber } from '../../shared/vatRates.js'

export function normalizeOptionalRegistrationNumber(value) {
  const normalized = normalizeRegistrationNumber(value)
  return normalized || null
}

export function normalizeOptionalVatId(value) {
  const normalized = normalizeVatNumber(value)
  return normalized || null
}
