import { createMollieClient } from '@mollie/api-client'

export function createTenantMollieClient(mollieApiKey) {
  return createMollieClient({ apiKey: mollieApiKey })
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
