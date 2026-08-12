// Small pure helpers shared across the billing service, ingestion, saga, and
// scheduler. No provider or DB coupling here.
import { isMollieWebhookDisabled } from '../../finance/invoices/molliePaymentLinkService.js'

export const MANDATE_AMOUNT_CENTS = 1 // €0.01 mandate-establishing first payment
export const TRIAL_DAYS = 7

// Pricing semantics (migration 100 / planService): null = interval unavailable,
// 0 = free fallback only, > 0 = paid. Returns the cents for the chosen interval.
export function priceForInterval(plan, interval) {
  return interval === 'year' ? plan.yearly_price_cents : plan.monthly_price_cents
}

// Fallback period end when the provider hasn't given an authoritative
// nextPaymentDate yet. UTC month/year arithmetic.
export function periodEndFrom(start, interval) {
  const d = new Date(start)
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d
}

export function trialEndFrom(now = new Date()) {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() + TRIAL_DAYS)
  return d
}

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
}

// Where the hosted checkout returns the browser. 'billing' is the settings
// billing page (the old bare `/billing` was never a frontend route);
// 'onboarding' resumes the onboarding stepper's processing state.
//
// The audience names which product was just bought. Without it the return page
// polls "the" subscription and a user who already holds a settled subscription
// on the OTHER ladder would see instant success for a payment still in flight.
export function billingRedirectUrl(target = 'billing', audience = null) {
  const path = target === 'onboarding' ? '/onboarding' : '/settings/billing'
  const suffix = audience ? `&audience=${encodeURIComponent(audience)}` : ''
  return `${appUrl()}${path}?checkout=return${suffix}`
}

// Webhook URL carries the local subscription id as a routing hint only — status
// is always authoritatively re-fetched from the provider. Omitted when the
// webhook is disabled for local dev (the sync button drives ingestion instead).
export function billingWebhookUrl(subscriptionId) {
  if (isMollieWebhookDisabled()) return null
  const base = (process.env.MOLLIE_WEBHOOK_BASE_URL || appUrl()).replace(/\/$/, '')
  return `${base}/api/public/billing/mollie/webhook?subscription=${subscriptionId}`
}

// Provider metadata for reconciliation (task 9 adopts orphaned ops by matching
// these). No PII.
export function billingMetadata(subscriptionId, purpose) {
  return { subscriptionId: String(subscriptionId), purpose }
}

// Deterministic idempotency keys: stable across retries of the SAME logical
// operation, distinct across different ones. billing_operations.idempotency_key
// is UNIQUE and the same key is handed to the provider.
export const idemKeys = {
  ensureCustomer: (userId) => `customer:${userId}`,
  mandatePayment: (subId) => `mandate-pay:${subId}`,
  createSubscriptionInit: (subId) => `sub-create:${subId}:init`,
  createSubscription: (subId, amountCents, interval, startIso) =>
    `sub-create:${subId}:${amountCents}:${interval}:${startIso}`,
  cancelSubscription: (subId, providerSubId) => `sub-cancel:${subId}:${providerSubId}`,
  planChangeCharge: (subId, planId, interval) => `plan-charge:${subId}:${planId}:${interval}`,
}
