import { describe, expect, it, vi } from 'vitest'
import {
  createTenantMolliePaymentLinkGateway,
  MolliePaymentLinkGateway,
} from '../../../server/finance/invoices/molliePaymentLinkGateway.js'

function createHarness() {
  const client = {
    paymentLinks: {
      create: vi.fn(),
      get: vi.fn(),
      listPayments: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  }
  return { client, gateway: new MolliePaymentLinkGateway(client) }
}

describe('MolliePaymentLinkGateway', () => {
  it('creates a payment link through the real SDK transport without an unhandled rejection', async () => {
    const payload = {
      description: 'Invoice INV-1',
      amount: { currency: 'EUR', value: '24.95' },
      redirectUrl: 'https://app.example.com/payment/thanks',
      reusable: false,
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      resource: 'payment-link',
      id: 'pl_1',
      mode: 'test',
      description: payload.description,
      amount: payload.amount,
      archived: false,
      redirectUrl: payload.redirectUrl,
      webhookUrl: null,
      profileId: 'pfl_test',
      reusable: false,
      createdAt: '2026-08-16T10:00:00Z',
      paidAt: null,
      expiresAt: null,
      allowedMethods: null,
      _links: {
        self: { href: 'https://api.mollie.com/v2/payment-links/pl_1', type: 'application/hal+json' },
        paymentLink: { href: 'https://paymentlink.mollie.com/payment/pl_1', type: 'text/html' },
      },
    }), {
      status: 201,
      headers: { 'content-type': 'application/hal+json' },
    }))
    const unhandledRejections = []
    const captureUnhandledRejection = (reason) => unhandledRejections.push(reason)
    vi.stubGlobal('fetch', fetchMock)
    process.on('unhandledRejection', captureUnhandledRejection)

    try {
      const gateway = createTenantMolliePaymentLinkGateway('test_api_key')

      await expect(gateway.createPaymentLink(payload)).resolves.toEqual({
        id: 'pl_1',
        checkoutUrl: 'https://paymentlink.mollie.com/payment/pl_1',
      })
      await new Promise((resolve) => setImmediate(resolve))

      expect(unhandledRejections).toEqual([])
      expect(fetchMock).toHaveBeenCalledOnce()
      const request = fetchMock.mock.calls[0][0]
      expect(request).toBeInstanceOf(Request)
      expect(request.url).toBe('https://api.mollie.com/v2/payment-links')
      expect(request.method).toBe('POST')
      await expect(request.clone().json()).resolves.toEqual(payload)
    } finally {
      process.off('unhandledRejection', captureUnhandledRejection)
      vi.unstubAllGlobals()
    }
  })

  it('translates payment-link creation to and from the SDK contract', async () => {
    const { client, gateway } = createHarness()
    const payload = {
      description: 'Invoice INV-1',
      amount: { currency: 'EUR', value: '24.95' },
    }
    client.paymentLinks.create.mockResolvedValue({
      id: 'pl_1',
      links: { paymentLink: { href: 'https://pay.example/pl_1' } },
    })

    await expect(gateway.createPaymentLink(payload)).resolves.toEqual({
      id: 'pl_1',
      checkoutUrl: 'https://pay.example/pl_1',
    })
    expect(client.paymentLinks.create).toHaveBeenCalledWith({ requestBody: payload })
  })

  it('returns the newest payment as an application-owned snapshot', async () => {
    const { client, gateway } = createHarness()
    client.paymentLinks.get.mockResolvedValue({ id: 'pl_1' })
    client.paymentLinks.listPayments.mockResolvedValue({
      result: {
        embedded: {
          payments: [{ id: 'tr_1', status: 'paid', paidAt: '2026-08-16T10:00:00Z' }],
        },
      },
    })

    await expect(gateway.getPaymentSnapshot('pl_1')).resolves.toEqual({
      status: 'open',
      latestPayment: { id: 'tr_1', status: 'paid', paidAt: '2026-08-16T10:00:00Z' },
    })
    expect(client.paymentLinks.get).toHaveBeenCalledWith({ paymentLinkId: 'pl_1' })
    expect(client.paymentLinks.listPayments).toHaveBeenCalledWith({ paymentLinkId: 'pl_1', limit: 1 })
  })

  it('translates delete and archive mutations to SDK requests', async () => {
    const { client, gateway } = createHarness()

    await gateway.deletePaymentLink('pl_1')
    await gateway.archivePaymentLink('pl_1')

    expect(client.paymentLinks.delete).toHaveBeenCalledWith({ paymentLinkId: 'pl_1' })
    expect(client.paymentLinks.update).toHaveBeenCalledWith({
      paymentLinkId: 'pl_1',
      requestBody: { archived: true },
    })
  })
})
