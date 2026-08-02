import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ShopifyPayoutDialog from '../components/merch/ShopifyPayoutDialog.tsx'
import {
  createCustomShopifyPayout,
  listManualShopifyPayouts,
  settleShopifyPayoutManually,
} from '../api/merch.ts'
import { listAccounts } from '../api/accounts.ts'
import theme from '../theme.ts'

vi.mock('../api/merch.ts', () => ({
  createCustomShopifyPayout: vi.fn(),
  listManualShopifyPayouts: vi.fn(),
  refreshManualShopifyPayouts: vi.fn(),
  settleShopifyPayoutManually: vi.fn(),
}))

vi.mock('../api/accounts.ts', () => ({ listAccounts: vi.fn() }))

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const PAYOUT = {
  id: 9,
  shopify_payout_id: '9001',
  issued_at: '2026-06-03T10:00:00Z',
  transaction_type: 'DEPOSIT',
  currency: 'EUR',
  net_cents: 3530,
  external_trace_id: 'TRACE-9001',
  ready: true,
  orders: [{ id: 3, order_name: '#1001', shopify_order_id: '1001', net_cents: 3530 }],
  adjustments: [],
}

const CUSTOM_CANDIDATE = {
  order_financial_id: 3,
  order_name: '#1001',
  shopify_order_id: '1001',
  processed_at: '2025-01-24T15:13:05Z',
  source_payout_id: '124345811272',
  currency: 'EUR',
  net_cents: 3530,
  balance_transaction_ids: [17],
}

describe('ShopifyPayoutDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listManualShopifyPayouts.mockResolvedValue({
      items: [PAYOUT], custom_candidates: [], meta: { limit: 100 },
    })
    listAccounts.mockResolvedValue([
      { code: '42000', name: 'Merchandise Sales', type: 'revenue', is_active: true },
      { code: '64100', name: 'Payment Processing Fees', type: 'expense', is_active: true },
    ])
    settleShopifyPayoutManually.mockResolvedValue({
      payout: { ...PAYOUT, settlement_method: 'manual' },
    })
    createCustomShopifyPayout.mockResolvedValue({
      items: [PAYOUT], custom_candidates: [], meta: { limit: 100 },
    })
  })

  it('records a ready payout on the primary bank account and removes it from the list', async () => {
    const onClose = vi.fn()
    wrap(<ShopifyPayoutDialog onClose={onClose} />)

    expect(await screen.findByText('Shopify payout 9001')).toBeInTheDocument()
    expect(screen.getByText('#1001')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record on bank account' }))

    await waitFor(() => expect(settleShopifyPayoutManually).toHaveBeenCalledWith(9, {
      entry_date: '2026-06-03',
      adjustment_mappings: [],
    }))
    expect(await screen.findByText('Payout recorded on the primary bank account.')).toBeInTheDocument()
    expect(screen.queryByText('Shopify payout 9001')).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('creates a local payout from an older imported Shopify order', async () => {
    listManualShopifyPayouts.mockResolvedValue({
      items: [], custom_candidates: [CUSTOM_CANDIDATE], meta: { limit: 100 },
    })
    wrap(<ShopifyPayoutDialog onClose={vi.fn()} />)

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Create custom payout' }))
    await userEvent.setup().type(screen.getByLabelText('Reference'), 'Legacy payout January')
    await userEvent.setup().click(screen.getByRole('checkbox', { name: /#1001/ }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create payout' }))

    await waitFor(() => expect(createCustomShopifyPayout).toHaveBeenCalledWith({
      reference: 'Legacy payout January',
      issued_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      net_cents: 3530,
      balance_transaction_ids: [17],
    }))
  })
})
