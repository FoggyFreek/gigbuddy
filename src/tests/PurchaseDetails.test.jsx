import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// pdf.js can't run in jsdom (no DOMMatrix/worker); stub the react-pdf surface.
vi.mock('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}))

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
  getAccountingSettings: vi.fn(async () => ({
    default_expense_account_code: '62100',
    primary_checking_account_code: '11000',
  })),
  listAccounts: vi.fn(async () => [
    { id: 0, code: '11000', name: 'Checking Account', type: 'asset', is_active: true },
    { id: 1, code: '62100', name: 'Instruments & Equipment', type: 'expense', is_active: true },
    { id: 2, code: '61100', name: 'Travel & Lodging', type: 'expense', is_active: true },
    { id: 3, code: '99000', name: 'Retired Account', type: 'expense', is_active: false },
    { id: 4, code: '15000', name: 'VAT Receivable', type: 'asset', is_active: true },
  ]),
}))

vi.mock('../api/bandMembers.js', () => ({
  listMembers: vi.fn(async () => [
    { id: 1, user_id: 11, name: 'Alice', role: 'Guitar', position: 'lead' },
    { id: 2, user_id: null, name: 'Session Player', role: 'Keys', position: 'sub' },
    { id: 3, user_id: 12, name: 'Bob', role: 'Drums', position: 'lead' },
  ]),
}))

import * as purchasesApi from '../api/purchases.js'
import * as accountsApi from '../api/accounts.js'
import * as bandMembersApi from '../api/bandMembers.js'
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
  it('registers a bank payment on an approved unpaid purchase', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({ status: 'approved' }))
    const user = userEvent.setup()

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    const payBtn = screen.getByRole('button', { name: /register payment/i })
    expect(payBtn).toBeEnabled()

    await user.click(payBtn)

    expect(await screen.findByRole('heading', { name: /register payment/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/paid on/i), { target: { value: '2026-06-10' } })
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    await waitFor(() =>
      expect(purchasesApi.registerPurchasePayment).toHaveBeenCalledWith(5, {
        method: 'bank',
        paid_on: '2026-06-10',
      }),
    )
  })

  it('registers a band-member payment with the selected band member id', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({ status: 'approved' }))
    const user = userEvent.setup()

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    await waitFor(() => expect(bandMembersApi.listMembers).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /register payment/i }))
    await user.click(await screen.findByLabelText(/band member/i))

    const payeeInput = screen.getByRole('combobox', { name: /paid by/i })
    await user.click(payeeInput)
    await user.type(payeeInput, 'Bob')
    await user.click(await screen.findByRole('option', { name: /Bob/ }))

    fireEvent.change(screen.getByLabelText(/paid on/i), { target: { value: '2026-06-10' } })
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    await waitFor(() =>
      expect(purchasesApi.registerPurchasePayment).toHaveBeenCalledWith(5, {
        method: 'member',
        paid_by_band_member_id: 3,
        paid_on: '2026-06-10',
      }),
    )
  })

  it('requires selecting a band member before submitting a member payment', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({ status: 'approved' }))
    const user = userEvent.setup()

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    await user.click(screen.getByRole('button', { name: /register payment/i }))
    await user.click(await screen.findByLabelText(/band member/i))
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    expect(await screen.findByText(/choose the band member/i)).toBeInTheDocument()
    expect(purchasesApi.registerPurchasePayment).not.toHaveBeenCalled()
  })

  it('shows band members even when they are not linked to user accounts', async () => {
    bandMembersApi.listMembers.mockResolvedValueOnce([
      { id: 1, user_id: null, name: 'Unlinked', role: 'Guitar', position: 'lead' },
    ])
    purchasesApi.getPurchase.mockResolvedValue(purchase({ status: 'approved' }))
    const user = userEvent.setup()

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    await user.click(screen.getByRole('button', { name: /register payment/i }))

    expect(await screen.findByLabelText(/band member/i)).toBeEnabled()
    await user.click(screen.getByLabelText(/band member/i))

    const payeeInput = screen.getByRole('combobox', { name: /paid by/i })
    await user.click(payeeInput)
    await user.click(await screen.findByRole('option', { name: /Unlinked/ }))
    fireEvent.change(screen.getByLabelText(/paid on/i), { target: { value: '2026-06-10' } })
    await user.click(screen.getByRole('button', { name: /^register$/i }))

    await waitFor(() =>
      expect(purchasesApi.registerPurchasePayment).toHaveBeenCalledWith(5, {
        method: 'member',
        paid_by_band_member_id: 1,
        paid_on: '2026-06-10',
      }),
    )
  })

  it('does not register payment on a draft purchase', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({ status: 'draft', finalized_at: null }))

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    expect(screen.getByRole('button', { name: /register payment/i })).toBeDisabled()
  })

  it('shows the checking account for an already-paid bank purchase', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({
      status: 'paid',
      payment_method: 'bank',
      paid_at: '2026-06-10',
    }))

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    expect(screen.queryByRole('button', { name: /payment registered|register payment/i })).not.toBeInTheDocument()
    expect(await screen.findByText(/paid from/i)).toBeInTheDocument()
    expect(screen.getByText('11000 - Checking Account')).toBeInTheDocument()
  })

  it('shows the band member for an already-paid member purchase', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({
      status: 'paid',
      payment_method: 'member',
      paid_by_band_member_id: 3,
      paid_at: '2026-06-10',
    }))

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    expect(screen.queryByRole('button', { name: /payment registered|register payment/i })).not.toBeInTheDocument()
    expect(await screen.findByText(/paid by/i)).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('saves the selected expense account code and preserves VAT fields', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({ status: 'draft', finalized_at: null }))
    const user = userEvent.setup()

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    // Wait for the accounts to load (the seeded line resolves to an active account).
    await screen.findByDisplayValue(/62100 - Instruments & Equipment/)

    // Type to filter the account combobox down to a single match, then pick it.
    const accountInput = screen.getByRole('combobox', { name: /expense account/i })
    await user.click(accountInput)
    await user.clear(accountInput)
    await user.type(accountInput, 'Travel')
    await user.click(await screen.findByRole('option', { name: /61100 - Travel & Lodging/ }))

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
    await screen.findByDisplayValue(/99000 - Inactive\/unknown account/)

    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    expect(await screen.findByText(/replace the inactive expense account/i)).toBeInTheDocument()
    expect(purchasesApi.updatePurchase).not.toHaveBeenCalled()
  })

  it('marks empty line inputs before approving', async () => {
    accountsApi.getAccountingSettings.mockResolvedValueOnce({ default_expense_account_code: null })
    purchasesApi.getPurchase.mockResolvedValue(purchase({
      status: 'draft',
      finalized_at: null,
      lines: [{ description: '', account_code: '', tax_rate: 21, amount_incl_cents: 0, position: 0 }],
    }))
    const user = userEvent.setup()

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    await waitFor(() => expect(accountsApi.getAccountingSettings).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /^approve$/i }))

    expect(await screen.findByText(/complete the highlighted purchase line fields/i)).toBeInTheDocument()
    expect(screen.getByText(/enter a description/i)).toBeInTheDocument()
    expect(screen.getByText(/choose an expense account/i)).toBeInTheDocument()
    expect(screen.getByText(/enter an amount greater than zero/i)).toBeInTheDocument()
    expect(purchasesApi.updatePurchase).not.toHaveBeenCalled()
  })

  it('maps a missing default expense account response to the account input', async () => {
    purchasesApi.getPurchase.mockResolvedValue(purchase({
      status: 'draft',
      finalized_at: null,
      lines: [{ description: 'Studio', account_code: '', tax_rate: 21, amount_incl_cents: 125000, position: 0 }],
    }))
    purchasesApi.updatePurchase.mockRejectedValueOnce(Object.assign(
      new Error('Accounting setting not configured: default_expense_account_code'),
      { code: 'accounting_not_configured', field: 'default_expense_account_code', status: 409 },
    ))
    const user = userEvent.setup()

    wrap(<PurchaseDetails mode="edit" purchaseId={5} onClose={() => {}} embedded />)

    await screen.findByText('Purchase 5')
    await user.click(screen.getByRole('button', { name: /^approve$/i }))

    expect(await screen.findByText(/configure a default expense account/i)).toBeInTheDocument()
    expect(screen.getAllByText(/choose an expense account/i).length).toBeGreaterThan(0)
  })
})
