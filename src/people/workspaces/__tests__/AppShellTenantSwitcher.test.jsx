import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../../../theme.ts'
import AppShell from '../../../components/AppShell.tsx'

vi.mock('../../../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))
vi.mock('../../../contexts/profileContext.ts', () => ({
  useProfile: () => ({ bandName: 'Band A' }),
}))
vi.mock('../../../contexts/themeModeContext.ts', () => ({
  useThemeMode: () => ({ mode: 'light', toggleTheme: vi.fn() }),
}))
vi.mock('../../../user/notifications/usePushNotifications.ts', () => ({
  usePushNotifications: () => ({
    status: 'unsupported',
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}))
vi.mock('../tenants.ts', () => ({
  createOwnedTenant: vi.fn(),
  createPersonalTenant: vi.fn(),
}))
vi.mock('../../band-profiles/bandProfiles.ts', () => ({
  searchBandProfiles: vi.fn().mockResolvedValue({ items: [], meta: { limit: 20 } }),
}))
vi.mock('../../memberships/bandDirectory.ts', () => ({
  searchBands: vi.fn().mockResolvedValue({ items: [], meta: { limit: 20 } }),
  requestToJoinBand: vi.fn(),
}))
vi.mock('../../my-bands/myBands.ts', () => ({
  addMyBand: vi.fn(),
}))
vi.mock('../../memberships/invites.ts', () => ({
  redeemInvite: vi.fn(),
}))

import { useAuth } from '../../../contexts/authContext.ts'
import { createOwnedTenant } from '../tenants.ts'

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>{ui}</MemoryRouter>
    </ThemeProvider>,
  )
}

const TWO_TENANT_USER = {
  id: 1,
  name: 'Alice',
  email: 'alice@example.com',
  pictureUrl: null,
  isSuperAdmin: false,
  activeTenantId: 1,
  activeTenantRole: 'contributor',
  bandCapacity: { used: 1, limit: null },
  memberships: [
    { tenantId: 1, tenantSlug: 'a', tenantName: 'Band A', role: 'contributor', status: 'approved' },
    { tenantId: 2, tenantSlug: 'b', tenantName: 'Band B', role: 'tenant_admin', status: 'approved' },
  ],
}

// Entitlement payloads as /auth/me sends them (complete flags + limits).
const ENTITLEMENTS_NO_FINANCE = {
  planSlug: 'free',
  subscriptionStatus: 'active',
  locked: false,
  financeReadOnly: false,
  flags: { finance: false, integrations: false, customization: false, song_files: false, chordpro: false, public_promotion: false },
  limits: { storage_mb: 512, members: 5, bands: 1 },
}

const ENTITLEMENTS_FULL = {
  planSlug: 'pro',
  subscriptionStatus: 'active',
  locked: false,
  financeReadOnly: false,
  flags: { finance: true, integrations: true, customization: true, song_files: true, chordpro: true, public_promotion: true },
  limits: { storage_mb: null, members: null, bands: null },
}

// In Band A the user is a contributor on a finance-less plan; in Band B a
// tenant admin on a full plan. No `permissions` list on purpose — the matrix
// fallback in usePermissions is what a tenant switch exercises.
const BAND_A_USER = {
  ...TWO_TENANT_USER,
  activeTenantId: 1,
  activeTenantRole: 'contributor',
  entitlements: ENTITLEMENTS_NO_FINANCE,
}

const BAND_B_USER = {
  ...TWO_TENANT_USER,
  activeTenantId: 2,
  activeTenantRole: 'tenant_admin',
  entitlements: ENTITLEMENTS_FULL,
}

// Stateful stand-in for the real auth context: switchTenant swaps the user,
// re-rendering AppShell with the new tenant's role and entitlements — the same
// contract the real context fulfils after /auth/switch-tenant resolves.
function SwitchableShell({ users = { 1: BAND_A_USER, 2: BAND_B_USER } }) {
  const [activeId, setActiveId] = useState(1)
  useAuth.mockImplementation(() => ({
    user: users[activeId],
    logout: vi.fn(),
    switchTenant: (tenantId) => {
      setActiveId(tenantId)
      return Promise.resolve({})
    },
  }))
  return <AppShell />
}

describe('AppShell tenant switcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists approved memberships and calls switchTenant on click', async () => {
    const switchTenant = vi.fn().mockResolvedValue({})
    useAuth.mockReturnValue({
      user: TWO_TENANT_USER,
      logout: vi.fn(),
      switchTenant,
    })
    const user = userEvent.setup()
    wrap(<AppShell />)

    await user.click(screen.getByLabelText('open user menu'))
    await waitFor(() => expect(screen.getByText('Switch band')).toBeInTheDocument())
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Band A')).toBeInTheDocument()
    expect(within(menu).getByText('Band B')).toBeInTheDocument()

    await user.click(within(menu).getByText('Band B'))
    expect(switchTenant).toHaveBeenCalledWith(2)
  })

  it('hides switch-band header for users with one membership', async () => {
    useAuth.mockReturnValue({
      user: { ...TWO_TENANT_USER, memberships: [TWO_TENANT_USER.memberships[0]] },
      logout: vi.fn(),
      switchTenant: vi.fn(),
    })
    const user = userEvent.setup()
    wrap(<AppShell />)
    await user.click(screen.getByLabelText('open user menu'))
    expect(screen.queryByText('Switch band')).not.toBeInTheDocument()
  })

  it('searches for an existing band before creating and switching to a new one', async () => {
    createOwnedTenant.mockResolvedValue({ id: 3, band_name: 'Band C' })
    const switchTenant = vi.fn().mockResolvedValue({})
    useAuth.mockReturnValue({
      user: {
        ...TWO_TENANT_USER,
        memberships: [TWO_TENANT_USER.memberships[0]],
        bandCapacity: { used: 1, limit: 3 },
      },
      logout: vi.fn(),
      switchTenant,
    })
    const user = userEvent.setup()
    wrap(<AppShell />)

    await user.click(screen.getByLabelText('open user menu'))
    await user.click(screen.getByRole('menuitem', { name: 'Add band' }))

    const searchDialog = screen.getByRole('dialog', { name: 'Add a band' })
    const createBand = within(searchDialog).getByRole('button', { name: 'Create band' })
    expect(createBand).toBeDisabled()
    await user.type(within(searchDialog).getByRole('textbox', { name: 'Band name' }), 'Band C')
    await waitFor(() => expect(createBand).toBeEnabled())
    await user.click(createBand)

    expect(screen.getByRole('dialog', { name: 'Set up your band' })).toBeInTheDocument()
    expect(screen.getByLabelText('Band name')).toHaveValue('Band C')
    await user.click(screen.getByLabelText('Accounting country'))
    await user.click(screen.getByRole('option', { name: /Netherlands \(NL\)/ }))
    await user.click(screen.getByRole('button', { name: 'Create my band' }))

    await waitFor(() => expect(createOwnedTenant).toHaveBeenCalledWith({
      band_name: 'Band C', country_code: 'nl',
    }))
    await waitFor(() => expect(switchTenant).toHaveBeenCalledWith(3))
  })

  it('greys out add band and shows a diamond when the subscription cap blocks it', async () => {
    useAuth.mockReturnValue({
      user: {
        ...TWO_TENANT_USER,
        memberships: [TWO_TENANT_USER.memberships[0]],
        bandCapacity: { used: 1, limit: 1 },
      },
      logout: vi.fn(),
      switchTenant: vi.fn(),
    })
    const user = userEvent.setup()
    wrap(<AppShell />)

    await user.click(screen.getByLabelText('open user menu'))
    const addBand = screen.getByRole('menuitem', { name: 'Add band' })
    expect(addBand).toHaveAttribute('aria-disabled', 'true')
    expect(within(addBand).getByTestId('DiamondOutlinedIcon')).toBeInTheDocument()
  })

  it('shows a plus and keeps add band enabled while the subscription has capacity', async () => {
    useAuth.mockReturnValue({
      user: {
        ...TWO_TENANT_USER,
        memberships: [],
        bandCapacity: { used: 0, limit: 1 },
      },
      logout: vi.fn(),
      switchTenant: vi.fn(),
    })
    const user = userEvent.setup()
    wrap(<AppShell />)

    await user.click(screen.getByLabelText('open user menu'))
    const addBand = screen.getByRole('menuitem', { name: 'Add band' })
    expect(addBand).not.toHaveAttribute('aria-disabled', 'true')
    expect(within(addBand).getByTestId('AddIcon')).toBeInTheDocument()
    expect(within(addBand).queryByTestId('DiamondOutlinedIcon')).not.toBeInTheDocument()
  })

  it('shows super-admin nav links in the dedicated admin menu', async () => {
    useAuth.mockReturnValue({
      user: { ...TWO_TENANT_USER, isSuperAdmin: true },
      logout: vi.fn(),
      switchTenant: vi.fn(),
    })
    const user = userEvent.setup()
    wrap(<AppShell />)
    await user.click(screen.getByLabelText('open super-admin menu'))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Organisations')).toBeInTheDocument()
    expect(within(menu).getByText('All users')).toBeInTheDocument()
  })

  it('does not show super-admin nav links to non-super', () => {
    useAuth.mockReturnValue({
      user: TWO_TENANT_USER,
      logout: vi.fn(),
      switchTenant: vi.fn(),
    })
    wrap(<AppShell />)
    expect(screen.queryByLabelText('open super-admin menu')).not.toBeInTheDocument()
  })

  it('shows the unified Settings link in the settings menu', async () => {
    useAuth.mockReturnValue({
      user: { ...TWO_TENANT_USER, activeTenantRole: 'tenant_admin' },
      logout: vi.fn(),
      switchTenant: vi.fn(),
    })
    const user = userEvent.setup()
    wrap(<AppShell />)
    await user.click(screen.getByLabelText('open settings menu'))
    const menu = screen.getByRole('menu')
    const settings = within(menu).getByRole('menuitem', { name: /^settings$/i })
    expect(settings).toHaveAttribute('href', '/settings')
  })

  it('repopulates nav groups and items from the new tenant role and plan after switching', async () => {
    const user = userEvent.setup()
    wrap(<SwitchableShell />)

    // Band A (contributor, no finance feature): the Accounting group is
    // permission-filtered away entirely, leaving 5 of the 6 group headers…
    expect(screen.queryByRole('button', { name: 'Accounting group' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: / group$/ })).toHaveLength(5)

    // …and inside Financial only Purchases survives (purchase.create), but the
    // plan lacks finance so it renders locked: diamond icon + upsell link.
    // Only the expanded group's items are mounted (accordion + unmountOnExit),
    // so the document's links ARE the Financial items — count them exactly.
    await user.click(screen.getByRole('button', { name: 'Financial group' }))
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Purchases'])
    const lockedPurchases = screen.getByRole('link', { name: 'Purchases' })
    expect(lockedPurchases).toHaveAttribute('href', '/upgrade/finance')
    expect(within(lockedPurchases).getByTestId('DiamondOutlinedIcon')).toBeInTheDocument()

    // Switch to Band B via the user menu.
    await user.click(screen.getByLabelText('open user menu'))
    await user.click(within(screen.getByRole('menu')).getByText('Band B'))

    // Band B (tenant admin, full plan): Accounting appears (all 6 headers), and
    // the Financial group — still expanded from before the switch — now shows
    // exactly its four items, with Purchases unlocked at the real route.
    expect(await screen.findByRole('button', { name: 'Accounting group' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: / group$/ })).toHaveLength(6)
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Invoices',
      'Purchases',
      'Merchandise',
      'Reimbursements',
    ])
    const purchases = screen.getByRole('link', { name: 'Purchases' })
    expect(purchases).toHaveAttribute('href', '/purchases')
    expect(within(purchases).queryByTestId('DiamondOutlinedIcon')).not.toBeInTheDocument()
  })

  it('replaces diamond items with real ones (no duplicates) when switching to a grandfathered tenant', async () => {
    // Same tenant_admin role in both bands; both plans lack finance. Band A is
    // fully gated (diamonds), Band B has pre-existing finance data so the
    // grandfathering flag unlocks the same items. The switch must swap the
    // items in place — not append unlocked copies next to the locked ones.
    const GATED_ADMIN = {
      ...TWO_TENANT_USER,
      activeTenantId: 1,
      activeTenantRole: 'tenant_admin',
      entitlements: ENTITLEMENTS_NO_FINANCE,
    }
    const GRANDFATHERED_ADMIN = {
      ...TWO_TENANT_USER,
      activeTenantId: 2,
      activeTenantRole: 'tenant_admin',
      entitlements: { ...ENTITLEMENTS_NO_FINANCE, financeReadOnly: true },
    }
    const user = userEvent.setup()
    wrap(<SwitchableShell users={{ 1: GATED_ADMIN, 2: GRANDFATHERED_ADMIN }} />)

    // Band A: all four Financial items visible but locked — every link is the
    // upsell route with a diamond.
    await user.click(screen.getByRole('button', { name: 'Financial group' }))
    const lockedLinks = screen.getAllByRole('link')
    expect(lockedLinks.map((l) => l.textContent)).toEqual([
      'Invoices',
      'Purchases',
      'Merchandise',
      'Reimbursements',
    ])
    for (const link of lockedLinks) {
      expect(link).toHaveAttribute('href', '/upgrade/finance')
      expect(within(link).getByTestId('DiamondOutlinedIcon')).toBeInTheDocument()
    }

    // Switch to the grandfathered band.
    await user.click(screen.getByLabelText('open user menu'))
    await user.click(within(screen.getByRole('menu')).getByText('Band B'))

    // Band B: the SAME four items, unlocked — real routes, no diamonds, and
    // crucially no leftover locked duplicates.
    const links = await screen.findAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      'Invoices',
      'Purchases',
      'Merchandise',
      'Reimbursements',
    ])
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/invoices',
      '/purchases',
      '/merch',
      '/reimbursements',
    ])
    expect(screen.queryByTestId('DiamondOutlinedIcon')).not.toBeInTheDocument()
  })

  it('hides Members nav link from regular members', async () => {
    useAuth.mockReturnValue({
      user: TWO_TENANT_USER,
      logout: vi.fn(),
      switchTenant: vi.fn(),
    })
    const user = userEvent.setup()
    wrap(<AppShell />)
    await user.click(screen.getByLabelText('open settings menu'))
    expect(screen.queryByText('Members')).not.toBeInTheDocument()
  })
})
