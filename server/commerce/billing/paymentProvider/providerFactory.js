import { createMollieTypescriptProvider } from './adapters/mollieTypescript/MollieTypescriptProvider.js'

let override = null
let cached = null

export function createPaymentProvider(apiKey) {
  return createMollieTypescriptProvider(apiKey)
}

function buildProvider() {
  return createPaymentProvider(process.env.PLATFORM_MOLLIE_API_KEY)
}

export function getPaymentProvider() {
  if (override) return override
  if (!cached) cached = buildProvider()
  return cached
}

export function isPlatformBillingConfigured() {
  if (override) return true
  return Boolean(process.env.PLATFORM_MOLLIE_API_KEY)
}

export function setPaymentProviderForTests(provider) {
  override = provider
}

export function resetPaymentProvider() {
  override = null
  cached = null
}
