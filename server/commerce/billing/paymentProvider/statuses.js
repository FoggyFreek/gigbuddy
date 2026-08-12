// Canonical, provider-agnostic billing status vocabulary.
//
// The billing service, payment-ingestion SQL, and scheduler speak ONLY these
// values. Each payment provider adapter is responsible for normalizing its own
// API's statuses onto this vocabulary — e.g. Mollie has no `charged_back` or
// `refunded` payment *status* (a paid payment merely grows an
// `amountChargedBack`/`amountRefunded`), and its `authorized` state is a
// pre-capture limbo; the Mollie adapter folds all of that into these constants
// so nothing downstream ever branches on a Mollie-specific value.

// Payment lifecycle. The transition graph enforced in SQL
// (billing_payment_transition_allowed) is:
//   open|pending → paid|failed|expired|canceled
//   paid         → charged_back|refunded
// everything else (incl. regressions like paid→pending) is inert.
export const PAYMENT_STATUS = Object.freeze({
  OPEN: 'open',
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
  CHARGED_BACK: 'charged_back',
  REFUNDED: 'refunded',
})

export const NONTERMINAL_PAYMENT_STATUSES = Object.freeze([
  PAYMENT_STATUS.OPEN,
  PAYMENT_STATUS.PENDING,
])

// Provider-side subscription lifecycle (the recurring schedule the provider
// runs). Drift repair maps suspended|canceled|completed onto a local
// canceled(payment_failed).
export const SUBSCRIPTION_STATUS = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  CANCELED: 'canceled',
  COMPLETED: 'completed',
})

// Canonical billing intervals. Adapters translate to their own API's notation.
export const BILLING_INTERVAL = Object.freeze({
  MONTH: 'month',
  YEAR: 'year',
})
