import { createMollieClient } from '@mollie/api-client'

export function createTenantMollieClient(mollieApiKey) {
  return createMollieClient({ apiKey: mollieApiKey })
}

export function assertMollieConfigured(tenant) {
  if (!tenant?.mollie_api_key) {
    const err = new Error('Mollie API key not configured for this tenant')
    err.status = 400
    err.code = 'mollie_key_missing'
    throw err
  }
}

// Converts an integer cent amount to the string Mollie expects: "24.95" for 2495 cents.
export function formatMollieAmountFromCents(totalCents) {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error('totalCents must be a non-negative integer')
  }
  const euros = Math.floor(totalCents / 100)
  const cents = totalCents % 100
  return `${euros}.${String(cents).padStart(2, '0')}`
}
