// Mollie adapter for the PaymentProvider port. Everything Mollie-specific lives
// here: SDK construction, amount/interval formatting, and — crucially — status
// normalization. Mollie reports chargebacks/refunds as amounts on an otherwise
// `paid` payment and uses `authorized` as a pre-capture limbo; this adapter
// folds those onto the canonical PAYMENT_STATUS vocabulary so nothing above the
// port ever sees a Mollie value.
import { createMollieClient } from '@mollie/api-client'
import { formatMollieAmountFromCents } from '../../utils/mollieClient.js'
import { PaymentProvider } from './PaymentProvider.js'
import { PaymentProviderError } from './PaymentProviderError.js'
import { PAYMENT_STATUS, SUBSCRIPTION_STATUS } from './statuses.js'

const MOLLIE_INTERVAL = { month: '1 month', year: '12 months' }

function toDate(value) {
  return value ? new Date(value) : null
}

function amountToCents(amount) {
  if (!amount || amount.value == null) return 0
  return Math.round(Number(amount.value) * 100)
}

function hasPositiveAmount(amount) {
  return Boolean(amount && amount.value != null && Number(amount.value) > 0)
}

// Mollie payment.status is one of open/canceled/pending/authorized/expired/
// failed/paid. Chargebacks and refunds are NOT statuses — a paid payment simply
// grows amountChargedBack / amountRefunded. Collapse all of that here.
function normalizePaymentStatus(payment) {
  if (payment.status === 'paid') {
    if (hasPositiveAmount(payment.amountChargedBack)) return PAYMENT_STATUS.CHARGED_BACK
    if (hasPositiveAmount(payment.amountRefunded)) return PAYMENT_STATUS.REFUNDED
    return PAYMENT_STATUS.PAID
  }
  switch (payment.status) {
    case 'open':
      return PAYMENT_STATUS.OPEN
    // `authorized` is a captured-later limbo; for our auto-capture flows it is
    // still in flight, so treat it as nonterminal `pending`.
    case 'pending':
    case 'authorized':
      return PAYMENT_STATUS.PENDING
    case 'failed':
      return PAYMENT_STATUS.FAILED
    case 'expired':
      return PAYMENT_STATUS.EXPIRED
    case 'canceled':
      return PAYMENT_STATUS.CANCELED
    default:
      return PAYMENT_STATUS.FAILED
  }
}

const MOLLIE_SUB_STATUS = {
  pending: SUBSCRIPTION_STATUS.PENDING,
  active: SUBSCRIPTION_STATUS.ACTIVE,
  suspended: SUBSCRIPTION_STATUS.SUSPENDED,
  canceled: SUBSCRIPTION_STATUS.CANCELED,
  completed: SUBSCRIPTION_STATUS.COMPLETED,
}

function normalizePayment(payment) {
  return {
    id: payment.id,
    status: normalizePaymentStatus(payment),
    amountCents: amountToCents(payment.amount),
    paidAt: toDate(payment.paidAt),
    createdAt: toDate(payment.createdAt),
    mandateId: payment.mandateId ?? null,
    subscriptionId: payment.subscriptionId ?? null,
    customerId: payment.customerId ?? null,
    sequenceType: payment.sequenceType ?? null,
    // Present only while an open payment awaits checkout; null once settled.
    checkoutUrl: payment.getCheckoutUrl?.() ?? payment._links?.checkout?.href ?? null,
  }
}

function normalizeSubscription(sub) {
  return {
    id: sub.id,
    status: MOLLIE_SUB_STATUS[sub.status] ?? SUBSCRIPTION_STATUS.CANCELED,
    nextPaymentDate: toDate(sub.nextPaymentDate),
    // Mollie saves create-time metadata alongside the subscription and includes
    // it whenever the subscription is fetched.
    metadata: sub.metadata ?? null,
  }
}

function statusCodeOf(err) {
  return err?.statusCode ?? err?.status ?? null
}

// A missing status (network/DNS/timeout), 408/425/429, or any 5xx is worth
// retrying; a definite 4xx from Mollie is terminal (bad request, invalid
// mandate, etc.).
function isRetryable(status) {
  if (status == null) return true
  if (status === 408 || status === 425 || status === 429) return true
  return status >= 500
}

function wrapMollieError(err, opName) {
  if (err instanceof PaymentProviderError) return err
  const status = statusCodeOf(err)
  return new PaymentProviderError(`Mollie ${opName} failed`, {
    code: err?.field ? `mollie_${err.field}` : 'mollie_error',
    retryable: isRetryable(status),
    providerStatus: status,
    cause: err,
  })
}

// UTC YYYY-MM-DD — Mollie subscription startDate is a calendar date.
function toMollieDate(date) {
  return new Date(date).toISOString().slice(0, 10)
}

export class MollieProvider extends PaymentProvider {
  constructor(apiKey) {
    super()
    this.apiKey = apiKey || null
    this.client = apiKey ? createMollieClient({ apiKey }) : null
  }

  isConfigured() {
    return Boolean(this.client)
  }

  async ensureCustomer({ email, name, existingCustomerId } = {}) {
    if (existingCustomerId) {
      try {
        const existing = await this.client.customers.get(existingCustomerId)
        if (existing?.id) return existing.id
      } catch (err) {
        // A 404 means the stored id is stale — fall through and recreate.
        if (statusCodeOf(err) !== 404) throw wrapMollieError(err, 'customers.get')
      }
    }
    try {
      const customer = await this.client.customers.create({
        ...(email ? { email } : {}),
        ...(name ? { name } : {}),
      })
      return customer.id
    } catch (err) {
      throw wrapMollieError(err, 'customers.create')
    }
  }

  async createMandatePayment({
    customerId, amountCents, description, idempotencyKey, redirectUrl, webhookUrl, metadata,
  }) {
    try {
      const payment = await this.client.payments.create({
        customerId,
        sequenceType: 'first',
        amount: { currency: 'EUR', value: formatMollieAmountFromCents(amountCents) },
        description,
        redirectUrl,
        ...(webhookUrl ? { webhookUrl } : {}),
        ...(metadata ? { metadata } : {}),
        idempotencyKey,
      })
      const checkoutUrl = payment.getCheckoutUrl?.() ?? payment._links?.checkout?.href ?? null
      if (!checkoutUrl) {
        throw new PaymentProviderError('Mollie returned no checkout URL', {
          code: 'checkout_url_missing', retryable: false, providerStatus: 502,
        })
      }
      return { paymentId: payment.id, checkoutUrl }
    } catch (err) {
      throw wrapMollieError(err, 'payments.create(first)')
    }
  }

  async createOnDemandCharge({
    customerId, mandateId, amountCents, description, idempotencyKey, webhookUrl, metadata,
  }) {
    try {
      const payment = await this.client.payments.create({
        customerId,
        mandateId,
        sequenceType: 'recurring',
        amount: { currency: 'EUR', value: formatMollieAmountFromCents(amountCents) },
        description,
        ...(webhookUrl ? { webhookUrl } : {}),
        ...(metadata ? { metadata } : {}),
        idempotencyKey,
      })
      return { paymentId: payment.id }
    } catch (err) {
      throw wrapMollieError(err, 'payments.create(recurring)')
    }
  }

  async getPayment(paymentId) {
    try {
      return normalizePayment(await this.client.payments.get(paymentId))
    } catch (err) {
      throw wrapMollieError(err, 'payments.get')
    }
  }

  async createSubscription({
    customerId, mandateId, amountCents, interval, description, startDate, webhookUrl, idempotencyKey, metadata,
  }) {
    try {
      const sub = await this.client.customerSubscriptions.create({
        customerId,
        amount: { currency: 'EUR', value: formatMollieAmountFromCents(amountCents) },
        interval: MOLLIE_INTERVAL[interval],
        description,
        ...(mandateId ? { mandateId } : {}),
        ...(startDate ? { startDate: toMollieDate(startDate) } : {}),
        ...(webhookUrl ? { webhookUrl } : {}),
        ...(metadata ? { metadata } : {}),
        idempotencyKey,
      })
      return normalizeSubscription(sub)
    } catch (err) {
      throw wrapMollieError(err, 'customerSubscriptions.create')
    }
  }

  async getSubscription({ customerId, subscriptionId }) {
    try {
      const sub = await this.client.customerSubscriptions.get(subscriptionId, { customerId })
      return normalizeSubscription(sub)
    } catch (err) {
      throw wrapMollieError(err, 'customerSubscriptions.get')
    }
  }

  async cancelSubscription({ customerId, subscriptionId, idempotencyKey }) {
    try {
      await this.client.customerSubscriptions.cancel(subscriptionId, {
        customerId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      })
    } catch (err) {
      const status = statusCodeOf(err)
      // Already gone / already canceled — cancellation is idempotent.
      if (status === 404 || status === 410) return
      throw wrapMollieError(err, 'customerSubscriptions.cancel')
    }
  }
}
