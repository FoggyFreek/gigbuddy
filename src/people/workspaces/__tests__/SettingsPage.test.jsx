import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../../contexts/authContext.ts'
import SettingsPage from '../SettingsPage.tsx'
import theme from '../../../theme.ts'
import {
  clearResendKey,
  getBandsintownKey,
  setBandsintownArtistId,
  setMollieKey,
  setResendKey,
  setShopifyClientId,
  setShopifyDomain,
  setShopifySecret,
} from '../../profiles/profile.ts'
import { getOutreachSender } from '../../../promotion/outreach/outreachSender.ts'
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
vi.mock('../../../promotion/outreach/outreachSender.ts', () => ({
  getOutreachSender: vi.fn().mockResolvedValue({
    fromName: 'The Testers', fromEmail: 'hello@example.com', replyTo: 'reply@example.com', configured: true,
  }),
  saveOutreachSender: vi.fn(),
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
vi.mock('../../band-profiles/bandProfileClaims.ts', () => ({
  getOwnClaim: vi.fn().mockResolvedValue({ claim: null }),
  requestClaim: vi.fn(),
  withdrawClaim: vi.fn(),
}))
vi.mock('../tenants.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, updateActiveTenantSlug: vi.fn() }
})
const lockedEntitlements = {
  planSlug: 'free', locked: false, financeReadOnly: false,
  flags: { finance: false, integrations: false, customization: false },
  limits: { storage_mb: 100, members: 5, bands: 1 },
}

const integrationsEntitlements = {
  ...lockedEntitlements,
  planSlug: 'silver',
  flags: { ...lockedEntitlements.flags, integrations: true },
}

function planEntitlements(planSlug, finance) {
  return {
    ...lockedEntitlements,
    planSlug,
    flags: { ...lockedEntitlements.flags, finance },
  }
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
    expect(screen.getByText('Manage band account')).toBeInTheDocument()
    expect(screen.getByTestId('GroupsIcon')).toBeInTheDocument()
  })

  it('hides tenant-admin settings for a plain member', async () => {
    wrap('/settings', { role: 'contributor' })
    expect(await screen.findByText('My preferences')).toBeInTheDocument()
    expect(screen.queryByText('Accent color')).not.toBeInTheDocument()
    expect(screen.queryByText('Members and invites')).not.toBeInTheDocument()
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument()
    expect(screen.queryByText('Chart of accounts')).not.toBeInTheDocument()
    expect(screen.queryByText('Manage band account')).not.toBeInTheDocument()
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
      'Invoice mode',
      'Accounting Settings',
      'Chart of accounts',
    ])
    expect(texts.indexOf('Band settings')).toBeLessThan(texts.indexOf('Manage band account'))
    expect(texts.indexOf('Manage band account')).toBeLessThan(texts.indexOf('Finance and accounting settings'))
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
    for (const label of ['Financial profile', 'Accounting profile', 'Invoice mode', 'Accounting Settings', 'Chart of accounts']) {
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
    expect(screen.queryByText('Manage band account')).not.toBeInTheDocument()
  })

  it('offers the band profile claim to a band admin under manage band account', async () => {
    wrap('/settings/delete-account')
    expect(await screen.findByRole('heading', { name: 'Global band profile' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Public band profile' })).not.toBeInTheDocument()
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
  it.each([
    ['bronze', 'band'],
    ['silver', 'band'],
    ['artist_bronze', 'personal'],
  ])('hides every finance setting on the %s plan', async (planSlug, activeTenantKind) => {
    wrap('/settings/chart-of-accounts', {
      entitlements: planEntitlements(planSlug, false),
      activeTenantKind,
    })

    expect(await screen.findAllByText('My preferences')).not.toHaveLength(0)
    expect(screen.queryByText('Finance and accounting settings')).not.toBeInTheDocument()
    for (const label of ['Financial profile', 'Accounting profile', 'Invoice mode', 'Accounting Settings', 'Chart of accounts']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
    expect(screen.queryByText('Finance setup wizard')).not.toBeInTheDocument()
  })

  it.each([
    ['gold', 'band'],
    ['artist_gold', 'personal'],
  ])('shows every finance setting on the %s plan', async (planSlug, activeTenantKind) => {
    wrap('/settings', {
      entitlements: planEntitlements(planSlug, true),
      activeTenantKind,
    })

    expect(await screen.findByText('Finance and accounting settings')).toBeInTheDocument()
    for (const label of ['Financial profile', 'Accounting profile', 'Invoice mode', 'Accounting Settings', 'Chart of accounts']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('marks the accent section with a premium diamond when the plan lacks customization', async () => {
    wrap('/settings/accent', { entitlements: lockedEntitlements })
    const link = await screen.findByRole('link')
    expect(link).toHaveAttribute('href', '/upgrade/customization')
  })

  it('marks the integrations section with a premium diamond when the plan lacks it', async () => {
    wrap('/settings/integrations', { entitlements: lockedEntitlements })
    const links = await screen.findAllByRole('link')
    for (const link of links) expect(link).toHaveAttribute('href', '/upgrade/integrations')
  })

  it('shows the Resend integration with the supplied theme wordmark', async () => {
    wrap('/settings/integrations', { entitlements: lockedEntitlements })
    const logo = await screen.findByAltText('Resend')
    expect(logo).toHaveAttribute('src', '/share/resend/resend-wordmark-light-256px.png')
    expect(logo.closest('.MuiPaper-outlined')).not.toBeNull()
  })

  it('keeps compact sender identity controls inside the Resend configuration card', async () => {
    const user = userEvent.setup()
    wrap('/settings/integrations', { entitlements: integrationsEntitlements })

    const logo = await screen.findByAltText('Resend')
    await user.click(within(logo.closest('.MuiPaper-outlined')).getByRole('button', { name: 'Add integration' }))
    const card = (await screen.findByText('Send emails through Resend')).closest('.MuiPaper-outlined')
    await getOutreachSender.mock.results[0]?.value

    for (const label of ['From name', 'From email', 'Reply-to email (optional)']) {
      const field = within(card).getByLabelText(label)
      expect(field.closest('.MuiInputBase-root')).toHaveClass('MuiInputBase-sizeSmall')
    }
    expect(within(card).getByRole('button', { name: 'Save sender' })).toBeInTheDocument()
    expect(within(card).queryByText('Save sender')).not.toBeInTheDocument()
  })

  it('configures and removes the Resend key without displaying its saved value', async () => {
    setResendKey.mockResolvedValue({ isSet: true, changedAt: '2026-08-04T12:00:00.000Z' })
    clearResendKey.mockResolvedValue({ isSet: false, changedAt: '2026-08-04T12:01:00.000Z' })
    const user = userEvent.setup()
    wrap('/settings/integrations', { entitlements: integrationsEntitlements })

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

  it('cancels a Resend key edit and surfaces an invalid key response', async () => {
    setResendKey.mockRejectedValueOnce(new Error('invalid_resend_key'))
    const user = userEvent.setup()
    wrap('/settings/integrations', { entitlements: integrationsEntitlements })

    const card = (await screen.findByAltText('Resend')).closest('.MuiPaper-outlined')
    await user.click(within(card).getByRole('button', { name: 'Add integration' }))
    await user.click(within(card).getByRole('button', { name: 'Configure' }))
    const keyInput = within(card).getByLabelText('Resend API key')
    await user.type(keyInput, 'not-a-resend-key')
    await user.click(within(card).getByRole('button', { name: 'Show key' }))
    expect(keyInput).toHaveAttribute('type', 'text')
    await user.click(within(card).getByRole('button', { name: 'Save' }))

    expect(await within(card).findByText('Invalid key format. Resend API keys start with re_.')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Cancel' }))
    await user.click(within(card).getByRole('button', { name: 'Configure' }))
    expect(within(card).getByLabelText('Resend API key')).toHaveValue('')
  })

  it('saves a trimmed Mollie key and reports an unexpected save failure', async () => {
    setMollieKey
      .mockResolvedValueOnce({ isSet: true })
      .mockRejectedValueOnce(new Error('network_failure'))
    const user = userEvent.setup()
    wrap('/settings/integrations', { entitlements: integrationsEntitlements })

    const card = (await screen.findByAltText('Mollie')).closest('.MuiPaper-outlined')
    await user.click(within(card).getByRole('button', { name: 'Add integration' }))
    await user.click(within(card).getByRole('button', { name: 'Configure' }))
    await user.type(within(card).getByLabelText('Mollie API key'), '  test_123  ')
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    expect(setMollieKey).toHaveBeenCalledWith('test_123')

    await user.click(within(card).getByRole('button', { name: 'Replace key' }))
    await user.type(within(card).getByLabelText('Mollie API key'), 'test_456')
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    expect(await within(card).findByText('Failed to save key. Please try again.')).toBeInTheDocument()
  })

  it('edits Shopify client credentials and domain independently', async () => {
    setShopifyClientId.mockResolvedValue({ clientId: 'client-123' })
    setShopifySecret.mockResolvedValue({ isSet: true })
    setShopifyDomain.mockResolvedValue({ domain: 'testers.myshopify.com' })
    const user = userEvent.setup()
    wrap('/settings/integrations', { entitlements: integrationsEntitlements })

    const card = (await screen.findByAltText('Shopify')).closest('.MuiPaper-outlined')
    await user.click(within(card).getByRole('button', { name: 'Add integration' }))
    await user.click(within(card).getAllByRole('button', { name: 'Configure' })[0])
    const clientId = within(card).getByLabelText('Client ID')
    await user.type(clientId, 'will-be-cancelled')
    await user.click(within(card).getByRole('button', { name: 'Cancel' }))
    await user.click(within(card).getAllByRole('button', { name: 'Configure' })[0])
    await user.type(within(card).getByLabelText('Client ID'), '  client-123  ')
    await user.click(within(within(card).getByLabelText('Client ID').closest('.MuiStack-root')).getByRole('button', { name: 'Save' }))
    expect(setShopifyClientId).toHaveBeenCalledWith('client-123')

    await user.click(within(card).getByRole('button', { name: 'Configure' }))
    await user.type(within(card).getByLabelText('App secret'), ' shpss_secret ')
    await user.click(within(within(card).getByLabelText('App secret').closest('.MuiStack-root')).getByRole('button', { name: 'Save' }))
    expect(setShopifySecret).toHaveBeenCalledWith('shpss_secret')

    const domain = within(card).getByPlaceholderText('yourband.myshopify.com')
    await user.type(domain, ' testers.myshopify.com ')
    await user.click(within(domain.closest('.MuiStack-root')).getByRole('button', { name: 'Save' }))
    expect(setShopifyDomain).toHaveBeenCalledWith('testers.myshopify.com')
  })

  it('saves a trimmed Bandsintown artist ID after the card is expanded', async () => {
    setBandsintownArtistId.mockResolvedValue({ artistId: '12345678' })
    const user = userEvent.setup()
    wrap('/settings/integrations', { entitlements: integrationsEntitlements })

    const card = (await screen.findByAltText('Bandsintown')).closest('.MuiPaper-outlined')
    await user.click(within(card).getByRole('button', { name: 'Add integration' }))
    const artistId = within(card).getByPlaceholderText('12345678')
    await user.type(artistId, ' 12345678 ')
    await user.click(within(artistId.closest('.MuiStack-root')).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setBandsintownArtistId).toHaveBeenCalledWith('12345678'))
  })

  it.each([
    ['bronze', 'band', ['Resend', 'Mollie', 'Shopify', 'Bandsintown']],
    ['artist_bronze', 'personal', ['Resend', 'Mollie']],
  ])('replaces every integration action with the upgrade diamond on %s', async (planSlug, activeTenantKind, logos) => {
    wrap('/settings/integrations', {
      entitlements: { ...lockedEntitlements, planSlug },
      activeTenantKind,
    })

    await screen.findByAltText('Resend')
    for (const alt of logos) {
      const card = screen.getByAltText(alt).closest('.MuiPaper-outlined')
      expect(within(card).getByRole('link')).toHaveAttribute('href', '/upgrade/integrations')
    }
    expect(screen.queryByRole('button', { name: 'Add integration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure' })).not.toBeInTheDocument()
  })

  it('lets an entitled plan configure every integration without a diamond', async () => {
    wrap('/settings/integrations', { entitlements: integrationsEntitlements })
    expect(await screen.findAllByRole('button', { name: 'Add integration' })).toHaveLength(4)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  // Downgrading purges credentials, but a retained or not-yet-purged key must
  // still be visible and erasable — only replacing it is a paid action.
  it('keeps a stored key removable on bronze while locking the replace action', async () => {
    getBandsintownKey.mockResolvedValueOnce({ isSet: true, changedAt: '2026-08-04T12:00:00.000Z' })
    wrap('/settings/integrations', { entitlements: lockedEntitlements })

    const card = (await screen.findByAltText('Bandsintown')).closest('.MuiPaper-outlined')
    expect(await within(card).findByText('Configured')).toBeInTheDocument()
    expect(within(card).getByTestId('DeleteOutlinedIcon').closest('button')).toBeEnabled()
    expect(within(card).queryByRole('button', { name: 'Replace key' })).not.toBeInTheDocument()
    expect(within(card).getByRole('textbox')).toBeDisabled()
    expect(within(card).getAllByRole('link')[0]).toHaveAttribute('href', '/upgrade/integrations')
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
