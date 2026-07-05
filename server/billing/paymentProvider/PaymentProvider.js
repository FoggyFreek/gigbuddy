// The payment-provider PORT: the provider-agnostic contract the billing service
// and scheduler depend on. Mollie is one adapter behind it (mollieProvider.js);
// swapping to another processor means writing a new adapter that returns these
// same normalized shapes and canonical statuses — no caller changes.
//
// All monetary values cross this boundary as integer cents; all timestamps as
// Date | null. Adapters normalize provider statuses to statuses.js constants
// and throw PaymentProviderError (never their SDK's error type).

/**
 * @typedef {import('./statuses.js').PAYMENT_STATUS[keyof import('./statuses.js').PAYMENT_STATUS]} CanonicalPaymentStatus
 *
 * @typedef {object} NormalizedPayment
 * @property {string} id                          provider payment id
 * @property {string} status                      a PAYMENT_STATUS value
 * @property {number} amountCents
 * @property {Date|null} paidAt
 * @property {Date|null} createdAt
 * @property {string|null} mandateId              mandate established/used (first/recurring)
 * @property {string|null} subscriptionId         provider sub that generated this charge, else null
 * @property {string|null} customerId
 * @property {'first'|'recurring'|'oneoff'|null} sequenceType
 * @property {string|null} checkoutUrl           hosted checkout URL while open, else null
 *
 * @typedef {object} NormalizedSubscription
 * @property {string} id
 * @property {string} status                      a SUBSCRIPTION_STATUS value
 * @property {Date|null} nextPaymentDate
 */

const NOT_IMPLEMENTED = 'PaymentProvider subclass must implement this method'

export class PaymentProvider {
  // Whether credentials are present. Routes 503 before doing any work when false.
  isConfigured() {
    return false
  }

  /**
   * Idempotently ensure a provider-side customer for this user.
   * @param {{ email?: string|null, name?: string|null, existingCustomerId?: string|null }} _args
   * @returns {Promise<string>} customerId
   */
  async ensureCustomer(_args) {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * Create the mandate-establishing first payment (the €0.01 charge) and return
   * its id plus the hosted checkout URL. No payment-method restriction by design.
   * @param {{ customerId: string, amountCents: number, description: string,
   *   idempotencyKey: string, redirectUrl: string, webhookUrl?: string|null,
   *   metadata?: object }} _args
   * @returns {Promise<{ paymentId: string, checkoutUrl: string }>}
   */
  async createMandatePayment(_args) {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * Charge an existing mandate on demand (plan-change / downgrade-activation).
   * No hosted checkout — settles against the stored mandate.
   * @param {{ customerId: string, mandateId: string, amountCents: number,
   *   description: string, idempotencyKey: string, webhookUrl?: string|null,
   *   metadata?: object }} _args
   * @returns {Promise<{ paymentId: string }>}
   */
  async createOnDemandCharge(_args) {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * Authoritative payment state, normalized. This is the ONLY trusted source of
   * payment status — never the webhook body.
   * @param {string} _paymentId
   * @returns {Promise<NormalizedPayment>}
   */
  async getPayment(_paymentId) {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * Create the recurring subscription schedule.
   * @param {{ customerId: string, mandateId?: string|null, amountCents: number,
   *   interval: 'month'|'year', description: string, startDate?: Date|null,
   *   webhookUrl?: string|null, idempotencyKey: string, metadata?: object }} _args
   * @returns {Promise<NormalizedSubscription>}
   */
  async createSubscription(_args) {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * @param {{ customerId: string, subscriptionId: string }} _args
   * @returns {Promise<NormalizedSubscription>}
   */
  async getSubscription(_args) {
    throw new Error(NOT_IMPLEMENTED)
  }

  /**
   * Cancel a subscription schedule. Idempotent: an already-gone subscription
   * resolves successfully rather than throwing.
   * @param {{ customerId: string, subscriptionId: string, idempotencyKey?: string }} _args
   * @returns {Promise<void>}
   */
  async cancelSubscription(_args) {
    throw new Error(NOT_IMPLEMENTED)
  }
}
