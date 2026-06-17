import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../contexts/authContext.ts'
import TenantSettingsPage from '../pages/TenantSettingsPage.tsx'
import theme from '../theme.ts'

vi.mock('../api/profile.ts', () => ({
  updateProfile: vi.fn().mockResolvedValue({}),
  getMollieKey: vi.fn().mockResolvedValue({ isSet: false }),
  setMollieKey: vi.fn(),
  clearMollieKey: vi.fn(),
  getShopifySecret: vi.fn().mockResolvedValue({ isSet: false }),
  setShopifySecret: vi.fn(),
  clearShopifySecret: vi.fn(),
  getShopifyClientId: vi.fn().mockResolvedValue({ clientId: null }),
  setShopifyClientId: vi.fn().mockResolvedValue({ clientId: null }),
  clearShopifyClientId: vi.fn(),
  getShopifyDomain: vi.fn().mockResolvedValue({ domain: null }),
  setShopifyDomain: vi.fn().mockResolvedValue({ domain: null }),
  clearShopifyDomain: vi.fn(),
}))

vi.mock('../api/statistics.ts', () => ({
  getMyStorageStats: vi.fn().mockResolvedValue({ storage_bytes: 0, object_count: 0 }),
  refreshMyStorageStats: vi.fn(),
}))

vi.mock('../api/accounts.ts', () => ({
  listAccounts: vi.fn().mockResolvedValue([]),
  getAccountingSettings: vi.fn().mockResolvedValue({
    currency: 'EUR',
    receivable_account_code: '11200',
    default_revenue_account_code: '41000',
    payable_account_code: '21100',
    default_reimbursement_account_code: '22000',
    default_expense_account_code: '61200',
    primary_checking_account_code: '11000',
  }),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  updateAccountingSettings: vi.fn(),
}))

vi.mock('../contexts/profileContext.ts', () => ({
  useProfile: vi.fn(() => ({ accentColor: null, setAccentColor: vi.fn() })),
}))

function wrap(ui, userOverride = {}) {
  const user = { isSuperAdmin: false, activeTenantRole: 'tenant_admin', ...userOverride }
  return render(
    <AuthContext.Provider value={{ user, logout: vi.fn() }}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </AuthContext.Provider>,
  )
}

describe('TenantSettingsPage — admin view', () => {
  it('renders Chart of Accounts section for admins', async () => {
    wrap(<TenantSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText(/chart of accounts/i)).toBeInTheDocument()
    })
  })

  it('renders Accounting Settings section for admins', async () => {
    wrap(<TenantSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText(/accounting settings/i)).toBeInTheDocument()
    })
  })
})

describe('TenantSettingsPage — member view', () => {
  it('does not render Chart of Accounts section for plain members', async () => {
    wrap(<TenantSettingsPage />, { activeTenantRole: 'member' })
    // Wait for any async renders to settle
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/chart of accounts/i)).not.toBeInTheDocument()
  })

  it('does not render Accounting Settings section for plain members', async () => {
    wrap(<TenantSettingsPage />, { activeTenantRole: 'member' })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/accounting settings/i)).not.toBeInTheDocument()
  })
})
