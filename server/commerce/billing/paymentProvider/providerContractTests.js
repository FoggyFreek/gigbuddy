import { beforeEach, describe, expect, it } from 'vitest'
import { PAYMENT_STATUS, REFUND_STATUS, SCHEDULE_STATUS } from './statuses.js'
import { ProviderError } from './ProviderError.js'

const amount = (cents) => ({ currency: 'EUR', cents })

/**
 * Registers the application-owned contract suite for a payment-provider adapter.
 * The harness translates the neutral scenarios below to its SDK's wire objects.
 *
 * @param {{ name: string, createHarness: () => object }} contract
 */
export function providerContractTests({ name, createHarness }) {
  describe(`${name} payment provider contract`, () => {
    let harness
    let provider

    beforeEach(() => {
      harness = createHarness()
      provider = harness.provider
    })

    it('normalizes customers and forwards create idempotency', async () => {
      harness.givenCustomer({ id: 'customer-1' })

      await expect(provider.createCustomer({
        email: 'member@example.test', name: 'Member', idempotencyKey: 'customer:user-1',
      })).resolves.toEqual({ id: 'customer-1' })
      expect(harness.lastMutation()).toMatchObject({ idempotencyKey: 'customer:user-1' })

      harness.givenCustomer({ id: 'customer-1' })
      await expect(provider.getCustomer({ customerId: 'customer-1' }))
        .resolves.toEqual({ id: 'customer-1' })
    })

    it('normalizes checkout and recurring payments and forwards idempotency', async () => {
      harness.givenPayment({
        id: 'payment-1', status: PAYMENT_STATUS.OPEN, amount: amount(1099),
        customerId: 'customer-1', mandateId: null, scheduleId: null,
        checkoutUrl: 'https://checkout.test/payment-1',
        createdAt: '2026-08-16T10:00:00.000Z', paidAt: null,
      })
      const checkout = await provider.createCheckoutPayment({
        customerId: 'customer-1', amount: amount(1099), description: 'Checkout',
        redirectUrl: 'https://gigbuddy.test/billing', idempotencyKey: 'checkout:1',
      })
      expect(checkout).toEqual({
        id: 'payment-1', status: PAYMENT_STATUS.OPEN, amount: amount(1099),
        customerId: 'customer-1', mandateId: null, scheduleId: null,
        checkoutUrl: 'https://checkout.test/payment-1',
        createdAt: new Date('2026-08-16T10:00:00.000Z'), paidAt: null, metadata: null,
      })
      expect(harness.lastMutation()).toMatchObject({ idempotencyKey: 'checkout:1' })

      harness.givenPayment({
        id: 'payment-2', status: PAYMENT_STATUS.PENDING, amount: amount(500),
        customerId: 'customer-1', mandateId: 'mandate-1', scheduleId: null,
        checkoutUrl: null, createdAt: null, paidAt: null,
      })
      await expect(provider.createRecurringPayment({
        customerId: 'customer-1', mandateId: 'mandate-1', amount: amount(500),
        description: 'Change', idempotencyKey: 'recurring:1',
      })).resolves.toMatchObject({ id: 'payment-2', amount: amount(500), checkoutUrl: null })
      expect(harness.lastMutation()).toMatchObject({ idempotencyKey: 'recurring:1' })
    })

    it('normalizes fetched payments, including refunds and chargebacks', async () => {
      for (const status of [PAYMENT_STATUS.PAID, PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.CHARGED_BACK]) {
        harness.givenPayment({
          id: `payment-${status}`, status, amount: amount(2500), customerId: 'customer-1',
          mandateId: 'mandate-1', scheduleId: 'schedule-1', checkoutUrl: null,
          createdAt: '2026-08-15T10:00:00.000Z', paidAt: '2026-08-15T10:01:00.000Z',
        })
        await expect(provider.getPayment({ paymentId: `payment-${status}` }))
          .resolves.toMatchObject({ status, amount: amount(2500), scheduleId: 'schedule-1' })
      }
    })

    // Ingestion binds a payment to its subscription through this field, so it
    // must survive the round trip rather than being dropped by the mapper.
    it('surfaces payment metadata', async () => {
      harness.givenPayment({
        id: 'payment-meta', status: PAYMENT_STATUS.PAID, amount: amount(2500),
        customerId: 'customer-1', mandateId: 'mandate-1', scheduleId: null, checkoutUrl: null,
        createdAt: null, paidAt: null, metadata: { subscriptionId: '42', purpose: 'conversion' },
      })
      await expect(provider.getPayment({ paymentId: 'payment-meta' })).resolves.toMatchObject({
        metadata: { subscriptionId: '42', purpose: 'conversion' },
      })
    })

    it('does not misclassify unknown payment or schedule statuses', async () => {
      harness.givenUnknownPaymentStatus()
      await expect(provider.getPayment({ paymentId: 'payment-unknown' }))
        .resolves.toMatchObject({ status: PAYMENT_STATUS.UNKNOWN })

      harness.givenUnknownScheduleStatus()
      await expect(provider.getSchedule({ customerId: 'customer-1', scheduleId: 'schedule-unknown' }))
        .resolves.toMatchObject({ status: SCHEDULE_STATUS.UNKNOWN })
    })

    it('rejects a checkout payment without a checkout URL', async () => {
      harness.givenPayment({
        id: 'payment-no-url', status: PAYMENT_STATUS.OPEN, amount: amount(100),
        customerId: 'customer-1', mandateId: null, scheduleId: null,
        checkoutUrl: null, createdAt: null, paidAt: null,
      })
      await expect(provider.createCheckoutPayment({
        customerId: 'customer-1', amount: amount(100), description: 'Checkout',
        redirectUrl: 'https://gigbuddy.test/billing', idempotencyKey: 'checkout:no-url',
      })).rejects.toMatchObject({
        name: 'ProviderError', code: 'checkout_url_missing', retryable: false,
      })
    })

    it('normalizes schedules and forwards create and cancel idempotency', async () => {
      harness.givenSchedule({
        id: 'schedule-1', status: SCHEDULE_STATUS.ACTIVE, amount: amount(999),
        customerId: 'customer-1', mandateId: 'mandate-1',
        nextPaymentAt: '2026-09-16T00:00:00.000Z', createdAt: '2026-08-16T00:00:00.000Z',
        metadata: { subscriptionId: 'local-1' },
      })
      await expect(provider.createSchedule({
        customerId: 'customer-1', mandateId: 'mandate-1', amount: amount(999),
        interval: 'month', description: 'Monthly', startAt: new Date('2026-09-16T00:00:00.000Z'),
        idempotencyKey: 'schedule:create:1', metadata: { subscriptionId: 'local-1' },
      })).resolves.toMatchObject({
        id: 'schedule-1', status: SCHEDULE_STATUS.ACTIVE, amount: amount(999),
        nextPaymentAt: new Date('2026-09-16T00:00:00.000Z'),
      })
      expect(harness.lastMutation()).toMatchObject({ idempotencyKey: 'schedule:create:1' })

      await provider.cancelSchedule({
        customerId: 'customer-1', scheduleId: 'schedule-1', idempotencyKey: 'schedule:cancel:1',
      })
      expect(harness.lastMutation()).toMatchObject({ idempotencyKey: 'schedule:cancel:1' })
    })

    it('treats a missing schedule as an already-completed cancellation', async () => {
      harness.givenCancellationError({ status: 404 })
      await expect(provider.cancelSchedule({
        customerId: 'customer-1', scheduleId: 'missing', idempotencyKey: 'schedule:cancel:missing',
      })).resolves.toBeUndefined()
    })

    it('normalizes refunds, unknown refund statuses, and forwards idempotency', async () => {
      harness.givenRefund({ id: 'refund-1', status: REFUND_STATUS.PENDING, amount: amount(350) })
      await expect(provider.createRefund({
        paymentId: 'payment-1', amount: amount(350), description: 'Support',
        idempotencyKey: 'refund:1',
      })).resolves.toEqual({ id: 'refund-1', status: REFUND_STATUS.PENDING, amount: amount(350) })
      expect(harness.lastMutation()).toMatchObject({ idempotencyKey: 'refund:1' })

      harness.givenUnknownRefundStatus()
      await expect(provider.getRefund({ paymentId: 'payment-1', refundId: 'refund-unknown' }))
        .resolves.toMatchObject({ id: 'refund-unknown', status: REFUND_STATUS.UNKNOWN })
    })

    it('classifies terminal and retryable provider failures', async () => {
      harness.givenError({ status: 422 })
      await expect(provider.getPayment({ paymentId: 'bad' })).rejects.toSatisfy((error) => (
        error instanceof ProviderError && error.retryable === false
      ))

      harness.givenError({ status: 503 })
      await expect(provider.getPayment({ paymentId: 'retry' })).rejects.toSatisfy((error) => (
        error instanceof ProviderError && error.retryable === true
      ))

      harness.givenError({ status: null })
      await expect(provider.getPayment({ paymentId: 'network' })).rejects.toSatisfy((error) => (
        error instanceof ProviderError && error.retryable === true
      ))
    })
  })
}
