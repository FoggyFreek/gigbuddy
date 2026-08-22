export const PAYMENT_STATUS = Object.freeze({
  OPEN: 'open',
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
  CHARGED_BACK: 'charged_back',
  REFUNDED: 'refunded',
  UNKNOWN: 'unknown',
})

export const NONTERMINAL_PAYMENT_STATUSES = Object.freeze([
  PAYMENT_STATUS.OPEN,
  PAYMENT_STATUS.PENDING,
])

export const SCHEDULE_STATUS = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  CANCELED: 'canceled',
  COMPLETED: 'completed',
  UNKNOWN: 'unknown',
})

export const REFUND_STATUS = Object.freeze({
  QUEUED: 'queued',
  PENDING: 'pending',
  PROCESSING: 'processing',
  REFUNDED: 'refunded',
  FAILED: 'failed',
  CANCELED: 'canceled',
  UNKNOWN: 'unknown',
})

export const NONTERMINAL_REFUND_STATUSES = Object.freeze([
  REFUND_STATUS.QUEUED,
  REFUND_STATUS.PENDING,
  REFUND_STATUS.PROCESSING,
])

export const BILLING_INTERVAL = Object.freeze({
  MONTH: 'month',
  YEAR: 'year',
})
