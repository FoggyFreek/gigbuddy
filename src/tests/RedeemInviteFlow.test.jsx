// Integration tests for the invite-redemption journeys: real AuthProvider,
// RequireAuth, and RedeemInvitePage wired through the router, with only the
// api layer mocked. Each test mirrors one user-validated scenario; the shared
// invariant is that `gigbuddy:redirectAfterLogin` never outlives its journey.
import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import { AuthProvider } from '../contexts/AuthContext.tsx'
import RequireAuth from '../components/RequireAuth.tsx'
import RedeemInvitePage from '../pages/RedeemInvitePage.tsx'
import OnboardingPage from '../pages/OnboardingPage.tsx'

vi.mock('../api/auth.ts', () => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  setActiveTenant: vi.fn(),
}))
vi.mock('../api/invites.ts', () => ({
  redeemInvite: vi.fn(),
}))
// OnboardingPage (the new default landing spot for a memberless user) loads
// billing state on mount; stub it so the wizard settles without a real fetch.
vi.mock('../api/billing.ts', () => ({
  getBillingState: vi.fn(),
  subscribe: vi.fn(),
  syncSubscription: vi.fn(),
}))

import { getCurrentUser, logout as apiLogout } from '../api/auth.ts'
import { redeemInvite } from '../api/invites.ts'
import { getBillingState } from '../api/billing.ts'

const STASH_KEY = 'gigbuddy:redirectAfterLogin'

const memberlessUser = {
  id: 1,
  name: 'Alice',
  email: 'alice@example.com',
  status: 'approved',
  isSuperAdmin: false,
  pictureUrl: null,
  bandMemberId: null,
  memberships: [],
}

const redeemedBandA = {
  tenant: { id: 1, slug: 'a', name: 'Band A' },
  role: 'contributor',
  status: 'pending',
}

// StrictMode matches dev: double renders and double effects surfaced the
// real-world bug where the second bootstrap's urgent setUser interrupted the
// deep-link replay transition. Correct code must pass under StrictMode.
function mountApp(initialEntry) {
  return render(
    <StrictMode>
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<div>login page</div>} />
              <Route element={<RequireAuth />}>
                <Route path="/" element={<div>home</div>} />
                <Route path="/redeem-invite" element={<RedeemInvitePage />} />
                <Route path="/onboarding" element={<OnboardingPage />} />
              </Route>
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </ThemeProvider>
    </StrictMode>,
  )
}

// The pre-login half of the invite-link journey: anonymous visit to the
// invite URL bounces to /login and stashes the deep link (the /auth/me 401
// fires auth:unauthorized in the real client). Returns after unmounting, as
// the OIDC round trip reloads the SPA.
async function visitInviteLinkAnonymously() {
  getCurrentUser.mockReturnValue(new Promise(() => {}))
  const { unmount } = mountApp('/redeem-invite?code=XYZ')
  act(() => { window.dispatchEvent(new Event('auth:unauthorized')) })
  await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument())
  expect(localStorage.getItem(STASH_KEY)).toBe('/redeem-invite?code=XYZ')
  unmount()
}

describe('invite redemption flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem(STASH_KEY)
    apiLogout.mockResolvedValue(null)
    getBillingState.mockResolvedValue({ subscription: null, ownedTenantCount: 0, plans: [] })
  })

  it('scenario 1: memberless login lands on onboarding page; redeem link leads to empty code field; logout leaves no stash', async () => {
    getCurrentUser.mockResolvedValue(memberlessUser)
    const user = userEvent.setup()
    mountApp('/')

    // RequireAuth's zero-membership redirect now lands on /onboarding, not
    // /redeem-invite directly — the invite code page is reached via its link.
    const inviteLink = await screen.findByRole('link', { name: /redeem your invite code/i })
    await user.click(inviteLink)

    const input = await screen.findByLabelText(/invite code/i)
    expect(input).toHaveValue('')

    await user.click(screen.getByRole('button', { name: /log out/i }))
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument())
    expect(localStorage.getItem(STASH_KEY)).toBeNull()
  })

  it('scenario 2: memberless login, manual code entry and redeem; no stash appears', async () => {
    getCurrentUser.mockResolvedValue(memberlessUser)
    redeemInvite.mockResolvedValue(redeemedBandA)
    const user = userEvent.setup()
    mountApp('/')

    const inviteLink = await screen.findByRole('link', { name: /redeem your invite code/i })
    await user.click(inviteLink)

    const input = await screen.findByLabelText(/invite code/i)
    await user.type(input, 'manual-code')
    await user.click(screen.getByRole('button', { name: /redeem/i }))

    await waitFor(() => expect(screen.getByText(/Band A/)).toBeInTheDocument())
    expect(redeemInvite).toHaveBeenCalledWith('manual-code')
    expect(localStorage.getItem(STASH_KEY)).toBeNull()
  })

  it('scenario 3: invite link → login → replay with code populated, stash consumed, code redeemed', async () => {
    await visitInviteLinkAnonymously()

    // Post-OIDC reload at '/': the stash replays to the invite URL and the
    // page auto-redeems. Hold the redemption open to observe the populated
    // textbox and the already-consumed stash.
    getCurrentUser.mockResolvedValue(memberlessUser)
    let resolveRedeem
    redeemInvite.mockImplementation(() => new Promise((resolve) => { resolveRedeem = resolve }))
    mountApp('/')

    const input = await screen.findByLabelText(/invite code/i)
    await waitFor(() => expect(input).toHaveValue('XYZ'))
    expect(localStorage.getItem(STASH_KEY)).toBeNull()

    await act(async () => resolveRedeem(redeemedBandA))
    await waitFor(() => expect(screen.getByText(/Band A/)).toBeInTheDocument())
    expect(redeemInvite).toHaveBeenCalledWith('XYZ')
    expect(redeemInvite).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(STASH_KEY)).toBeNull()
  })

  it('scenario 4: invite link → login → replay with code, then logout leaves no stash', async () => {
    await visitInviteLinkAnonymously()

    getCurrentUser.mockResolvedValue(memberlessUser)
    redeemInvite.mockResolvedValue(redeemedBandA)
    const user = userEvent.setup()
    mountApp('/')

    await waitFor(() => expect(screen.getByText(/Band A/)).toBeInTheDocument())
    expect(localStorage.getItem(STASH_KEY)).toBeNull()

    await user.click(screen.getByRole('button', { name: /log out/i }))
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument())
    expect(localStorage.getItem(STASH_KEY)).toBeNull()
  })
})
