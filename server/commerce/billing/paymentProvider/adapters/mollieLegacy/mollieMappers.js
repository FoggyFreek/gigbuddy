import { PAYMENT_STATUS, REFUND_STATUS, SCHEDULE_STATUS } from '../../statuses.js'
import { ProviderError } from '../../ProviderError.js'

const PAYMENT_STATUSES = Object.freeze({
  open: PAYMENT_STATUS.OPEN,
  pending: PAYMENT_STATUS.PENDING,
  authorized: PAYMENT_STATUS.PENDING,
  paid: PAYMENT_STATUS.PAID,
  failed: PAYMENT_STATUS.FAILED,
  expired: PAYMENT_STATUS.EXPIRED,
  canceled: PAYMENT_STATUS.CANCELED,
})

const SCHEDULE_STATUSES = Object.freeze({
  pending: SCHEDULE_STATUS.PENDING,
  active: SCHEDULE_STATUS.ACTIVE,
  suspended: SCHEDULE_STATUS.SUSPENDED,
  canceled: SCHEDULE_STATUS.CANCELED,
  completed: SCHEDULE_STATUS.COMPLETED,
})

const REFUND_STATUSES = Object.freeze({
  queued: REFUND_STATUS.QUEUED,
  pending: REFUND_STATUS.PENDING,
  processing: REFUND_STATUS.PROCESSING,
  refunded: REFUND_STATUS.REFUNDED,
  failed: REFUND_STATUS.FAILED,
  canceled: REFUND_STATUS.CANCELED,
})

const INTERVALS = Object.freeze({ month: '1 month', year: '12 months' })

function toDate(value) {
  return value ? new Date(value) : null
}

function hasPositiveAmount(value) {
  return Boolean(value?.value != null && Number(value.value) > 0)
}

export function toProviderAmount(amount) {
  const cents = amount?.cents
  if (amount?.currency !== 'EUR' || !Number.isInteger(cents) || cents < 0) {
    throw new ProviderError('Invalid payment amount', {
      code: 'invalid_amount', retryable: false,
    })
  }
  return { currency: 'EUR', value: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` }
}

export function toMoney(amount) {
  return {
    currency: 'EUR',
    cents: amount?.value == null ? 0 : Math.round(Number(amount.value) * 100),
  }
}

export function toProviderInterval(interval) {
  const mapped = INTERVALS[interval]
  if (!mapped) {
    throw new ProviderError('Invalid billing interval', {
      code: 'invalid_interval', retryable: false,
    })
  }
  return mapped
}

export function toProviderDate(date) {
  return new Date(date).toISOString().slice(0, 10)
}

export function toPayment(value) {
  let status = PAYMENT_STATUSES[value.status] ?? PAYMENT_STATUS.UNKNOWN
  if (value.status === 'paid') {
    if (hasPositiveAmount(value.amountChargedBack)) status = PAYMENT_STATUS.CHARGED_BACK
    else if (hasPositiveAmount(value.amountRefunded)) status = PAYMENT_STATUS.REFUNDED
  }
  return {
    id: value.id,
    status,
    amount: toMoney(value.amount),
    customerId: value.customerId ?? null,
    mandateId: value.mandateId ?? null,
    scheduleId: value.subscriptionId ?? null,
    checkoutUrl: value.getCheckoutUrl?.() ?? value._links?.checkout?.href ?? null,
    createdAt: toDate(value.createdAt),
    paidAt: toDate(value.paidAt),
  }
}

export function toSchedule(value) {
  return {
    id: value.id,
    status: SCHEDULE_STATUSES[value.status] ?? SCHEDULE_STATUS.UNKNOWN,
    amount: toMoney(value.amount),
    customerId: value.customerId ?? null,
    mandateId: value.mandateId ?? null,
    nextPaymentAt: toDate(value.nextPaymentDate),
    createdAt: toDate(value.createdAt),
    metadata: value.metadata ?? null,
  }
}

export function toRefund(value) {
  return {
    id: value.id,
    status: REFUND_STATUSES[value.status] ?? REFUND_STATUS.UNKNOWN,
    amount: toMoney(value.amount),
  }
}
