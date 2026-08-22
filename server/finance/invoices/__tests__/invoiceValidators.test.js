// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validatePaymentLinkOptions } from '../invoiceValidators.js'

describe('validatePaymentLinkOptions', () => {
  it('accepts and preserves valid expiry and payment-method options', () => {
    const expiresAt = '2099-01-01T00:00:00Z'
    expect(validatePaymentLinkOptions({ expiresAt, allowedMethods: ['ideal', 'creditcard'] }))
      .toEqual({ expiresAt, allowedMethods: ['ideal', 'creditcard'] })
    expect(validatePaymentLinkOptions({ allowedMethods: [] }))
      .toEqual({ expiresAt: undefined, allowedMethods: undefined })
  })

  it('rejects invalid expiry values and unsupported payment methods', () => {
    for (const body of [
      { expiresAt: 123 }, { expiresAt: 'not-a-date' }, { expiresAt: '2020-01-01T00:00:00Z' },
      { allowedMethods: 'ideal' }, { allowedMethods: ['ideal', 'made-up-method'] },
      { allowedMethods: ['klarnapaylater'] }, { allowedMethods: ['klarna'] },
      { allowedMethods: ['sofort'] }, { allowedMethods: ['giftcard'] },
    ]) {
      expect(validatePaymentLinkOptions(body)).toHaveProperty('error')
    }
  })
})
