// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  createTenantMolliePaymentLinkGateway,
  formatMollieAmountFromCents,
  MolliePaymentLinkGateway,
} from '../molliePaymentLinkGateway.js'

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
  it('formats non-negative integer cents exactly as Mollie currency values', () => {
    expect(formatMollieAmountFromCents(2495)).toBe('24.95')
    expect(formatMollieAmountFromCents(100)).toBe('1.00')
    expect(formatMollieAmountFromCents(0)).toBe('0.00')
    expect(formatMollieAmountFromCents(50000)).toBe('500.00')
    expect(() => formatMollieAmountFromCents(1.5)).toThrow()
    expect(() => formatMollieAmountFromCents(-1)).toThrow()
  })

  it('creates a payment link through the real SDK transport', async () => {
    const payload = {
      description: 'Invoice INV-1', amount: { currency: 'EUR', value: '24.95' },
      redirectUrl: 'https://app.example.com/payment/thanks', reusable: false,
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
    }), { status: 201, headers: { 'content-type': 'application/hal+json' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const gateway = createTenantMolliePaymentLinkGateway('test_api_key')
      await expect(gateway.createPaymentLink(payload)).resolves.toEqual({
        id: 'pl_1', checkoutUrl: 'https://paymentlink.mollie.com/payment/pl_1',
      })
      const request = fetchMock.mock.calls[0][0]
      expect(request).toBeInstanceOf(Request)
      expect(request.url).toBe('https://api.mollie.com/v2/payment-links')
      expect(request.method).toBe('POST')
      await expect(request.clone().json()).resolves.toEqual(payload)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('translates create, snapshot, delete, and archive operations to the SDK contract', async () => {
    const { client, gateway } = createHarness()
    const payload = { description: 'Invoice INV-1', amount: { currency: 'EUR', value: '24.95' } }
    client.paymentLinks.create.mockResolvedValue({ id: 'pl_1', links: { paymentLink: { href: 'https://pay.example/pl_1' } } })
    client.paymentLinks.get.mockResolvedValue({ id: 'pl_1' })
    client.paymentLinks.listPayments.mockResolvedValue({
      result: { embedded: { payments: [{ id: 'tr_1', status: 'paid', paidAt: '2026-08-16T10:00:00Z' }] } },
    })

    await expect(gateway.createPaymentLink(payload)).resolves.toEqual({ id: 'pl_1', checkoutUrl: 'https://pay.example/pl_1' })
    await expect(gateway.getPaymentSnapshot('pl_1')).resolves.toEqual({
      status: 'open', latestPayment: { id: 'tr_1', status: 'paid', paidAt: '2026-08-16T10:00:00Z' },
    })
    await gateway.deletePaymentLink('pl_1')
    await gateway.archivePaymentLink('pl_1')

    expect(client.paymentLinks.create).toHaveBeenCalledWith({ requestBody: payload })
    expect(client.paymentLinks.listPayments).toHaveBeenCalledWith({ paymentLinkId: 'pl_1', limit: 1 })
    expect(client.paymentLinks.delete).toHaveBeenCalledWith({ paymentLinkId: 'pl_1' })
    expect(client.paymentLinks.update).toHaveBeenCalledWith({ paymentLinkId: 'pl_1', requestBody: { archived: true } })
  })
})
