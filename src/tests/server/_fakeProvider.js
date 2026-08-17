import { ProviderError } from '../../../server/commerce/billing/paymentProvider/ProviderError.js'

const eur = (cents) => ({ currency: 'EUR', cents })

export class FakeProvider {
  constructor() {
    this.payments = new Map()
    this.customers = new Map()
    this.subscriptions = new Map()
    this.refunds = new Map()
    this.calls = []
    this.custSeq = 0
    this.paySeq = 0
    this.subSeq = 0
    this.refundSeq = 0
    this.failNextWith = null
  }

  _maybeFail(operation) {
    this.calls.push(operation)
    if (!this.failNextWith) return
    const failure = this.failNextWith
    this.failNextWith = null
    throw new ProviderError(`forced ${operation} failure`, {
      code: 'forced', retryable: failure.retryable,
    })
  }

  async createCustomer() {
    this._maybeFail('createCustomer')
    const customer = { id: `cst_${++this.custSeq}` }
    this.customers.set(customer.id, customer)
    return customer
  }

  async getCustomer({ customerId }) {
    this._maybeFail('getCustomer')
    const customer = this.customers.get(customerId)
    if (!customer) {
      throw new ProviderError('Customer not found', {
        code: 'not_found', retryable: false, providerStatus: 404,
      })
    }
    return { ...customer }
  }

  async createCheckoutPayment({ customerId, amount, ...rest }) {
    this._maybeFail('createCheckoutPayment')
    this.lastMandatePaymentArgs = { customerId, amountCents: amount.cents, ...rest }
    const id = `tr_${++this.paySeq}`
    const payment = {
      id, status: 'open', amount, paidAt: null, createdAt: new Date(),
      mandateId: null, scheduleId: null, customerId,
      checkoutUrl: `https://pay.test/${id}`, metadata: rest.metadata ?? null,
    }
    this.payments.set(id, payment)
    return { ...payment }
  }

  async createRecurringPayment({ customerId, mandateId, amount, metadata = null }) {
    this._maybeFail('createRecurringPayment')
    const id = `tr_${++this.paySeq}`
    const payment = {
      id, status: 'open', amount, paidAt: null, createdAt: new Date(),
      mandateId, scheduleId: null, customerId, checkoutUrl: null, metadata,
    }
    this.payments.set(id, payment)
    return { ...payment }
  }

  async getPayment({ paymentId }) {
    this._maybeFail('getPayment')
    const payment = this.payments.get(paymentId)
    if (!payment) {
      throw new ProviderError('Payment not found', {
        code: 'not_found', retryable: false, providerStatus: 404,
      })
    }
    return { ...payment, amount: { ...payment.amount } }
  }

  async createSchedule({ customerId, mandateId, amount, interval, startAt, metadata }) {
    this._maybeFail('createSchedule')
    const id = `sub_${++this.subSeq}`
    const schedule = {
      id, status: 'active', amount, amountCents: amount.cents, customerId, mandateId,
      interval, startAt, nextPaymentAt: null, createdAt: new Date(), metadata: metadata ?? null,
    }
    this.subscriptions.set(id, schedule)
    return { ...schedule }
  }

  async getSchedule({ scheduleId }) {
    this._maybeFail('getSchedule')
    const schedule = this.subscriptions.get(scheduleId)
    return schedule
      ? { ...schedule, amount: { ...schedule.amount } }
      : {
          id: scheduleId, status: 'canceled', amount: eur(0), customerId: null,
          mandateId: null, nextPaymentAt: null, createdAt: null, metadata: null,
        }
  }

  async cancelSchedule({ scheduleId }) {
    this._maybeFail('cancelSchedule')
    const schedule = this.subscriptions.get(scheduleId)
    if (schedule) schedule.status = 'canceled'
  }

  async createRefund({ paymentId, amount, description }) {
    this._maybeFail('createRefund')
    const id = `re_${++this.refundSeq}`
    const refund = { id, paymentId, amount, description, status: 'pending' }
    this.refunds.set(id, refund)
    return { id, status: refund.status, amount: { ...amount } }
  }

  async getRefund({ refundId }) {
    this._maybeFail('getRefund')
    const refund = this.refunds.get(refundId)
    if (!refund) {
      throw new ProviderError('Refund not found', {
        code: 'not_found', retryable: false, providerStatus: 404,
      })
    }
    return { id: refund.id, status: refund.status, amount: { ...refund.amount } }
  }

  settlePayment(id, status, { paidAt = new Date(), subscriptionId = null } = {}) {
    const payment = this.payments.get(id)
    payment.status = status
    if (status === 'paid') {
      payment.paidAt = paidAt
      payment.checkoutUrl = null
      if (!payment.mandateId) payment.mandateId = `mdt_${id}`
    }
    if (subscriptionId) payment.scheduleId = subscriptionId
  }

  // A schedule-generated charge. `metadata` defaults to null because we do not
  // rely on the provider propagating the schedule's metadata onto its payments.
  addRecurringCharge(scheduleId, customerId, amountCents,
    { status = 'paid', paidAt = new Date(), metadata = null } = {}) {
    const id = `tr_${++this.paySeq}`
    this.payments.set(id, {
      id, status, amount: eur(amountCents), paidAt: status === 'paid' ? paidAt : null,
      createdAt: new Date(), mandateId: `mdt_${id}`, scheduleId, customerId,
      checkoutUrl: null, metadata,
    })
    return id
  }

  lastPaymentId() {
    return `tr_${this.paySeq}`
  }
}
