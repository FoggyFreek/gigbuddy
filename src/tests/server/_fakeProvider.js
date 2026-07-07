// In-memory PaymentProvider fake for billing tests. Because billing depends only
// on the provider port, tests inject this via setPaymentProviderForTests — no
// Mollie, no HTTP. Tests drive outcomes with settlePayment()/suspendSubscription().
export class FakeProvider {
  constructor() {
    this.payments = new Map()
    this.subscriptions = new Map()
    this.calls = []
    this.custSeq = 0
    this.paySeq = 0
    this.subSeq = 0
    this.failNextWith = null // { retryable } to force the next provider call to throw
  }

  isConfigured() {
    return true
  }

  _maybeFail(op) {
    this.calls.push(op)
    if (this.failNextWith) {
      const cfg = this.failNextWith
      this.failNextWith = null
      const err = new Error(`forced ${op} failure`)
      err.name = 'PaymentProviderError'
      err.code = 'forced'
      err.retryable = cfg.retryable
      throw err
    }
  }

  async ensureCustomer({ existingCustomerId } = {}) {
    this._maybeFail('ensureCustomer')
    return existingCustomerId || `cst_${++this.custSeq}`
  }

  async createMandatePayment({ customerId, amountCents }) {
    this._maybeFail('createMandatePayment')
    const id = `tr_${++this.paySeq}`
    this.payments.set(id, {
      id, status: 'open', amountCents, paidAt: null, createdAt: new Date(),
      mandateId: null, subscriptionId: null, customerId, sequenceType: 'first',
      checkoutUrl: `https://pay.test/${id}`,
    })
    return { paymentId: id, checkoutUrl: `https://pay.test/${id}` }
  }

  async createOnDemandCharge({ customerId, mandateId, amountCents }) {
    this._maybeFail('createOnDemandCharge')
    const id = `tr_${++this.paySeq}`
    this.payments.set(id, {
      id, status: 'open', amountCents, paidAt: null, createdAt: new Date(),
      mandateId, subscriptionId: null, customerId, sequenceType: 'recurring', checkoutUrl: null,
    })
    return { paymentId: id }
  }

  async getPayment(id) {
    this._maybeFail('getPayment')
    const p = this.payments.get(id)
    if (!p) throw Object.assign(new Error('not found'), { statusCode: 404 })
    return { ...p }
  }

  async createSubscription({ customerId, amountCents, interval, metadata }) {
    this._maybeFail('createSubscription')
    const id = `sub_${++this.subSeq}`
    this.subscriptions.set(id, {
      id, status: 'active', nextPaymentDate: null, customerId, amountCents, interval,
      metadata: metadata ?? null,
    })
    return { id, status: 'active', nextPaymentDate: null, metadata: metadata ?? null }
  }

  async getSubscription({ subscriptionId }) {
    this._maybeFail('getSubscription')
    const s = this.subscriptions.get(subscriptionId)
    return s
      ? { id: s.id, status: s.status, nextPaymentDate: s.nextPaymentDate, metadata: s.metadata ?? null }
      : { id: subscriptionId, status: 'canceled', nextPaymentDate: null, metadata: null }
  }

  async cancelSubscription({ subscriptionId }) {
    this._maybeFail('cancelSubscription')
    const s = this.subscriptions.get(subscriptionId)
    if (s) s.status = 'canceled'
  }

  // ---- test controls ----

  // Mark a payment settled. A paid `first` payment yields a mandate id (as
  // Mollie does). subscriptionId links a recurring charge to a provider sub.
  settlePayment(id, status, { paidAt = new Date(), subscriptionId = null } = {}) {
    const p = this.payments.get(id)
    p.status = status
    if (status === 'paid') {
      p.paidAt = paidAt
      p.checkoutUrl = null
      if (p.sequenceType === 'first' && !p.mandateId) p.mandateId = `mdt_${id}`
    }
    if (subscriptionId) p.subscriptionId = subscriptionId
  }

  // Inject a provider-generated recurring charge for a subscription (what Mollie
  // creates each period), returning its payment id.
  addRecurringCharge(providerSubId, customerId, amountCents, { status = 'paid', paidAt = new Date() } = {}) {
    const id = `tr_${++this.paySeq}`
    this.payments.set(id, {
      id, status, amountCents, paidAt: status === 'paid' ? paidAt : null, createdAt: new Date(),
      mandateId: `mdt_${id}`, subscriptionId: providerSubId, customerId, sequenceType: 'recurring', checkoutUrl: null,
    })
    return id
  }

  lastPaymentId() {
    return `tr_${this.paySeq}`
  }
}
