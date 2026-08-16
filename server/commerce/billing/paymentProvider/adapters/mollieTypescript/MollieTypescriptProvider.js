import { PaymentProvider } from '../../PaymentProvider.js'
import { ProviderError } from '../../ProviderError.js'
import { createMollieTypescriptClient } from './createMollieClient.js'
import {
  toPayment,
  toProviderAmount,
  toProviderDate,
  toProviderInterval,
  toRefund,
  toSchedule,
} from './mollieMappers.js'
import { providerStatusOf, toProviderError } from './mollieErrors.js'

export class MollieTypescriptProvider extends PaymentProvider {
  constructor(client) {
    super()
    this.client = client
  }

  async createCustomer({ email, name, idempotencyKey }) {
    try {
      const customer = await this.client.customers.create({
        idempotencyKey,
        entityCustomer: {
          ...(email ? { email } : {}),
          ...(name ? { name } : {}),
        },
      })
      return { id: customer.id }
    } catch (error) {
      throw toProviderError(error, 'customer creation')
    }
  }

  async getCustomer({ customerId }) {
    try {
      const customer = await this.client.customers.get({ customerId })
      return { id: customer.id }
    } catch (error) {
      throw toProviderError(error, 'customer lookup')
    }
  }

  async createCheckoutPayment(args) {
    try {
      const payment = toPayment(await this.client.payments.create({
        idempotencyKey: args.idempotencyKey,
        paymentRequest: {
          customerId: args.customerId,
          sequenceType: 'first',
          amount: toProviderAmount(args.amount),
          description: args.description,
          redirectUrl: args.redirectUrl,
          ...(args.webhookUrl ? { webhookUrl: args.webhookUrl } : {}),
          ...(args.metadata ? { metadata: args.metadata } : {}),
        },
      }))
      if (!payment.checkoutUrl) {
        throw new ProviderError('Payment provider returned no checkout URL', {
          code: 'checkout_url_missing', retryable: false, providerStatus: 502,
        })
      }
      return payment
    } catch (error) {
      throw toProviderError(error, 'checkout payment creation')
    }
  }

  async createRecurringPayment(args) {
    try {
      return toPayment(await this.client.payments.create({
        idempotencyKey: args.idempotencyKey,
        paymentRequest: {
          customerId: args.customerId,
          mandateId: args.mandateId,
          sequenceType: 'recurring',
          amount: toProviderAmount(args.amount),
          description: args.description,
          redirectUrl: null,
          ...(args.webhookUrl ? { webhookUrl: args.webhookUrl } : {}),
          ...(args.metadata ? { metadata: args.metadata } : {}),
        },
      }))
    } catch (error) {
      throw toProviderError(error, 'recurring payment creation')
    }
  }

  async getPayment({ paymentId }) {
    try {
      return toPayment(await this.client.payments.get({ paymentId }))
    } catch (error) {
      throw toProviderError(error, 'payment lookup')
    }
  }

  async createSchedule(args) {
    try {
      return toSchedule(await this.client.subscriptions.create({
        customerId: args.customerId,
        idempotencyKey: args.idempotencyKey,
        subscriptionRequest: {
          amount: toProviderAmount(args.amount),
          interval: toProviderInterval(args.interval),
          description: args.description,
          ...(args.mandateId ? { mandateId: args.mandateId } : {}),
          ...(args.startAt ? { startDate: toProviderDate(args.startAt) } : {}),
          ...(args.webhookUrl ? { webhookUrl: args.webhookUrl } : {}),
          ...(args.metadata ? { metadata: args.metadata } : {}),
        },
      }))
    } catch (error) {
      throw toProviderError(error, 'schedule creation')
    }
  }

  async getSchedule({ customerId, scheduleId }) {
    try {
      return toSchedule(await this.client.subscriptions.get({ customerId, subscriptionId: scheduleId }))
    } catch (error) {
      throw toProviderError(error, 'schedule lookup')
    }
  }

  async cancelSchedule({ customerId, scheduleId, idempotencyKey }) {
    try {
      await this.client.subscriptions.cancel({
        customerId, subscriptionId: scheduleId, idempotencyKey,
      })
    } catch (error) {
      if (providerStatusOf(error) === 404 || providerStatusOf(error) === 410) return
      throw toProviderError(error, 'schedule cancellation')
    }
  }

  async createRefund(args) {
    try {
      return toRefund(await this.client.refunds.create({
        paymentId: args.paymentId,
        idempotencyKey: args.idempotencyKey,
        refundRequest: {
          amount: toProviderAmount(args.amount),
          description: args.description ?? 'GigBuddy refund',
          metadata: null,
        },
      }))
    } catch (error) {
      throw toProviderError(error, 'refund creation')
    }
  }

  async getRefund({ paymentId, refundId }) {
    try {
      return toRefund(await this.client.refunds.get({ paymentId, refundId }))
    } catch (error) {
      throw toProviderError(error, 'refund lookup')
    }
  }
}

export function createMollieTypescriptProvider(apiKey) {
  return new MollieTypescriptProvider(createMollieTypescriptClient(apiKey))
}
