import { createMollieLegacyProvider } from './adapters/mollieLegacy/MollieLegacyProvider.js'

let override = null
let cached = null

function buildProvider() {
  const kind = process.env.BILLING_PROVIDER || 'mollie'
  if (kind === 'mollie') return createMollieLegacyProvider(process.env.PLATFORM_MOLLIE_API_KEY)
  throw new Error(`Unknown BILLING_PROVIDER: ${kind}`)
}

export function getPaymentProvider() {
  if (override) return override
  if (!cached) cached = buildProvider()
  return cached
}

export function isPlatformBillingConfigured() {
  if (override) return true
  const kind = process.env.BILLING_PROVIDER || 'mollie'
  return kind === 'mollie' && Boolean(process.env.PLATFORM_MOLLIE_API_KEY)
}

export function setPaymentProviderForTests(provider) {
  override = provider
}

export function resetPaymentProvider() {
  override = null
  cached = null
}
