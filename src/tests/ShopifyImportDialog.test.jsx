import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/merch.ts', () => ({
  fetchShopifyOrders: vi.fn(),
  importShopifyOrders: vi.fn(),
}))
vi.mock('../api/accounts.ts', () => ({
  listAccounts: vi.fn(),
}))

import * as api from '../api/merch.ts'
import * as accountsApi from '../api/accounts.ts'
import ShopifyImportDialog from '../components/merch/ShopifyImportDialog.tsx'
import theme from '../theme.ts'

const PRODUCTS = [
  { id: 1, name: 'Band T-Shirt', unit_cost_cents: 1200, default_price_incl_cents: 3630, vat_rate: '21.00', quantity_on_hand: 9, archived_at: null },
]

const ACCOUNTS = [
  { code: '11000', name: 'Primary Bank Account', type: 'asset', is_active: true },
  { code: '42000', name: 'Merchandise Sales', type: 'revenue', is_active: true },
  { code: '43000', name: 'Other revenue', type: 'revenue', is_active: true },
]

function makeOrder(overrides = {}, lineOverrides = {}) {
  return {
    id: '1001',
    name: '#1001',
    created_at: '2026-06-01T10:00:00Z',
    processed_at: '2026-06-01T10:00:00Z',
    financial_status: 'paid',
    fulfillment_status: 'fulfilled',
    cancelled_at: null,
    currency: 'EUR',
    taxes_included: true,
    total_incl_cents: 3630,
    skip_reason: null,
    fully_imported: false,
    line_items: [{
      id: '5001', title: 'Band T-Shirt', sku: 'TS', quantity: 1, current_quantity: 1,
      price: '36.30', total_discount: '0.00', already_imported: false, skip_reason: null,
      ...lineOverrides,
    }],
    ...overrides,
  }
}

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchShopifyOrders.mockResolvedValue({ orders: [makeOrder()], nextCursor: null })
  api.importShopifyOrders.mockResolvedValue({ imported: 1, skipped: 0, results: [{ shopify_line_id: '5001', status: 'imported' }] })
  accountsApi.listAccounts.mockResolvedValue(ACCOUNTS)
})

describe('ShopifyImportDialog', () => {
  it('runs the two-step flow and imports a product-mapped line', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<ShopifyImportDialog products={PRODUCTS} onClose={onClose} />)

    // Step 1: order shown, select it, go to mapping.
    expect(await screen.findByText('#1001')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /next \(1\)/i }))

    // Step 2: the line defaults to the matching product; import it.
    expect(await screen.findByText('Map to')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /import 1 line/i }))

    await waitFor(() => expect(api.importShopifyOrders).toHaveBeenCalledWith({
      orders: [{
        shopify_order_id: '1001',
        lines: [{ shopify_line_id: '5001', mapping: { type: 'product', product_id: 1 } }],
      }],
    }))
    expect(await screen.findByText(/imported 1 line/i)).toBeInTheDocument()
  })

  it('maps a line to a revenue account', async () => {
    // A line whose title matches no product defaults to skip.
    api.fetchShopifyOrders.mockResolvedValue({
      orders: [makeOrder({}, { id: '5002', title: 'Shipping' })],
      nextCursor: null,
    })
    const user = userEvent.setup()
    wrap(<ShopifyImportDialog products={PRODUCTS} onClose={vi.fn()} />)

    await screen.findByText('#1001')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /next/i }))

    await screen.findByText('Map to')
    await user.click(screen.getByRole('combobox'))
    const listbox = await screen.findByRole('listbox')
    // Only revenue accounts are offered (the bank asset is filtered out).
    expect(within(listbox).queryByText(/Primary Bank Account/)).toBeNull()
    await user.click(within(listbox).getByText(/43000 — Other revenue/))

    await user.click(screen.getByRole('button', { name: /import 1 line/i }))
    await waitFor(() => expect(api.importShopifyOrders).toHaveBeenCalledWith({
      orders: [{
        shopify_order_id: '1001',
        lines: [{ shopify_line_id: '5002', mapping: { type: 'revenue', account_code: '43000', vat_rate: 21 } }],
      }],
    }))
  })

  it('shows an actionable message when the Shopify app is not installed', async () => {
    api.fetchShopifyOrders.mockRejectedValue(Object.assign(new Error('shopify_auth_failed'), {
      status: 400,
      body: { error: 'shopify_auth_failed', code: 'app_not_installed', message: 'The application is not installed on this shop.' },
    }))
    wrap(<ShopifyImportDialog products={PRODUCTS} onClose={vi.fn()} />)
    expect(await screen.findByText(/isn't installed on your Shopify store/i)).toBeInTheDocument()
  })

  it('shows a settings link when Shopify is not configured', async () => {
    api.fetchShopifyOrders.mockRejectedValue(Object.assign(new Error('bad'), { body: { error: 'shopify_not_configured' } }))
    wrap(<ShopifyImportDialog products={PRODUCTS} onClose={vi.fn()} />)
    expect(await screen.findByText(/isn't connected yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument()
  })
})
