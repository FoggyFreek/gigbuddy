// Payment-provider factory. The billing service and scheduler import
// getPaymentProvider() and never a concrete adapter, so switching processors is
// a one-line change here plus a new adapter file. Selection is by the
// BILLING_PROVIDER env var (default 'mollie').
import { MollieProvider } from './mollieProvider.js'

export { PAYMENT_STATUS, SUBSCRIPTION_STATUS, BILLING_INTERVAL, NONTERMINAL_PAYMENT_STATUSES } from './statuses.js'
export { PaymentProviderError, BillingNotConfiguredError } from './PaymentProviderError.js'
export { PaymentProvider } from './PaymentProvider.js'

let override = null
let cached = null

function build() {
  const kind = process.env.BILLING_PROVIDER || 'mollie'
  switch (kind) {
    case 'mollie':
      return new MollieProvider(process.env.PLATFORM_MOLLIE_API_KEY)
    default:
      throw new Error(`Unknown BILLING_PROVIDER: ${kind}`)
  }
}

export function getPaymentProvider() {
  if (override) return override
  if (!cached) cached = build()
  return cached
}

export function isPlatformBillingConfigured() {
  return getPaymentProvider().isConfigured()
}

// Test seam: inject a fake provider (billing tests run without real credentials).
export function setPaymentProviderForTests(provider) {
  override = provider
}

export function resetPaymentProvider() {
  override = null
  cached = null
}
