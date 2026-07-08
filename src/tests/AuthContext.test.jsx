import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import { AuthProvider } from '../contexts/AuthContext.tsx'
import { useAuth } from '../contexts/authContext.ts'
import RequireAuth from '../components/RequireAuth.tsx'

vi.mock('../api/auth.ts', () => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  setActiveTenant: vi.fn(),
}))

import { getCurrentUser, logout, setActiveTenant } from '../api/auth.ts'

function TestConsumer() {
  const { user, logout: doLogout, switchTenant } = useAuth()
  if (user === undefined) return <div>loading</div>
  if (user === null) return <div>unauthenticated</div>
  return (
    <div>
      <div>hello {user.name}</div>
      <div>status: {user.status}</div>
      <div>tenant: {user.activeTenantId ?? 'none'}</div>
      <div>memberships: {(user.memberships || []).map((m) => m.tenantSlug).join(',')}</div>
      <button onClick={doLogout}>logout</button>
      <button onClick={() => switchTenant(2)}>switch</button>
    </div>
  )
}

function wrap(ui, initialEntries = ['/']) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={initialEntries}>
        {ui}
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem('gigbuddy:redirectAfterLogin')
    logout.mockResolvedValue(null)
  })

  it('shows loading initially', () => {
    getCurrentUser.mockReturnValue(new Promise(() => {}))
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('sets user to null on 401', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 })
    getCurrentUser.mockRejectedValue(err)
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
  })

  it('populates user on successful fetch', async () => {
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      pictureUrl: null,
      bandMemberId: null,
    })
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('hello Alice')).toBeInTheDocument())
    expect(screen.getByText('status: approved')).toBeInTheDocument()
  })

  it('sets user to null after logout', async () => {
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      pictureUrl: null,
      bandMemberId: null,
    })
    const user = userEvent.setup()
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('hello Alice')).toBeInTheDocument())
    await user.click(screen.getByText('logout'))
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
    expect(logout).toHaveBeenCalled()
  })

  it('clears a stashed post-login redirect on logout', async () => {
    localStorage.setItem('gigbuddy:redirectAfterLogin', '/redeem-invite?code=XYZ')
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      pictureUrl: null,
      bandMemberId: null,
    })
    const user = userEvent.setup()
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('hello Alice')).toBeInTheDocument())
    await user.click(screen.getByText('logout'))
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
    expect(localStorage.getItem('gigbuddy:redirectAfterLogin')).toBeNull()
  })

  it('stashes the current location for post-login replay on auth:unauthorized', async () => {
    getCurrentUser.mockReturnValue(new Promise(() => {}))
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
      ['/redeem-invite?code=XYZ'],
    )
    act(() => { window.dispatchEvent(new Event('auth:unauthorized')) })
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
    expect(localStorage.getItem('gigbuddy:redirectAfterLogin')).toBe('/redeem-invite?code=XYZ')
  })

  it('never stashes /login or / on auth:unauthorized', async () => {
    getCurrentUser.mockReturnValue(new Promise(() => {}))
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
      ['/'],
    )
    act(() => { window.dispatchEvent(new Event('auth:unauthorized')) })
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
    expect(localStorage.getItem('gigbuddy:redirectAfterLogin')).toBeNull()
  })

  it('clears the stash on logout even when the logout API call fails', async () => {
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      pictureUrl: null,
      bandMemberId: null,
      memberships: [],
    })
    // Session already dead server-side: the logout POST 401s, which also
    // fires auth:unauthorized. Neither may leave (or re-create) the stash —
    // the next user to log in on this browser must not inherit the redirect.
    logout.mockImplementation(() => {
      window.dispatchEvent(new Event('auth:unauthorized'))
      return Promise.reject(Object.assign(new Error('Unauthorized'), { status: 401 }))
    })
    const user = userEvent.setup()
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
      ['/redeem-invite'],
    )
    await waitFor(() => expect(screen.getByText('hello Alice')).toBeInTheDocument())
    localStorage.setItem('gigbuddy:redirectAfterLogin', '/redeem-invite?code=XYZ')
    await user.click(screen.getByText('logout'))
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
    expect(localStorage.getItem('gigbuddy:redirectAfterLogin')).toBeNull()
  })

  it('leaves no stash behind after logging out from the redeem page', async () => {
    // Full routing integration: react-router wraps navigate() in a transition,
    // so logout commits user=null while the location is still /redeem-invite.
    // RequireAuth renders once in that intermediate state — it must not stash
    // the redeem page back after logout just cleared it, or the next account
    // to log in on this browser inherits the redirect.
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      isSuperAdmin: false,
      pictureUrl: null,
      bandMemberId: null,
      memberships: [],
    })
    const user = userEvent.setup()
    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/redeem-invite']}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<div>login page</div>} />
              <Route element={<RequireAuth />}>
                <Route path="/redeem-invite" element={<TestConsumer />} />
              </Route>
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </ThemeProvider>,
    )
    await waitFor(() => expect(screen.getByText('hello Alice')).toBeInTheDocument())
    await user.click(screen.getByText('logout'))
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument())
    expect(localStorage.getItem('gigbuddy:redirectAfterLogin')).toBeNull()
  })

  it('replays a stashed invite deep link with its code intact for a memberless user', async () => {
    // Post-OIDC boot: fresh load at '/', the invite URL stashed by the
    // pre-login 401. RequireAuth's zero-membership redirect (a bare
    // /redeem-invite, no query) must not outrace and clobber the replay.
    localStorage.setItem('gigbuddy:redirectAfterLogin', '/redeem-invite?code=XYZ')
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      isSuperAdmin: false,
      pictureUrl: null,
      bandMemberId: null,
      memberships: [],
    })
    function LocationProbe() {
      const location = useLocation()
      return <div>at: {location.pathname + location.search}</div>
    }
    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<div>login page</div>} />
              <Route element={<RequireAuth />}>
                <Route path="/" element={<div>home</div>} />
                <Route path="/redeem-invite" element={<LocationProbe />} />
              </Route>
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </ThemeProvider>,
    )
    await waitFor(() =>
      expect(screen.getByText('at: /redeem-invite?code=XYZ')).toBeInTheDocument(),
    )
  })

  it('exposes memberships and active tenant', async () => {
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      isSuperAdmin: false,
      activeTenantId: 1,
      activeTenantRole: 'member',
      memberships: [
        { tenantId: 1, tenantSlug: 'a', tenantName: 'A', role: 'member', status: 'approved' },
        { tenantId: 2, tenantSlug: 'b', tenantName: 'B', role: 'member', status: 'approved' },
      ],
    })
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('hello Alice')).toBeInTheDocument())
    expect(screen.getByText('tenant: 1')).toBeInTheDocument()
    expect(screen.getByText('memberships: a,b')).toBeInTheDocument()
  })

  it('switchTenant calls setActiveTenant and updates user', async () => {
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      activeTenantId: 1,
      memberships: [
        { tenantId: 1, tenantSlug: 'a', tenantName: 'A', role: 'member', status: 'approved' },
        { tenantId: 2, tenantSlug: 'b', tenantName: 'B', role: 'member', status: 'approved' },
      ],
    })
    setActiveTenant.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      activeTenantId: 2,
      memberships: [
        { tenantId: 1, tenantSlug: 'a', tenantName: 'A', role: 'member', status: 'approved' },
        { tenantId: 2, tenantSlug: 'b', tenantName: 'B', role: 'member', status: 'approved' },
      ],
    })
    const user = userEvent.setup()
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('tenant: 1')).toBeInTheDocument())
    await user.click(screen.getByText('switch'))
    await waitFor(() => expect(screen.getByText('tenant: 2')).toBeInTheDocument())
    expect(setActiveTenant).toHaveBeenCalledWith(2)
  })

  it('sets user to null on auth:unauthorized event', async () => {
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      pictureUrl: null,
      bandMemberId: null,
    })
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('hello Alice')).toBeInTheDocument())
    act(() => { window.dispatchEvent(new Event('auth:unauthorized')) })
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
  })
})
