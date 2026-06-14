import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import AppShell from '../components/AppShell.tsx'

vi.mock('../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))
vi.mock('../contexts/profileContext.ts', () => ({
  useProfile: () => ({ bandName: 'Band A' }),
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

const USER = {
  id: 1,
  name: 'Alice',
  email: 'alice@example.com',
  pictureUrl: null,
  isSuperAdmin: false,
  activeTenantId: 1,
  activeTenantRole: 'member',
  memberships: [
    { tenantId: 1, tenantSlug: 'a', tenantName: 'Band A', role: 'member', status: 'approved' },
  ],
}

// Renders the live URL into the AppShell <Outlet/> so tests can assert the
// *actual* route rather than relying on visible/selected nav state.
function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="location-pathname">{pathname}</div>
}

function renderShell(initialPath = '/') {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<LocationProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

const pathnameText = () => screen.getByTestId('location-pathname').textContent

describe('AppShell nav groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({ user: USER, logout: vi.fn(), switchTenant: vi.fn() })
  })

  it('renders all six group headers', () => {
    renderShell('/')
    for (const label of ['Overview', 'Planning', 'Network', 'Financial', 'Accounting', 'Repertoire']) {
      expect(screen.getByRole('button', { name: `${label} group` })).toBeInTheDocument()
    }
  })

  it('auto-expands the group containing the active route and collapses the rest', () => {
    renderShell('/gigs')
    // Planning is open → its child Rehearsals is visible
    expect(screen.getByText('Rehearsals')).toBeInTheDocument()
    // Network is closed → its child Contacts is not mounted
    expect(screen.queryByText('Contacts')).not.toBeInTheDocument()
  })

  it('keeps only one group open at a time (accordion)', async () => {
    const user = userEvent.setup()
    renderShell('/gigs')
    expect(screen.getByText('Rehearsals')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Network group' }))
    expect(screen.getByText('Contacts')).toBeInTheDocument()
    expect(screen.queryByText('Rehearsals')).not.toBeInTheDocument()

    // clicking the open group again collapses it
    await user.click(screen.getByRole('button', { name: 'Network group' }))
    expect(screen.queryByText('Contacts')).not.toBeInTheDocument()
  })

  it('marks the owning group header as selected when a child route is active', () => {
    renderShell('/gigs')
    expect(screen.getByRole('button', { name: 'Planning group' })).toHaveClass('Mui-selected')
    expect(screen.getByRole('button', { name: 'Network group' })).not.toHaveClass('Mui-selected')
  })

  it('group headers toggle open/close but never navigate; children do navigate', async () => {
    const user = userEvent.setup()
    renderShell('/gigs')
    expect(pathnameText()).toBe('/gigs')

    // toggling a group header must not change the URL
    await user.click(screen.getByRole('button', { name: 'Network group' }))
    expect(pathnameText()).toBe('/gigs')

    // a child link does navigate
    await user.click(screen.getByText('Contacts'))
    expect(pathnameText()).toBe('/contacts')
  })

  describe('collapsed (icon-only) mode', () => {
    async function collapse(user) {
      await user.click(screen.getByLabelText('collapse navigation'))
    }

    it('hides text labels but keeps child links reachable as icons', async () => {
      const user = userEvent.setup()
      renderShell('/gigs')
      await collapse(user)

      // visible text labels are gone
      expect(screen.queryByText('Gigs')).not.toBeInTheDocument()
      expect(screen.queryByText('Planning')).not.toBeInTheDocument()
      // but the child links survive as icon buttons (named via aria-label)
      expect(screen.getByRole('link', { name: 'Gigs' })).toBeInTheDocument()
    })

    it('marks the active child link with aria-current when collapsed', async () => {
      const user = userEvent.setup()
      renderShell('/gigs')
      await collapse(user)
      expect(screen.getByRole('link', { name: 'Gigs' })).toHaveAttribute('aria-current', 'page')
    })

    it('opens a hover flyout with the group title and clickable child links for a collapsed group', async () => {
      const user = userEvent.setup()
      // At /gigs the Planning group is expanded; hover a *different*, still
      // collapsed group (Network) to get its flyout.
      renderShell('/gigs')
      await collapse(user)

      await user.hover(screen.getByRole('button', { name: 'Network group' }))
      const flyout = await screen.findByRole('tooltip')
      expect(within(flyout).getByText('Network')).toBeInTheDocument()

      await user.click(within(flyout).getByRole('link', { name: 'Contacts' }))
      expect(pathnameText()).toBe('/contacts')
    })

    it('does not show a hover flyout for the already-expanded group', async () => {
      const user = userEvent.setup()
      renderShell('/gigs')
      await collapse(user)

      await user.hover(screen.getByRole('button', { name: 'Planning group' }))
      // Give any enter-delay tooltip a chance to appear. The flyout renders the
      // group label as visible text; the collapsed header itself does not, so no
      // visible "Planning" means no flyout opened.
      await new Promise((r) => setTimeout(r, 150))
      expect(screen.queryByText('Planning')).not.toBeInTheDocument()
    })
  })
})
