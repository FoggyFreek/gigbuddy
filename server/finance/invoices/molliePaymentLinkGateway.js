import { Client } from 'mollie-api-typescript'

export class MolliePaymentLinkGateway {
  constructor(client) {
    this.client = client
  }

  async createPaymentLink(payload) {
    const paymentLink = await this.client.paymentLinks.create({ requestBody: payload })
    return {
      id: paymentLink.id,
      checkoutUrl: paymentLink.links?.paymentLink?.href ?? null,
    }
  }

  async getPaymentSnapshot(paymentLinkId) {
    const [paymentLink, paymentsPage] = await Promise.all([
      this.client.paymentLinks.get({ paymentLinkId }),
      this.client.paymentLinks.listPayments({ paymentLinkId, limit: 1 }),
    ])
    const latestPayment = paymentsPage.result?.embedded?.payments?.[0] ?? null
    return {
      status: paymentLink.status ?? 'open',
      latestPayment: latestPayment
        ? {
            id: latestPayment.id,
            status: latestPayment.status,
            paidAt: latestPayment.paidAt ?? null,
          }
        : null,
    }
  }

  async deletePaymentLink(paymentLinkId) {
    await this.client.paymentLinks.delete({ paymentLinkId })
  }

  async archivePaymentLink(paymentLinkId) {
    await this.client.paymentLinks.update({
      paymentLinkId,
      requestBody: { archived: true },
    })
  }
}

export function createTenantMolliePaymentLinkGateway(apiKey) {
  const client = new Client({
    security: { apiKey },
    retryConfig: { strategy: 'none' },
    customUserAgent: 'gigbuddy-invoice-payment-links',
  })
  return new MolliePaymentLinkGateway(client)
}

// Converts an integer cent amount to the string Mollie expects: "24.95" for 2495 cents.
export function formatMollieAmountFromCents(totalCents) {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error('totalCents must be a non-negative integer')
  }
  const euros = Math.floor(totalCents / 100)
  const cents = totalCents % 100
  return `${euros}.${String(cents).padStart(2, '0')}`
}
