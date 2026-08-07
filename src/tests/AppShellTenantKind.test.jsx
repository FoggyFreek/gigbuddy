import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import AppShell from '../components/AppShell.tsx'

vi.mock('../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))
vi.mock('../contexts/profileContext.ts', () => ({
  useProfile: () => ({ bandName: 'Alpha User' }),
}))
vi.mock('../contexts/themeModeContext.ts', () => ({
  useThemeMode: () => ({ mode: 'light', toggleTheme: vi.fn() }),
}))
vi.mock('../hooks/usePushNotifications.ts', () => ({
  usePushNotifications: () => ({
    status: 'unsupported',
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}))

import { useAuth } from '../contexts/authContext.ts'

// tenant_admin on a full plan so nothing is filtered by role or tier — these
// tests isolate the tenant-kind filter.
const ENTITLEMENTS_FULL = {
  planSlug: 'gold',
  subscriptionStatus: 'active',
  locked: false,
  financeReadOnly: false,
  flags: {
    finance: true, integrations: true, customization: true, song_files: true,
    chordpro: true, public_promotion: true, linkpage: true, calendar_sync: true,
  },
  limits: { storage_mb: null, members: null, bands: null },
}

const baseUser = {
  id: 1,
  name: 'Alpha User',
  isSuperAdmin: false,
  activeTenantId: 1,
  // The personal-workspace tutorial is a blocking modal on first arrival; these
  // tests are about the nav behind it.
  dismissedTutorials: ['personal_workspace_welcome'],
  activeTenantRole: 'tenant_admin',
  entitlements: ENTITLEMENTS_FULL,
  memberships: [
    { tenantId: 1, tenantSlug: 'a', tenantName: 'Alpha User', role: 'tenant_admin', status: 'approved' },
  ],
}

function mockUser(activeTenantKind) {
  useAuth.mockReturnValue({
    user: { ...baseUser, activeTenantKind },
    logout: vi.fn(),
    switchTenant: vi.fn(),
  })
}

function renderShell() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

// Only the expanded group's items are mounted (accordion + unmountOnExit), so
// each assertion opens the group it is about.
async function itemsInGroup(user, groupLabel) {
  await user.click(screen.getByRole('button', { name: groupLabel }))
  return screen.getAllByRole('link').map((l) => l.textContent)
}

describe('AppShell — nav filtered by tenant kind', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides band-only repertoire items in a personal workspace', async () => {
    mockUser('personal')
    const user = userEvent.setup()
    renderShell()

    // Planning is shared whole: the calendar is the artist agenda here and the
    // roster grid in a band, so nothing drops out of the group.
    expect(await itemsInGroup(user, 'Planning group')).toEqual([
      'Calendar', 'Gigs', 'Rehearsals', 'Band Events', 'Tasks',
    ])
    expect(await itemsInGroup(user, 'Repertoire group')).toEqual(['Songs'])
  })

  it('keeps them in a band', async () => {
    mockUser('band')
    const user = userEvent.setup()
    renderShell()

    expect(await itemsInGroup(user, 'Planning group')).toEqual([
      'Calendar', 'Gigs', 'Rehearsals', 'Band Events', 'Tasks',
    ])
    expect(await itemsInGroup(user, 'Repertoire group')).toEqual(['Songs', 'Setlists'])
  })

  it('hides merchandise but keeps the rest of finance in a personal workspace', async () => {
    mockUser('personal')
    const user = userEvent.setup()
    renderShell()

    expect(await itemsInGroup(user, 'Financial group')).toEqual([
      'Invoices', 'Purchases', 'Reimbursements',
    ])
  })

  // An absent kind (payload from before the rename, or /auth/me not yet
  // resolved) must behave exactly like a band — never hide a band's nav.
  it('treats a missing kind as a band', async () => {
    mockUser(undefined)
    const user = userEvent.setup()
    renderShell()

    expect(await itemsInGroup(user, 'Repertoire group')).toEqual(['Songs', 'Setlists'])
  })

  it('offers no band switcher entries a personal workspace cannot use', async () => {
    mockUser('personal')
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByLabelText('open settings menu'))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /^settings$/i })).toBeInTheDocument()
  })
})
