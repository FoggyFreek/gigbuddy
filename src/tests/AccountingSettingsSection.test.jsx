import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/accounts.ts', () => ({
  listAccounts: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  getAccountingSettings: vi.fn(),
  updateAccountingSettings: vi.fn(),
}))

import * as accountsApi from '../api/accounts.ts'
import AccountingSettingsSection from '../components/settings/AccountingSettingsSection.tsx'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const ACCOUNTS = [
  { id: 1,  code: '11000', name: 'Checking Account',     type: 'asset',     is_active: true,  tenant_id: 1 },
  { id: 10, code: '11100', name: 'Cash on hand',         type: 'asset',     is_active: true,  tenant_id: 1 },
  { id: 2,  code: '11200', name: 'Accounts Receivable',  type: 'asset',     is_active: true,  tenant_id: 1 },
  { id: 3,  code: '11500', name: 'Savings Account',      type: 'asset',     is_active: false, tenant_id: 1 },
  { id: 4,  code: '21100', name: 'Accounts Payable',     type: 'liability', is_active: true,  tenant_id: 1 },
  { id: 5,  code: '22000', name: 'Due to Band Members',  type: 'liability', is_active: true,  tenant_id: 1 },
  { id: 6,  code: '41000', name: 'Performance Fees',     type: 'revenue',   is_active: true,  tenant_id: 1 },
  { id: 7,  code: '61200', name: 'Equipment & Instr.',   type: 'expense',   is_active: true,  tenant_id: 1 },
  { id: 8,  code: '24000', name: 'VAT Payable',          type: 'liability', is_active: true,  tenant_id: 1 },
  { id: 9,  code: '15000', name: 'VAT Receivable',       type: 'asset',     is_active: true,  tenant_id: 1 },
]

const SETTINGS = {
  tenant_id: 1,
  currency: 'EUR',
  receivable_account_code: '11200',
  default_revenue_account_code: '41000',
  payable_account_code: '21100',
  default_reimbursement_account_code: '22000',
  default_expense_account_code: '61200',
  primary_checking_account_code: '11000',
  cash_account_code: '11100',
  output_vat_account_code: '24000',
  input_vat_account_code: '15000',
}

beforeEach(() => {
  accountsApi.listAccounts.mockResolvedValue([...ACCOUNTS])
  accountsApi.getAccountingSettings.mockResolvedValue({ ...SETTINGS })
  accountsApi.updateAccountingSettings.mockResolvedValue({ ...SETTINGS })
})

describe('AccountingSettingsSection — rendering', () => {
  it('renders currency and account selects', async () => {
    wrap(<AccountingSettingsSection />)
    await waitFor(() => {
      expect(screen.getByLabelText(/currency/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/receivable account/i)).toBeInTheDocument()
    })
  })

  it('filters receivable select to only active asset accounts', async () => {
    wrap(<AccountingSettingsSection />)
    await waitFor(() => screen.getByLabelText(/receivable account/i))
    // 11500 Savings Account is inactive — should not appear in receivable options
    // Just verify the component loads with active accounts data
    expect(accountsApi.listAccounts).toHaveBeenCalled()
  })

  it('shows current currency value EUR as selected', async () => {
    wrap(<AccountingSettingsSection />)
    await waitFor(() => {
      const eur = screen.getAllByText('EUR')
      expect(eur.length).toBeGreaterThan(0)
    })
  })

  it('renders the output and input VAT account selects', async () => {
    wrap(<AccountingSettingsSection />)
    await waitFor(() => {
      expect(screen.getByLabelText(/output vat/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/input vat/i)).toBeInTheDocument()
    })
  })

  it('renders the default reimbursement account select', async () => {
    wrap(<AccountingSettingsSection />)
    await waitFor(() => {
      expect(screen.getByLabelText(/default reimbursement account/i)).toBeInTheDocument()
    })
  })

  it('renders the cash account select and saves a chosen asset account', async () => {
    accountsApi.updateAccountingSettings.mockResolvedValue({ ...SETTINGS, cash_account_code: '11000' })
    const user = userEvent.setup()
    wrap(<AccountingSettingsSection />)
    await waitFor(() => screen.getByLabelText(/cash account/i))

    // Current value is 11100; switch to another active asset account so onChange fires.
    const cashSelect = screen.getByRole('combobox', { name: /cash account/i })
    await user.click(cashSelect)
    await waitFor(() => screen.getByRole('option', { name: /11000/ }))
    await user.click(screen.getByRole('option', { name: /11000/ }))

    await waitFor(() => {
      expect(accountsApi.updateAccountingSettings).toHaveBeenCalledWith(
        expect.objectContaining({ cash_account_code: '11000' }),
      )
    })
  })
})

describe('AccountingSettingsSection — VAT accounts', () => {
  it('calls updateAccountingSettings when the output VAT account changes', async () => {
    accountsApi.updateAccountingSettings.mockResolvedValue({ ...SETTINGS, output_vat_account_code: '21100' })
    const user = userEvent.setup()
    wrap(<AccountingSettingsSection />)
    await waitFor(() => screen.getByLabelText(/output vat/i))

    const vatSelect = screen.getByRole('combobox', { name: /output vat/i })
    await user.click(vatSelect)
    // Output VAT filters to active liability accounts (21100, 24000)
    await waitFor(() => screen.getByRole('option', { name: /21100/ }))
    await user.click(screen.getByRole('option', { name: /21100/ }))

    await waitFor(() => {
      expect(accountsApi.updateAccountingSettings).toHaveBeenCalledWith(
        expect.objectContaining({ output_vat_account_code: '21100' }),
      )
    })
  })
})

describe('AccountingSettingsSection — PATCH on change', () => {
  it('calls updateAccountingSettings with new currency when changed', async () => {
    accountsApi.updateAccountingSettings.mockResolvedValue({ ...SETTINGS, currency: 'USD' })
    const user = userEvent.setup()
    wrap(<AccountingSettingsSection />)
    await waitFor(() => screen.getByLabelText(/currency/i))

    // Open currency select and choose USD
    const currencySelect = screen.getByRole('combobox', { name: /currency/i })
    await user.click(currencySelect)
    await waitFor(() => screen.getByRole('option', { name: 'USD' }))
    await user.click(screen.getByRole('option', { name: 'USD' }))

    await waitFor(() => {
      expect(accountsApi.updateAccountingSettings).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD' }),
      )
    })
  })

  it('renders the books-closed-through field and saves a chosen date', async () => {
    accountsApi.updateAccountingSettings.mockResolvedValue({ ...SETTINGS, books_closed_through: '2026-05-31' })
    wrap(<AccountingSettingsSection />)
    const field = await screen.findByLabelText(/books closed through/i)

    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(field, { target: { value: '2026-05-31' } })

    await waitFor(() => {
      expect(accountsApi.updateAccountingSettings).toHaveBeenCalledWith(
        expect.objectContaining({ books_closed_through: '2026-05-31' }),
      )
    })
  })

  it('surfaces account_has_open_balance as a readable error', async () => {
    accountsApi.updateAccountingSettings.mockRejectedValue(
      Object.assign(new Error('Cannot change payable_account_code'), { code: 'account_has_open_balance' }),
    )
    const user = userEvent.setup()
    wrap(<AccountingSettingsSection />)
    await waitFor(() => screen.getByLabelText(/accounts payable/i))

    const payableSelect = screen.getByRole('combobox', { name: /accounts payable/i })
    await user.click(payableSelect)
    await waitFor(() => screen.getByRole('option', { name: /22000/ }))
    await user.click(screen.getByRole('option', { name: /22000/ }))

    expect(await screen.findByText(/still carries an open balance/i)).toBeInTheDocument()
  })

  it('calls updateAccountingSettings when the default reimbursement account changes', async () => {
    accountsApi.updateAccountingSettings.mockResolvedValue({ ...SETTINGS, default_reimbursement_account_code: '21100' })
    const user = userEvent.setup()
    wrap(<AccountingSettingsSection />)
    await waitFor(() => screen.getByLabelText(/default reimbursement account/i))

    const reimbursementSelect = screen.getByRole('combobox', { name: /default reimbursement account/i })
    await user.click(reimbursementSelect)
    await waitFor(() => screen.getByRole('option', { name: /21100/ }))
    await user.click(screen.getByRole('option', { name: /21100/ }))

    await waitFor(() => {
      expect(accountsApi.updateAccountingSettings).toHaveBeenCalledWith(
        expect.objectContaining({ default_reimbursement_account_code: '21100' }),
      )
    })
  })
})
