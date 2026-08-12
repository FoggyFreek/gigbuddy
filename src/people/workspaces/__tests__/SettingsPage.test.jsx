import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../../contexts/authContext.ts'
import SettingsPage from '../SettingsPage.tsx'
import theme from '../../../theme.ts'
import { clearResendKey, setResendKey } from '../../profiles/profile.ts'
import { updateActiveTenantSlug } from '../tenants.ts'

vi.mock('../../../commerce/billing/billing.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getBillingState: vi.fn().mockResolvedValue({ plans: [], subscription: null, ownedTenantCount: 1 }) }
})
vi.mock('../../../user/notifications/notifications.ts', () => ({
  getNotificationPrefs: vi.fn().mockResolvedValue(null),
  updateNotificationPrefs: vi.fn(),
}))
vi.mock('../../../user/notifications/usePushNotifications.ts', () => ({
  usePushNotifications: () => ({ status: 'unsubscribed', subscribe: vi.fn(), unsubscribe: vi.fn() }),
}))
vi.mock('../../../user/availability/userAvailability.ts', () => ({
  getAvailabilitySettings: vi.fn().mockResolvedValue({
    availabilityDetailVisible: false, crossBandGigDetailVisible: false, delegations: [],
  }),
  updateAvailabilitySettings: vi.fn(),
}))
vi.mock('../../profiles/profile.ts', () => ({
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
vi.mock('../../memberships/users.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listMemberships: vi.fn().mockResolvedValue([]) }
})
vi.mock('../../memberships/bandMembers.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listMembers: vi.fn().mockResolvedValue([]) }
})
vi.mock('../../memberships/invites.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listInvites: vi.fn().mockResolvedValue([]) }
})
vi.mock('../tenants.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, updateActiveTenantSlug: vi.fn() }
})
const lockedEntitlements = {
  planSlug: 'free', locked: false, financeReadOnly: false,
  flags: { finance: false, integrations: false, customization: false },
  limits: { storage_mb: 100, members: 5, bands: 1 },
}

function wrap(route, {
  role = 'tenant_admin', entitlements = null, activeTenantKind = 'band', refreshUser = vi.fn(),
} = {}) {
  const user = {
    id: 1,
    isSuperAdmin: false,
    activeTenantId: 11,
    activeTenantRole: role,
    activeTenantKind,
    entitlements,
    memberships: [{
      tenantId: 11,
      tenantSlug: activeTenantKind === 'personal' ? 'solo-artist' : 'test-band',
      displayName: activeTenantKind === 'personal' ? 'Solo Artist' : 'Test Band',
      role,
      status: 'approved',
      kind: activeTenantKind,
    }],
  }
  return render(
    <AuthContext.Provider value={{ user, logout: vi.fn(), refreshUser }}>
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
    expect(screen.getByText('Manage account')).toBeInTheDocument()
    expect(screen.getByTestId('ManageAccountsIcon')).toBeInTheDocument()
  })

  it('hides tenant-admin settings for a plain member', async () => {
    wrap('/settings', { role: 'contributor' })
    expect(await screen.findByText('My preferences')).toBeInTheDocument()
    expect(screen.queryByText('Accent color')).not.toBeInTheDocument()
    expect(screen.queryByText('Members and invites')).not.toBeInTheDocument()
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument()
    expect(screen.queryByText('Chart of accounts')).not.toBeInTheDocument()
    expect(screen.queryByText('Manage account')).not.toBeInTheDocument()
  })

  it('keeps Manage account inside band settings, before the finance group', async () => {
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
    expect(texts.indexOf('Band settings')).toBeLessThan(texts.indexOf('Manage account'))
    expect(texts.indexOf('Manage account')).toBeLessThan(texts.indexOf('Finance and accounting settings'))
    expect(screen.queryByText('Delete account (permanent)')).not.toBeInTheDocument()
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

  // My Bands has its own personal-workspace page; these sections are band-only
  // and administrative.
  it('hides the band-only sections in a personal workspace', async () => {
    wrap('/settings', { activeTenantKind: 'personal' })
    expect(await screen.findAllByText('My preferences')).not.toHaveLength(0)
    expect(screen.queryByText('Members and invites')).not.toBeInTheDocument()
    expect(screen.queryByText('Band profile')).not.toBeInTheDocument()
    expect(screen.queryByText('Manage account')).not.toBeInTheDocument()
  })

  it('offers the band profile claim to a band admin', async () => {
    wrap('/settings')
    expect(await screen.findAllByText('Public band profile')).not.toHaveLength(0)
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
    card = (await screen.findByText('Send emails through Resend')).closest('.MuiPaper-outlined')
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

  it('shows a locked slug editor above account deletion without the Gold feature', async () => {
    wrap('/settings/delete-account', { entitlements: lockedEntitlements })

    const title = await screen.findByText('Change band slug')
    const deleteTitle = screen.getByRole('heading', { name: 'Delete account permanently' })
    expect(title.compareDocumentPosition(deleteTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: /premium feature/i })).toHaveAttribute('href', '/upgrade/custom_slug')
    expect(screen.getByLabelText('Slug name')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save slug name' })).toBeDisabled()
  })

  it('changes the slug and refreshes the auth payload for an entitled admin', async () => {
    updateActiveTenantSlug.mockResolvedValue({ slug: 'new-stage-name' })
    const refreshUser = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const entitlements = {
      ...lockedEntitlements,
      planSlug: 'gold',
      flags: { ...lockedEntitlements.flags, custom_slug: true },
    }
    wrap('/settings/delete-account', { entitlements, refreshUser })

    const input = await screen.findByLabelText('Slug name')
    expect(input).toHaveValue('test-band')
    await user.clear(input)
    await user.type(input, 'new-stage-name')
    await user.click(screen.getByRole('button', { name: 'Save slug name' }))

    expect(updateActiveTenantSlug).toHaveBeenCalledWith('new-stage-name')
    expect(refreshUser).toHaveBeenCalledOnce()
    expect(await screen.findByText('Band slug updated.')).toBeInTheDocument()
  })

  it('reports LinkBuddy synchronization as a non-blocking pending update', async () => {
    updateActiveTenantSlug.mockResolvedValue({ slug: 'new-stage-name', linkpageSync: 'pending' })
    const user = userEvent.setup()
    const entitlements = {
      ...lockedEntitlements,
      planSlug: 'gold',
      flags: { ...lockedEntitlements.flags, custom_slug: true },
    }
    wrap('/settings/delete-account', { entitlements, refreshUser: vi.fn().mockResolvedValue(undefined) })

    const input = await screen.findByLabelText('Slug name')
    await user.clear(input)
    await user.type(input, 'new-stage-name')
    await user.click(screen.getByRole('button', { name: 'Save slug name' }))

    expect(await screen.findByText(
      'Your GigBuddy address changed. Your LinkBuddy pages are still updating.',
    )).toBeInTheDocument()
  })

  it('shows the localized uniqueness error returned by the server', async () => {
    updateActiveTenantSlug.mockRejectedValue(Object.assign(new Error('Slug already in use'), {
      status: 409,
      code: 'slug_in_use',
    }))
    const user = userEvent.setup()
    const entitlements = {
      ...lockedEntitlements,
      planSlug: 'gold',
      flags: { ...lockedEntitlements.flags, custom_slug: true },
    }
    wrap('/settings/delete-account', { entitlements })

    const input = await screen.findByLabelText('Slug name')
    await user.clear(input)
    await user.type(input, 'existing-band')
    await user.click(screen.getByRole('button', { name: 'Save slug name' }))

    expect(await screen.findByText('That slug name is already in use.')).toBeInTheDocument()
  })
})
