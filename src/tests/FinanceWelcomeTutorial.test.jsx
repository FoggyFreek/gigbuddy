import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import { AuthContext } from '../contexts/authContext.ts'
import TutorialHost from '../tutorials/TutorialHost.tsx'
import { getFinanceOnboardingStatus } from '../api/financeOnboarding.ts'
import { dismissTutorial } from '../api/tutorials.ts'

vi.mock('../api/financeOnboarding.ts', () => ({
  getFinanceOnboardingStatus: vi.fn(),
  setOpeningBalance: vi.fn(),
}))
vi.mock('../api/tutorials.ts', () => ({ dismissTutorial: vi.fn() }))

const FINANCE_USER = {
  id: 1,
  name: 'A',
  permissions: ['finance.view', 'finance.manage'],
  entitlements: null, // ownerless → enforcement skipped, features allowed
  dismissedTutorials: [],
  activeTenantId: 1,
}

function wrap(user, initialEntries = ['/']) {
  const value = {
    user,
    setUser: vi.fn(),
    logout: vi.fn(),
    switchTenant: vi.fn(),
    refreshUser: vi.fn().mockResolvedValue(user),
  }
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={value}>
          <TutorialHost />
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const TITLE = 'Welcome to your finances'

beforeEach(() => {
  vi.clearAllMocks()
  getFinanceOnboardingStatus.mockResolvedValue({ openingBalanceSet: false })
  dismissTutorial.mockResolvedValue(undefined)
})

describe('finance welcome tutorial', () => {
  it('shows for a finance manager whose tenant has no opening balance', async () => {
    wrap(FINANCE_USER)
    expect(await screen.findByText(TITLE)).toBeInTheDocument()
  })

  it('does not show once the tutorial is dismissed', async () => {
    wrap({ ...FINANCE_USER, dismissedTutorials: ['finance_welcome'] })
    await waitFor(() => expect(getFinanceOnboardingStatus).not.toHaveBeenCalled())
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('does not show when an opening balance already exists', async () => {
    getFinanceOnboardingStatus.mockResolvedValue({ openingBalanceSet: true })
    wrap(FINANCE_USER)
    await waitFor(() => expect(getFinanceOnboardingStatus).toHaveBeenCalled())
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('does not show for a user without finance.manage', async () => {
    wrap({ ...FINANCE_USER, permissions: ['finance.view'] })
    await waitFor(() => expect(getFinanceOnboardingStatus).not.toHaveBeenCalled())
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('is suppressed on the wizard route itself', async () => {
    wrap(FINANCE_USER, ['/finance-onboarding'])
    await waitFor(() => expect(getFinanceOnboardingStatus).not.toHaveBeenCalled())
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('"Maybe later" persists the dismissal and closes', async () => {
    wrap(FINANCE_USER)
    await screen.findByText(TITLE)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Maybe later' }))
    await waitFor(() => expect(dismissTutorial).toHaveBeenCalledWith('finance_welcome'))
    await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument())
  })
})
