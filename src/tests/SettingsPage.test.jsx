import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../contexts/authContext.ts'
import SettingsPage from '../pages/SettingsPage.tsx'
import theme from '../theme.ts'
import { clearResendKey, setResendKey } from '../api/profile.ts'

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
  getProfile: vi.fn().mockResolvedValue({ join_policy: 'invite_only' }),
  setJoinPolicy: vi.fn().mockResolvedValue({ join_policy: 'request' }),
  updateProfile: vi.fn().mockResolvedValue({}),
  getMollieKey: vi.fn().mockResolvedValue({ isSet: false }),
  getResendKey: vi.fn().mockResolvedValue({ isSet: false }),
  getBandsintownKey: vi.fn().mockResolvedValue({ isSet: false }),
  getBandsintownArtistId: vi.fn().mockResolvedValue({ artistId: null }),
  getShopifySecret: vi.fn().mockResolvedValue({ isSet: false }),
  getShopifyClientId: vi.fn().mockResolvedValue({ clientId: null }),
  getShopifyDomain: vi.fn().mockResolvedValue({ domain: null }),
  setMollieKey: vi.fn(), clearMollieKey: vi.fn(),
  setResendKey: vi.fn(), clearResendKey: vi.fn(),
  setBandsintownKey: vi.fn(), clearBandsintownKey: vi.fn(),
  setBandsintownArtistId: vi.fn(), clearBandsintownArtistId: vi.fn(),
  setShopifySecret: vi.fn(), clearShopifySecret: vi.fn(),
  setShopifyClientId: vi.fn(), clearShopifyClientId: vi.fn(),
  setShopifyDomain: vi.fn(),
}))
vi.mock('../api/users.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listMemberships: vi.fn().mockResolvedValue([]) }
})
vi.mock('../api/bandMembers.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listMembers: vi.fn().mockResolvedValue([]) }
})
vi.mock('../api/invites.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listInvites: vi.fn().mockResolvedValue([]) }
})
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
            <Route path="/finance-onboarding" element={<div>Wizard page</div>} />
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
    expect(screen.getByText('Members and invites')).toBeInTheDocument()
    expect(screen.getByText('Integrations')).toBeInTheDocument()
    expect(screen.getByText('Chart of accounts')).toBeInTheDocument()
  })

  it('hides tenant-admin settings for a plain member', async () => {
    wrap('/settings', { role: 'contributor' })
    expect(await screen.findByText('My preferences')).toBeInTheDocument()
    expect(screen.queryByText('Accent color')).not.toBeInTheDocument()
    expect(screen.queryByText('Members and invites')).not.toBeInTheDocument()
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument()
    expect(screen.queryByText('Chart of accounts')).not.toBeInTheDocument()
  })

  it('groups the finance items under their own subheader, after band settings', async () => {
    wrap('/settings')
    await screen.findByText('Finance and accounting settings')
    const texts = [...document.querySelectorAll('.MuiListSubheader-root, .MuiListItemText-primary')]
      .map((el) => el.textContent)
    expect(texts.slice(texts.indexOf('Finance and accounting settings'))).toEqual([
      'Finance and accounting settings',
      'Financial profile',
      'Accounting profile',
      'Accounting Settings',
      'Chart of accounts',
    ])
    expect(texts.indexOf('Band settings')).toBeLessThan(texts.indexOf('Finance and accounting settings'))
  })

  it('hides the finance subheader when the member cannot manage finance', async () => {
    wrap('/settings', { role: 'contributor' })
    expect(await screen.findByText('My preferences')).toBeInTheDocument()
    expect(screen.queryByText('Finance and accounting settings')).not.toBeInTheDocument()
  })

  it('gives a financial_admin the whole finance group but no band settings', async () => {
    wrap('/settings', { role: 'financial_admin' })
    expect(await screen.findByText('Finance and accounting settings')).toBeInTheDocument()
    for (const label of ['Financial profile', 'Accounting profile', 'Accounting Settings', 'Chart of accounts']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.queryByText('Band settings')).not.toBeInTheDocument()
    expect(screen.queryByText('Accent color')).not.toBeInTheDocument()
  })
})

describe('SettingsPage — finance setup wizard', () => {
  it('offers the wizard above the nav to a finance manager', async () => {
    const user = userEvent.setup()
    wrap('/settings', { role: 'financial_admin' })
    expect(await screen.findByText('Finance setup wizard')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByText('Wizard page')).toBeInTheDocument()
  })

  it('hides the wizard from a member without finance.manage', async () => {
    wrap('/settings', { role: 'contributor' })
    expect(await screen.findByText('My preferences')).toBeInTheDocument()
    expect(screen.queryByText('Finance setup wizard')).not.toBeInTheDocument()
  })
})

describe('SettingsPage — members and invites', () => {
  it('renders both the members and the invites subsection in one pane', async () => {
    wrap('/settings/members')
    expect(await screen.findByText('Members')).toBeInTheDocument()
    expect(screen.getByText('Invites')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New invite' })).toBeInTheDocument()
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

  it('shows the Resend integration with the supplied theme wordmark', async () => {
    wrap('/settings/integrations', { entitlements: lockedEntitlements })
    const logo = await screen.findByAltText('Resend')
    expect(logo).toHaveAttribute('src', '/share/resend/resend-wordmark-light-256px.png')
    expect(logo.closest('.MuiPaper-outlined')).not.toBeNull()
  })

  it('configures and removes the Resend key without displaying its saved value', async () => {
    setResendKey.mockResolvedValue({ isSet: true, changedAt: '2026-08-04T12:00:00.000Z' })
    clearResendKey.mockResolvedValue({ isSet: false, changedAt: '2026-08-04T12:01:00.000Z' })
    const user = userEvent.setup()
    wrap('/settings/integrations', { entitlements: lockedEntitlements })

    const logo = await screen.findByAltText('Resend')
    let card = logo.closest('.MuiPaper-outlined')
    await user.click(within(card).getByRole('button', { name: 'Add integration' }))
    card = (await screen.findByText('Send Emails through Resend')).closest('.MuiPaper-outlined')
    await user.click(within(card).getByRole('button', { name: 'Configure' }))
    await user.type(within(card).getByLabelText('Resend API key'), `re_${'a'.repeat(32)}`)
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    expect(setResendKey).toHaveBeenCalledWith(`re_${'a'.repeat(32)}`)
    expect(within(card).queryByDisplayValue(`re_${'a'.repeat(32)}`)).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Remove key' }))
    expect(clearResendKey).toHaveBeenCalledOnce()
  })

  it('shows no premium diamond when the tenant is unenforced (ownerless)', async () => {
    wrap('/settings/accent')
    // Wait for the nav (unique subheader) to settle, then assert no diamond link.
    await screen.findByText('Band settings')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
