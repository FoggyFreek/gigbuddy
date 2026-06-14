import { render, screen, waitFor, within } from '@testing-library/react'
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
import ChartOfAccountsSection from '../components/settings/ChartOfAccountsSection.jsx'
import theme from '../theme.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const ACCOUNTS = [
  { id: 1,  code: '60000', name: 'Operating Expenses',   type: 'expense', parent_code: null,    is_active: true,  is_system: true,  tenant_id: 1 },
  { id: 2,  code: '61000', name: 'Band & Performance',   type: 'expense', parent_code: '60000', is_active: true,  is_system: true,  tenant_id: 1 },
  { id: 3,  code: '61200', name: 'Equipment & Instr.',   type: 'expense', parent_code: '61000', is_active: true,  is_system: true,  tenant_id: 1 },
  { id: 4,  code: '61999', name: 'Touring Expenses',     type: 'expense', parent_code: '61000', is_active: false, is_system: false, tenant_id: 1 },
  // depth-3 custom sub-account under 61999
  { id: 5,  code: '61998', name: 'Festival Costs',       type: 'expense', parent_code: '61999', is_active: true,  is_system: false, tenant_id: 1 },
  { id: 10, code: '11000', name: 'Checking Account',     type: 'asset',   parent_code: null,    is_active: true,  is_system: true,  tenant_id: 1 },
]

beforeEach(() => {
  accountsApi.listAccounts.mockResolvedValue([...ACCOUNTS])
  accountsApi.createAccount.mockResolvedValue({ id: 99, code: '61997', name: 'New', type: 'expense', parent_code: '61000', is_active: true, is_system: false, tenant_id: 1 })
  accountsApi.updateAccount.mockResolvedValue({ ...ACCOUNTS[3], is_active: false })
  accountsApi.deleteAccount.mockResolvedValue(null)
})

describe('ChartOfAccountsSection — rendering', () => {
  it('renders accounts grouped by type', async () => {
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => {
      expect(screen.getByText('Expenses')).toBeInTheDocument()
      expect(screen.getByText('Assets')).toBeInTheDocument()
    })
    expect(screen.getByText('Operating Expenses')).toBeInTheDocument()
    expect(screen.getByText('Band & Performance')).toBeInTheDocument()
  })

  it('renders a depth-3 sub-account under its depth-2 parent', async () => {
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => {
      expect(screen.getByText('Festival Costs')).toBeInTheDocument()
    })
    expect(screen.getByText('Touring Expenses')).toBeInTheDocument()
  })

  it('shows Inactive chip for deactivated accounts', async () => {
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeInTheDocument()
    })
  })

  it('renders account codes in monospace style', async () => {
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => {
      expect(screen.getByText('61200')).toBeInTheDocument()
    })
  })
})

describe('ChartOfAccountsSection — add child', () => {
  it('opens add-child dialog with parent type inherited and calls createAccount', async () => {
    const user = userEvent.setup()
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => screen.getByText('Band & Performance'))

    // Click add-child on "Band & Performance" (61000)
    const row = screen.getByTestId('account-row-2')
    await user.click(within(row).getByRole('button', { name: /add sub-account/i }))

    // Dialog opens
    await waitFor(() => screen.getByRole('dialog'))

    // Type a name
    await user.type(screen.getByLabelText(/account name/i), 'Touring')
    // Enter code
    const codeInput = screen.getByLabelText(/account code/i)
    await user.clear(codeInput)
    await user.type(codeInput, '61997')

    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => {
      expect(accountsApi.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'expense', parent_code: '61000', name: 'Touring', code: '61997' }),
      )
    })
  })
})

describe('ChartOfAccountsSection — deactivate', () => {
  it('calls updateAccount with is_active:false on deactivate', async () => {
    accountsApi.updateAccount.mockResolvedValue({ ...ACCOUNTS[2], is_active: false })
    accountsApi.listAccounts.mockResolvedValueOnce([...ACCOUNTS]).mockResolvedValueOnce(
      ACCOUNTS.map((a) => (a.id === 3 ? { ...a, is_active: false } : a)),
    )
    const user = userEvent.setup()
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => screen.getByText('Equipment & Instr.'))

    const row = screen.getByTestId('account-row-3')
    await user.click(within(row).getByRole('button', { name: /deactivate/i }))

    await waitFor(() => {
      expect(accountsApi.updateAccount).toHaveBeenCalledWith(3, { is_active: false })
    })
  })
})

describe('ChartOfAccountsSection — capitalizable', () => {
  it('toggles is_capitalizable on an asset account', async () => {
    accountsApi.updateAccount.mockResolvedValue({ ...ACCOUNTS[5], is_capitalizable: true })
    const user = userEvent.setup()
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => screen.getByText('Checking Account'))

    const row = screen.getByTestId('account-row-10')
    await user.click(within(row).getByRole('button', { name: /set capitalizable/i }))

    await waitFor(() => {
      expect(accountsApi.updateAccount).toHaveBeenCalledWith(10, { is_capitalizable: true })
    })
  })

  it('does not render a capitalizable toggle on expense accounts', async () => {
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => screen.getByText('Equipment & Instr.'))
    const row = screen.getByTestId('account-row-3')
    expect(within(row).queryByRole('button', { name: /capitalizable/i })).toBeNull()
  })

  it('shows a Capitalizable chip for flagged asset accounts', async () => {
    accountsApi.listAccounts.mockResolvedValue(
      ACCOUNTS.map((a) => (a.id === 10 ? { ...a, is_capitalizable: true } : a)),
    )
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => screen.getByText('Capitalizable'))
  })
})

describe('ChartOfAccountsSection — 409 in-use error', () => {
  it('shows account_in_use helper text when deactivate returns 409', async () => {
    accountsApi.updateAccount.mockRejectedValue(
      Object.assign(new Error('account_in_use'), { status: 409 }),
    )
    const user = userEvent.setup()
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => screen.getByText('Equipment & Instr.'))

    const row = screen.getByTestId('account-row-3')
    await user.click(within(row).getByRole('button', { name: /deactivate/i }))

    await waitFor(() => {
      expect(screen.getByText(/in use/i)).toBeInTheDocument()
    })
  })

  it('shows account_in_use helper text when delete returns 409', async () => {
    accountsApi.deleteAccount.mockRejectedValue(
      Object.assign(new Error('account_in_use'), { status: 409 }),
    )
    const user = userEvent.setup()
    wrap(<ChartOfAccountsSection />)
    await waitFor(() => screen.getByText('Touring Expenses'))

    // 61999 is deactivated (is_active:false) so delete button should show
    const row = screen.getByTestId('account-row-4')
    await user.click(within(row).getByRole('button', { name: /delete/i }))
    // Confirm the delete dialog
    await waitFor(() => screen.getByRole('button', { name: /confirm/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => {
      expect(screen.getByText(/in use/i)).toBeInTheDocument()
    })
  })
})
