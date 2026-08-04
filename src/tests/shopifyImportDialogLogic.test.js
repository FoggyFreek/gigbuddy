import { describe, expect, it } from 'vitest'
import {
  buildImportableOrders,
  createInitialMappings,
  mappingFromSelection,
} from '../components/merch/useShopifyImportDialog.ts'

const PRODUCTS = [
  { id: 1, name: 'Band T-Shirt', archived_at: null },
]

const REVENUE_ACCOUNTS = [
  { code: '42000', name: 'Merchandise Sales', type: 'revenue', is_active: true },
]

function makeOrder(overrides = {}) {
  return {
    id: '1001',
    line_items: [{
      id: '5001', title: 'Band T-Shirt', already_imported: false, skip_reason: null,
    }],
    extra_components: [],
    ...overrides,
  }
}

describe('Shopify import dialog logic', () => {
  it('creates defaults for product lines and revenue-only extra components', () => {
    const order = makeOrder({
      extra_components: [{ key: 'shipping', title: 'Shipping', amount_cents: 500 }],
    })

    expect(createInitialMappings({}, [order], PRODUCTS, REVENUE_ACCOUNTS, 21, 'nl')).toEqual({
      5001: { type: 'product', product_id: 1 },
      shipping: {
        type: 'revenue',
        account_code: '42000',
        vat_rate: 21,
        tax_category_code: 'domestic_standard',
        tax_jurisdiction_code: 'nl',
      },
    })
  })

  it('builds an import body only for completely mapped orders', () => {
    const complete = makeOrder()
    const incomplete = makeOrder({
      id: '1002',
      line_items: [{ id: '5002', title: 'Sticker', already_imported: false, skip_reason: null }],
    })

    expect(buildImportableOrders([complete, incomplete], {
      5001: { type: 'product', product_id: 1 },
    })).toEqual([{
      shopify_order_id: '1001',
      lines: [{ shopify_line_id: '5001', mapping: { type: 'product', product_id: 1 } }],
    }])
  })

  it('preserves tax metadata when switching revenue accounts', () => {
    const existing = {
      type: 'revenue',
      account_code: '42000',
      vat_rate: 9,
      tax_category_code: 'domestic_reduced',
      tax_jurisdiction_code: 'nl',
    }

    expect(mappingFromSelection('revenue:43000', existing, 21, 'nl')).toEqual({
      ...existing,
      account_code: '43000',
    })
  })
})
