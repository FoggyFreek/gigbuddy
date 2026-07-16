import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../contexts/authContext.ts'
import SettingsPage from '../pages/SettingsPage.tsx'
import theme from '../theme.ts'

vi.mock('../api/billing.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getBillingState: vi.fn().mockResolvedValue({ plans: [], subscription: null, ownedTenantCount: 1 }) }
})
vi.mock('../api/notifications.ts', () => ({
  getNotificationPrefs: vi.fn().mockResolvedValue(null),
  updateNotificationPrefs: vi.fn(),
}))
vi.mock('../hooks/usePushNotifications.ts', () => ({
  usePushNotifications: () => ({ status: 'unsubscribed', subscribe: vi.fn(), unsubscribe: vi.fn() }),
}))
vi.mock('../api/profile.ts', () => ({
  updateProfile: vi.fn().mockResolvedValue({}),
  getMollieKey: vi.fn().mockResolvedValue({ isSet: false }),
  getBandsintownKey: vi.fn().mockResolvedValue({ isSet: false }),
  getShopifySecret: vi.fn().mockResolvedValue({ isSet: false }),
  getShopifyClientId: vi.fn().mockResolvedValue({ clientId: null }),
  getShopifyDomain: vi.fn().mockResolvedValue({ domain: null }),
  setMollieKey: vi.fn(), clearMollieKey: vi.fn(),
  setBandsintownKey: vi.fn(), clearBandsintownKey: vi.fn(),
  setShopifySecret: vi.fn(), clearShopifySecret: vi.fn(),
  setShopifyClientId: vi.fn(), clearShopifyClientId: vi.fn(),
  setShopifyDomain: vi.fn(), clearShopifyDomain: vi.fn(),
}))
const lockedEntitlements = {
  planSlug: 'free', locked: false, financeReadOnly: false,
  flags: { finance: false, integrations: false, customization: false },
  limits: { storage_mb: 100, members: 5, bands: 1 },
}

function wrap(route, { role = 'tenant_admin', entitlements = null } = {}) {
  const user = { id: 1, isSuperAdmin: false, activeTenantRole: role, entitlements }
  return render(
    <AuthContext.Provider value={{ user, logout: vi.fn() }}>
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:section" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </AuthContext.Provider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('SettingsPage — nav gating', () => {
  it('shows account and band-admin nav items for a tenant admin', async () => {
    wrap('/settings')
    expect(await screen.findByText('Account settings')).toBeInTheDocument()
    expect(screen.getByText('Band settings')).toBeInTheDocument()
    expect(screen.getByText('Members')).toBeInTheDocument()
    expect(screen.getByText('Integrations')).toBeInTheDocument()
    expect(screen.getByText('Chart of accounts')).toBeInTheDocument()
  })

  it('hides tenant-admin settings for a plain member', async () => {
    wrap('/settings', { role: 'contributor' })
    expect(await screen.findByText('My preferences')).toBeInTheDocument()
    expect(screen.queryByText('Accent color')).not.toBeInTheDocument()
    expect(screen.queryByText('Members')).not.toBeInTheDocument()
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument()
    expect(screen.queryByText('Chart of accounts')).not.toBeInTheDocument()
  })
})

describe('SettingsPage — plan gating', () => {
  it('marks the accent section with a premium diamond when the plan lacks customization', async () => {
    wrap('/settings/accent', { entitlements: lockedEntitlements })
    const link = await screen.findByRole('link')
    expect(link).toHaveAttribute('href', '/upgrade/customization')
  })

  it('marks the integrations section with a premium diamond when the plan lacks it', async () => {
    wrap('/settings/integrations', { entitlements: lockedEntitlements })
    const link = await screen.findByRole('link')
    expect(link).toHaveAttribute('href', '/upgrade/integrations')
  })

  it('shows no premium diamond when the tenant is unenforced (ownerless)', async () => {
    wrap('/settings/accent')
    // Wait for the nav (unique subheader) to settle, then assert no diamond link.
    await screen.findByText('Band settings')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
