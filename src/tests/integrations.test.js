import { describe, expect, it } from 'vitest'
import { isIntegrationConfigured } from '../utils/integrations.ts'

describe('isIntegrationConfigured', () => {
  const configured = { shopify: true, bandsintown: false, mollie: true }

  it('checks the requested integration only', () => {
    expect(isIntegrationConfigured(configured, 'shopify')).toBe(true)
    expect(isIntegrationConfigured(configured, 'bandsintown')).toBe(false)
    expect(isIntegrationConfigured(configured, 'mollie')).toBe(true)
  })

  it('fails closed while configuration is unavailable', () => {
    expect(isIntegrationConfigured(null, 'shopify')).toBe(false)
  })
})
