import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import { AuthContext } from '../contexts/authContext.ts'
import TutorialHost from '../tutorials/TutorialHost.tsx'
import { getFinanceOnboardingStatus } from '../api/financeOnboarding.ts'

vi.mock('../api/financeOnboarding.ts', () => ({
  getFinanceOnboardingStatus: vi.fn(),
  setOpeningBalance: vi.fn(),
}))
vi.mock('../api/tutorials.ts', () => ({ dismissTutorial: vi.fn() }))

// Finance-capable in both cases, so the only thing deciding which tutorial
// selects is the active tenant's kind.
const baseUser = {
  id: 1,
  name: 'Alpha User',
  permissions: ['finance.view', 'finance.manage'],
  entitlements: null, // ownerless → enforcement skipped, features allowed
  dismissedTutorials: [],
  activeTenantId: 1,
}

function wrap(user) {
  const value = {
    user,
    setUser: vi.fn(),
    logout: vi.fn(),
    switchTenant: vi.fn(),
    refreshUser: vi.fn().mockResolvedValue(user),
  }
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={value}>
          <TutorialHost />
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const PERSONAL_TITLE = 'Welcome to your own workspace'
const BAND_TITLE = 'Welcome to your finances'

beforeEach(() => {
  vi.clearAllMocks()
  getFinanceOnboardingStatus.mockResolvedValue({ openingBalanceSet: false })
})

describe('tutorials are selected by tenant kind', () => {
  it('shows the workspace tutorial — and no band tutorial — in a personal workspace', async () => {
    wrap({ ...baseUser, activeTenantKind: 'personal' })
    expect(await screen.findByText(PERSONAL_TITLE)).toBeInTheDocument()
    expect(screen.queryByText(BAND_TITLE)).not.toBeInTheDocument()
    // A band-only tutorial's async condition must not even be probed.
    await waitFor(() => expect(getFinanceOnboardingStatus).not.toHaveBeenCalled())
  })

  it('never shows the workspace tutorial in a band', async () => {
    wrap({ ...baseUser, activeTenantKind: 'band' })
    expect(await screen.findByText(BAND_TITLE)).toBeInTheDocument()
    expect(screen.queryByText(PERSONAL_TITLE)).not.toBeInTheDocument()
  })

  it('once dismissed, the band tutorial takes over in a band tenant', async () => {
    wrap({
      ...baseUser,
      activeTenantKind: 'band',
      dismissedTutorials: ['personal_workspace_welcome'],
    })
    expect(await screen.findByText(BAND_TITLE)).toBeInTheDocument()
  })
})
