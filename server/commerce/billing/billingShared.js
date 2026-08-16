// Small pure helpers shared across the billing service, ingestion, saga, and
// scheduler. No provider or DB coupling here.
import { isMollieWebhookDisabled } from '../../finance/invoices/molliePaymentLinkService.js'

// The free trial: 30 days, once per user, Gold tier only, one starter module
// (a second may be added during it without extending it). No payment and no
// provider schedule exist until the customer converts.
export const TRIAL_DAYS = 30

// Customer-present first payment used to establish a reusable mandate. This is
// not the subscription charge; the provider schedule starts at trial end.
export const MANDATE_VERIFICATION_CENTS = 1

// After a cycle-opening charge (conversion or renewal) the customer may cancel
// immediately and get that charge back in full. Outside the window a
// cancellation runs to the period end with no refund.
export const REFUND_WINDOW_DAYS = 5

// Pricing semantics live with the pricing engine so the frontend preview and
// the server charge read the same column for the same interval.
export { priceForInterval } from '../../../shared/pricing.js'

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

export function refundWindowEndsAt(lastChargeAt) {
  if (!lastChargeAt) return null
  const d = new Date(lastChargeAt)
  d.setUTCDate(d.getUTCDate() + REFUND_WINDOW_DAYS)
  return d
}

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
}

// Where the hosted checkout returns the browser. 'billing' is the settings
// billing page; 'onboarding' resumes the onboarding stepper's processing state.
//
// No audience qualifier any more: there is one subscription, so the return page
// polls the only thing that could have been paid for.
export function billingRedirectUrl(target = 'billing') {
  const path = target === 'onboarding' ? '/onboarding' : '/settings/billing'
  return `${appUrl()}${path}?checkout=return`
}

// Webhook URL carries the local subscription id as a routing hint only — status
// is always authoritatively re-fetched from the provider. Omitted when the
// webhook is disabled for local dev (the sync button drives ingestion instead).
export function billingWebhookUrl(subscriptionId) {
  if (isMollieWebhookDisabled()) return null
  const base = (process.env.MOLLIE_WEBHOOK_BASE_URL || appUrl()).replace(/\/$/, '')
  return `${base}/api/public/billing/mollie/webhook?subscription=${subscriptionId}`
}

// Provider metadata for reconciliation (the orphan-op task adopts by matching
// these). No PII.
export function billingMetadata(subscriptionId, purpose) {
  return { subscriptionId: String(subscriptionId), purpose }
}

// Human-readable description of what a charge or schedule is for, built from
// the module set: "GigBuddy band gold + artist gold (monthly)".
export function subscriptionDescription(modules, interval) {
  const parts = [...modules]
    .sort((a, b) => a.audience.localeCompare(b.audience))
    .map((m) => `${m.audience} ${m.plan_slug}`)
  const products = parts.length > 0 ? parts.join(' + ') : 'subscription'
  return `GigBuddy ${products} (${interval === 'year' ? 'yearly' : 'monthly'})`
}

// Deterministic idempotency keys: stable across retries of the SAME logical
// operation, distinct across different ones. billing_operations.idempotency_key
// is UNIQUE and the same key is handed to the provider.
export const idemKeys = {
  ensureCustomer: (userId) => `customer:${userId}`,
  // Conversion carries its AMOUNT: a customer who abandons checkout, changes
  // their module set and starts again is making a different charge, and reusing
  // the key would hand them the stale amount's payment.
  conversionPayment: (subId, amountCents) => `convert:${subId}:${amountCents}`,
  // `previousPaymentId` makes a retry after an expired/canceled verification a
  // new logical operation while concurrent retries still converge on one call.
  mandateVerification: (subId, previousPaymentId = 'initial') =>
    `mandate-verify:${subId}:${previousPaymentId}`,
  createSubscriptionInit: (subId) => `sub-create:${subId}:init`,
  createSubscription: (subId, amountCents, interval, startIso) =>
    `sub-create:${subId}:${amountCents}:${interval}:${startIso}`,
  cancelSubscription: (subId, providerSubId) => `sub-cancel:${subId}:${providerSubId}`,
  // The prorated amount is part of the key: the same module change made twice
  // in one period costs different amounts, and a key without the amount would
  // collide on the outbox's unique index and silently skip the second charge.
  moduleChangeCharge: (subId, audience, planId, amountCents, periodEndIso) =>
    `module-charge:${subId}:${audience}:${planId}:${amountCents}:${periodEndIso}`,
  refundPayment: (paymentId, amountCents) => `refund:${paymentId}:${amountCents}`,
}
