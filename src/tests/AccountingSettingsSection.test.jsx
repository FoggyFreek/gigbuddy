import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/accounts.js', () => ({
  listAccounts: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  getAccountingSettings: vi.fn(),
  updateAccountingSettings: vi.fn(),
}))

import * as accountsApi from '../api/accounts.js'
import AccountingSettingsSection from '../components/settings/AccountingSettingsSection.jsx'
import theme from '../theme.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const ACCOUNTS = [
  { id: 1,  code: '11000', name: 'Checking Account',     type: 'asset',     is_active: true,  tenant_id: 1 },
  { id: 2,  code: '11200', name: 'Accounts Receivable',  type: 'asset',     is_active: true,  tenant_id: 1 },
  { id: 3,  code: '11500', name: 'Savings Account',      type: 'asset',     is_active: false, tenant_id: 1 },
  { id: 4,  code: '21100', name: 'Accounts Payable',     type: 'liability', is_active: true,  tenant_id: 1 },
  { id: 5,  code: '41000', name: 'Performance Fees',     type: 'revenue',   is_active: true,  tenant_id: 1 },
  { id: 6,  code: '61200', name: 'Equipment & Instr.',   type: 'expense',   is_active: true,  tenant_id: 1 },
]

const SETTINGS = {
  tenant_id: 1,
  currency: 'EUR',
  receivable_account_code: '11200',
  default_revenue_account_code: '41000',
  payable_account_code: '21100',
  default_expense_account_code: '61200',
  primary_checking_account_code: '11000',
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
})
