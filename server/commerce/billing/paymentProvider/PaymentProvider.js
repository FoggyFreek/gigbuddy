/**
 * @typedef {{ currency: 'EUR', cents: number }} Money
 * @typedef {{
 *   id: string,
 *   status: string,
 *   amount: Money,
 *   customerId: string|null,
 *   mandateId: string|null,
 *   scheduleId: string|null,
 *   checkoutUrl: string|null,
 *   createdAt: Date|null,
 *   paidAt: Date|null,
 *   metadata: object|null,
 * }} Payment
 * @typedef {{ id: string }} Customer
 * @typedef {{
 *   id: string,
 *   status: string,
 *   amount: Money,
 *   customerId: string|null,
 *   mandateId: string|null,
 *   nextPaymentAt: Date|null,
 *   createdAt: Date|null,
 *   metadata: object|null,
 * }} Schedule
 * @typedef {{ id: string, status: string, amount: Money }} Refund
 */

const NOT_IMPLEMENTED = 'PaymentProvider subclass must implement this method'

export class PaymentProvider {
  /**
   * @param {{ email?: string|null, name?: string|null, idempotencyKey: string }} _args
   * @returns {Promise<Customer>}
   */
  async createCustomer(_args) { throw new Error(NOT_IMPLEMENTED) }

  /**
   * @param {{ customerId: string }} _args
   * @returns {Promise<Customer>}
   */
  async getCustomer(_args) { throw new Error(NOT_IMPLEMENTED) }

  /**
   * @param {{ customerId: string, amount: Money, description: string,
   *   redirectUrl: string, webhookUrl?: string|null, metadata?: object|null,
   *   idempotencyKey: string }} _args
   * @returns {Promise<Payment>}
   */
  async createCheckoutPayment(_args) { throw new Error(NOT_IMPLEMENTED) }

  /**
   * @param {{ customerId: string, mandateId: string, amount: Money,
   *   description: string, webhookUrl?: string|null, metadata?: object|null,
   *   idempotencyKey: string }} _args
   * @returns {Promise<Payment>}
   */
  async createRecurringPayment(_args) { throw new Error(NOT_IMPLEMENTED) }

  /**
   * @param {{ paymentId: string }} _args
   * @returns {Promise<Payment>}
   */
  async getPayment(_args) { throw new Error(NOT_IMPLEMENTED) }

  /**
   * @param {{ customerId: string, mandateId?: string|null, amount: Money,
   *   interval: 'month'|'year', description: string, startAt?: Date|null,
   *   webhookUrl?: string|null, metadata?: object|null, idempotencyKey: string }} _args
   * @returns {Promise<Schedule>}
   */
  async createSchedule(_args) { throw new Error(NOT_IMPLEMENTED) }

  /**
   * @param {{ customerId: string, scheduleId: string }} _args
   * @returns {Promise<Schedule>}
   */
  async getSchedule(_args) { throw new Error(NOT_IMPLEMENTED) }

  /**
   * @param {{ customerId: string, scheduleId: string, idempotencyKey: string }} _args
   * @returns {Promise<void>}
   */
  async cancelSchedule(_args) { throw new Error(NOT_IMPLEMENTED) }

  /**
   * @param {{ paymentId: string, amount: Money, description?: string|null,
   *   idempotencyKey: string }} _args
   * @returns {Promise<Refund>}
   */
  async createRefund(_args) { throw new Error(NOT_IMPLEMENTED) }

  /**
   * @param {{ paymentId: string, refundId: string }} _args
   * @returns {Promise<Refund>}
   */
  async getRefund(_args) { throw new Error(NOT_IMPLEMENTED) }
}
