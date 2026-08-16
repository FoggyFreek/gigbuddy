import { expect, it, vi } from 'vitest'
import { PaymentProvider } from '../../../server/commerce/billing/paymentProvider/PaymentProvider.js'
import { MollieTypescriptProvider } from '../../../server/commerce/billing/paymentProvider/adapters/mollieTypescript/MollieTypescriptProvider.js'
import { providerContractTests } from '../../../server/commerce/billing/paymentProvider/providerContractTests.js'
import { createPaymentProvider } from '../../../server/commerce/billing/paymentProvider/providerFactory.js'
import { toProviderError as toTypescriptProviderError } from '../../../server/commerce/billing/paymentProvider/adapters/mollieTypescript/mollieErrors.js'

it('freezes the application-owned provider method surface', () => {
  expect(Object.getOwnPropertyNames(PaymentProvider.prototype)).toEqual([
    'constructor',
    'createCustomer',
    'getCustomer',
    'createCheckoutPayment',
    'createRecurringPayment',
    'getPayment',
    'createSchedule',
    'getSchedule',
    'cancelSchedule',
    'createRefund',
    'getRefund',
  ])
})

it('creates the Mollie adapter without exposing the SDK to callers', () => {
  expect(createPaymentProvider('test_key')).toBeInstanceOf(MollieTypescriptProvider)
})

it('keeps response-validation failures replayable because the remote outcome is unknown', () => {
  const error = Object.assign(new Error('invalid SDK response'), {
    name: 'ResponseValidationError', statusCode: 200,
  })
  expect(toTypescriptProviderError(error, 'payment creation')).toMatchObject({ retryable: true })
})

function createTypescriptHarness() {
  const queues = { customer: [], payment: [], schedule: [], refund: [] }
  let nextError = null
  let cancellationError = null
  let lastMutation = null

  const take = (kind) => {
    if (nextError) {
      const error = nextError
      nextError = null
      throw error
    }
    return queues[kind].shift()
  }
  const mutation = (kind, args) => {
    lastMutation = { kind, ...args }
    return take(kind)
  }
  const client = {
    customers: {
      create: vi.fn((args) => mutation('customer', args)),
      get: vi.fn(() => take('customer')),
    },
    payments: {
      create: vi.fn((args) => mutation('payment', args)),
      get: vi.fn(() => take('payment')),
    },
    subscriptions: {
      create: vi.fn((args) => mutation('schedule', args)),
      get: vi.fn(() => take('schedule')),
      cancel: vi.fn((args) => {
        lastMutation = { kind: 'cancelSchedule', ...args }
        if (cancellationError) throw cancellationError
      }),
    },
    refunds: {
      create: vi.fn((args) => mutation('refund', args)),
      get: vi.fn(() => take('refund')),
    },
  }

  const toMollieAmount = ({ cents }) => ({ currency: 'EUR', value: (cents / 100).toFixed(2) })
  const payment = (value, rawStatus = value.status) => ({
    id: value.id,
    status: value.status === 'refunded' || value.status === 'charged_back' ? 'paid' : rawStatus,
    amount: toMollieAmount(value.amount),
    customerId: value.customerId,
    mandateId: value.mandateId,
    subscriptionId: value.scheduleId,
    createdAt: value.createdAt,
    paidAt: value.paidAt,
    ...(value.status === 'refunded' ? { amountRefunded: { currency: 'EUR', value: '1.00' } } : {}),
    ...(value.status === 'charged_back' ? { amountChargedBack: { currency: 'EUR', value: '1.00' } } : {}),
    links: value.checkoutUrl ? { checkout: { href: value.checkoutUrl } } : {},
  })
  const schedule = (value, rawStatus = value.status) => ({
    id: value.id,
    status: rawStatus,
    amount: toMollieAmount(value.amount),
    customerId: value.customerId,
    mandateId: value.mandateId,
    nextPaymentDate: value.nextPaymentAt,
    createdAt: value.createdAt,
    metadata: value.metadata,
  })

  return {
    provider: new MollieTypescriptProvider(client),
    givenCustomer: (value) => queues.customer.push(value),
    givenPayment: (value) => queues.payment.push(payment(value)),
    givenSchedule: (value) => queues.schedule.push(schedule(value)),
    givenRefund: (value) => queues.refund.push({
      id: value.id, status: value.status, amount: toMollieAmount(value.amount),
    }),
    givenUnknownPaymentStatus: () => queues.payment.push(payment({
      id: 'payment-unknown', status: 'unknown', amount: { currency: 'EUR', cents: 100 },
      customerId: null, mandateId: null, scheduleId: null, checkoutUrl: null,
      createdAt: null, paidAt: null,
    }, 'brand_new_payment_status')),
    givenUnknownScheduleStatus: () => queues.schedule.push(schedule({
      id: 'schedule-unknown', status: 'unknown', amount: { currency: 'EUR', cents: 100 },
      customerId: 'customer-1', mandateId: null, nextPaymentAt: null, createdAt: null,
      metadata: null,
    }, 'brand_new_schedule_status')),
    givenUnknownRefundStatus: () => queues.refund.push({
      id: 'refund-unknown', status: 'brand_new_refund_status', amount: { currency: 'EUR', value: '1.00' },
    }),
    givenError: ({ status }) => {
      nextError = Object.assign(new Error('provider failure'), status == null ? {} : { statusCode: status })
    },
    givenCancellationError: ({ status }) => {
      cancellationError = Object.assign(new Error('cancel failure'), { statusCode: status })
    },
    lastMutation: () => lastMutation,
  }
}

providerContractTests({ name: 'Mollie TypeScript', createHarness: createTypescriptHarness })
