import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.js'
import AppShell from '../components/AppShell.jsx'

vi.mock('../contexts/authContext.js', () => ({
  useAuth: vi.fn(),
}))
vi.mock('../contexts/profileContext.js', () => ({
  useProfile: () => ({ bandName: 'Band A' }),
}))
vi.mock('../contexts/themeModeContext.js', () => ({
  useThemeMode: () => ({ mode: 'light', toggleTheme: vi.fn() }),
}))
vi.mock('../hooks/usePushNotifications.js', () => ({
  usePushNotifications: () => ({
    status: 'unsupported',
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}))

import { useAuth } from '../contexts/authContext.js'

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
  activeTenantRole: 'member',
  memberships: [
    { tenantId: 1, tenantSlug: 'a', tenantName: 'Band A', role: 'member', status: 'approved' },
    { tenantId: 2, tenantSlug: 'b', tenantName: 'Band B', role: 'tenant_admin', status: 'approved' },
  ],
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

  it('shows super-admin nav links in the settings menu only to super admins', async () => {
    useAuth.mockReturnValue({
      user: { ...TWO_TENANT_USER, isSuperAdmin: true },
      logout: vi.fn(),
      switchTenant: vi.fn(),
    })
    const user = userEvent.setup()
    wrap(<AppShell />)
    await user.click(screen.getByLabelText('open settings menu'))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Tenants')).toBeInTheDocument()
    expect(within(menu).getByText('All Users')).toBeInTheDocument()
  })

  it('does not show super-admin nav links to non-super', async () => {
    useAuth.mockReturnValue({
      user: TWO_TENANT_USER,
      logout: vi.fn(),
      switchTenant: vi.fn(),
    })
    const user = userEvent.setup()
    wrap(<AppShell />)
    await user.click(screen.getByLabelText('open settings menu'))
    expect(screen.queryByText('Tenants')).not.toBeInTheDocument()
    expect(screen.queryByText('All Users')).not.toBeInTheDocument()
  })

  it('shows Members nav link in the settings menu to tenant admins', async () => {
    useAuth.mockReturnValue({
      user: { ...TWO_TENANT_USER, activeTenantRole: 'tenant_admin' },
      logout: vi.fn(),
      switchTenant: vi.fn(),
    })
    const user = userEvent.setup()
    wrap(<AppShell />)
    await user.click(screen.getByLabelText('open settings menu'))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Members')).toBeInTheDocument()
    expect(within(menu).getByText('Band Settings')).toBeInTheDocument()
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
