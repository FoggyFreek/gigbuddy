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

vi.mock('../api/accounts.js', () => ({
  listAccounts: vi.fn(async () => [
    { id: 1, code: '62100', name: 'Instruments & Equipment', type: 'expense', is_active: true },
    { id: 2, code: '61100', name: 'Travel & Lodging', type: 'expense', is_active: true },
    { id: 3, code: '99000', name: 'Retired Account', type: 'expense', is_active: false },
    { id: 4, code: '15000', name: 'VAT Receivable', type: 'asset', is_active: true },
  ]),
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
    lines: [{ description: 'Studio', account_code: '62100', tax_rate: 21, amount_incl_cents: 125000, position: 0 }],
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

  it('saves the selected expense account code and preserves VAT fields', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({ status: 'draft', finalized_at: null }))
    const user = userEvent.setup()

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    // Wait for the accounts to load (the seeded line resolves to an active account).
    await screen.findByDisplayValue(/62100 — Instruments & Equipment/)

    // Type to filter the account combobox down to a single match, then pick it.
    const accountInput = screen.getByRole('combobox', { name: /expense account/i })
    await user.click(accountInput)
    await user.clear(accountInput)
    await user.type(accountInput, 'Travel')
    await user.click(await screen.findByRole('option', { name: /61100 — Travel & Lodging/ }))

    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    await waitFor(() => expect(purchasesApi.updatePurchase).toHaveBeenCalled())
    const [, payload] = purchasesApi.updatePurchase.mock.calls[0]
    expect(payload.lines[0].account_code).toBe('61100')
    // VAT-bearing fields survive the round-trip (VAT amount is derived from these).
    expect(payload.lines[0].tax_rate).toBe(21)
    expect(payload.lines[0].amount_incl_cents).toBe(125000)
  })

  it('blocks save and surfaces a message when a line keeps an inactive account', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({
      status: 'draft',
      finalized_at: null,
      lines: [{ description: 'Studio', account_code: '99000', tax_rate: 21, amount_incl_cents: 125000, position: 0 }],
    }))
    const user = userEvent.setup()

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    // The stale code is kept visible as the field's (disabled) value.
    await screen.findByDisplayValue(/99000 — Inactive\/unknown account/)

    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    expect(await screen.findByText(/replace the inactive expense account/i)).toBeInTheDocument()
    expect(purchasesApi.updatePurchase).not.toHaveBeenCalled()
  })
})
