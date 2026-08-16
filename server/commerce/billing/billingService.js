// The /api/billing service surface: one aggregate re-export of the user-facing
// billing services, so the router (and the admin serializer) has a single import
// point. ADD NOTHING HERE — no logic, no helpers, no error constants. New
// behaviour belongs in the owning service below.
//
// The commercial model: one customer, one subscription, one trial, one cycle,
// one renewal payment. Band and artist are MODULES of that subscription, priced
// together and discounted as a bundle.
//
// Design rules every service below obeys (load-bearing):
// - Local state first: rows are written and committed BEFORE any remote call,
//   so an abandoned checkout is just a stale row the scheduler cleans up.
// - Never a provider call inside a DB transaction.
// - No paid access before an authoritatively-paid subscription charge. The
//   trial is free; its EUR 0.01 continuation verification establishes only the
//   mandate.
// - Every remote mutation goes through the saga layer; no service calls the
//   provider SDK directly.
// - Expected failures return { error: { status, body } }; success returns a
//   named payload.
export { startTrial } from './subscriptionTrialService.js'
export { previewModuleChange, changeModule } from './moduleChangeService.js'
export { checkout, subscribe } from './subscriptionCheckoutService.js'
export { previewDowngrade, downgrade } from './moduleDowngradeService.js'
export { cancelSubscription, resumeSubscription } from './subscriptionCancelService.js'
export { serializeSubscription, getBillingState, syncOwnSubscription } from './billingReadService.js'
