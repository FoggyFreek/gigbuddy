import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../contexts/authContext.ts'
import { getMyStorageStats } from '../api/statistics.ts'
import TenantSettingsPage from '../pages/TenantSettingsPage.tsx'
import theme from '../theme.ts'

vi.mock('../api/profile.ts', () => ({
  updateProfile: vi.fn().mockResolvedValue({}),
  getMollieKey: vi.fn().mockResolvedValue({ isSet: false }),
  setMollieKey: vi.fn(),
  clearMollieKey: vi.fn(),
  getBandsintownKey: vi.fn().mockResolvedValue({ isSet: false }),
  setBandsintownKey: vi.fn(),
  clearBandsintownKey: vi.fn(),
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
      <ThemeProvider theme={theme}>
        <MemoryRouter>{ui}</MemoryRouter>
      </ThemeProvider>
    </AuthContext.Provider>,
  )
}

// A plan that locks every feature and caps storage at 100 MB.
const lockedEntitlements = {
  planSlug: 'free',
  subscriptionStatus: null,
  locked: false,
  financeReadOnly: false,
  flags: {
    finance: false,
    integrations: false,
    customization: false,
    song_files: false,
    chordpro: false,
    public_promotion: false,
  },
  limits: { storage_mb: 100, members: 5, bands: 1 },
}

describe('TenantSettingsPage — admin view', () => {
  it('does not render the device theme section', () => {
    wrap(<TenantSettingsPage />)
    expect(screen.queryByText(/^theme$/i)).not.toBeInTheDocument()
  })

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

describe('TenantSettingsPage — plan gating', () => {
  it('shows premium diamonds on accent color and integrations when the plan lacks them', async () => {
    wrap(<TenantSettingsPage />, { entitlements: lockedEntitlements })
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /premium feature/i })).toHaveLength(2)
    })
  })

  it('shows no diamonds when entitlements are unenforced', async () => {
    wrap(<TenantSettingsPage />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('link', { name: /premium feature/i })).not.toBeInTheDocument()
  })

  it('shows a storage progress bar and upgrade button when a storage limit is set', async () => {
    getMyStorageStats.mockResolvedValueOnce({ storage_bytes: 50 * 1024 * 1024, object_count: 3 })
    wrap(<TenantSettingsPage />, { entitlements: lockedEntitlements })
    const bar = await screen.findByRole('progressbar', { name: /storage/i })
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByRole('button', { name: /upgrade storage/i })).toBeInTheDocument()
    expect(screen.getByText(/50\.0 MB of 100\.0 MB used/i)).toBeInTheDocument()
  })

  it('shows only the actual storage when no limit is set', async () => {
    getMyStorageStats.mockResolvedValueOnce({ storage_bytes: 50 * 1024 * 1024, object_count: 3 })
    wrap(<TenantSettingsPage />)
    await screen.findByText(/50\.0 MB/)
    expect(screen.queryByRole('progressbar', { name: /storage/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upgrade storage/i })).not.toBeInTheDocument()
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
