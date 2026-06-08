import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/purchases.js', () => ({
  updatePurchase: vi.fn(async () => ({})),
  getPurchase: vi.fn(),
  deletePurchase: vi.fn(async () => {}),
  registerPurchasePayment: vi.fn(async () => ({ id: 5, status: 'paid' })),
}))

vi.mock('../api/contacts.js', () => ({
  searchContacts: vi.fn(async () => []),
  createContact: vi.fn(),
}))

import * as purchasesApi from '../api/purchases.js'
import PurchaseDetails from '../components/PurchaseDetails.jsx'
import theme from '../theme.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

function purchase(overrides = {}) {
  return {
    id: 5,
    receipt_number: 5,
    status: 'approved',
    finalized_at: '2026-06-04T00:00:00.000Z',
    supplier_name: 'mi5 Studios',
    supplier_contact_id: null,
    receipt_date: '2026-06-03',
    due_date: null,
    currency: 'EUR',
    subtotal_cents: 103306,
    tax_cents: 21694,
    total_cents: 125000,
    lines: [{ description: 'Studio', expense_category: 'Equipment', tax_rate: 21, amount_incl_cents: 125000, position: 0 }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PurchaseDetails', () => {
  it('registers payment on an approved unpaid purchase', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({ status: 'approved' }))
    const user = userEvent.setup()

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    const payBtn = screen.getByRole('button', { name: /register payment/i })
    expect(payBtn).toBeEnabled()

    await user.click(payBtn)

    await waitFor(() => expect(purchasesApi.registerPurchasePayment).toHaveBeenCalledWith(5, {}))
  })

  it('does not register payment on a draft purchase', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({ status: 'draft', finalized_at: null }))

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    expect(screen.getByRole('button', { name: /register payment/i })).toBeDisabled()
  })

  it('shows an already-paid purchase as payment registered and disabled', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({ status: 'paid' }))

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    expect(screen.getByRole('button', { name: /payment registered/i })).toBeDisabled()
  })
})
