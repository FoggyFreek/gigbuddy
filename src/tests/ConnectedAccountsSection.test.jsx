import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../theme.ts'
import ConnectedAccountsSection from '../components/account/ConnectedAccountsSection.tsx'

vi.mock('../api/auth.ts', () => ({
  unlinkProvider: vi.fn(),
}))
vi.mock('../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))

import { unlinkProvider } from '../api/auth.ts'
import { useAuth } from '../contexts/authContext.ts'

function renderSection(route = '/settings/connected-accounts') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider theme={theme}>
        <ConnectedAccountsSection />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const refreshUser = vi.fn()

function mockProviders(providers) {
  useAuth.mockReturnValue({
    user: { id: 1, email: 'a@test.local', providers },
    refreshUser,
  })
}

describe('ConnectedAccountsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unlinkProvider.mockResolvedValue(undefined)
    refreshUser.mockResolvedValue(undefined)
  })

  it('shows linked status per provider and offers linking the missing one', () => {
    mockProviders({ google: true, microsoft: false })
    renderSection()

    expect(screen.getByText('Google')).toBeInTheDocument()
    expect(screen.getByText('Microsoft')).toBeInTheDocument()
    expect(screen.getByText('Linked')).toBeInTheDocument()
    expect(screen.getByText('Not linked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument()
  })

  it('disables unlinking the only sign-in method', () => {
    mockProviders({ google: true, microsoft: false })
    renderSection()

    expect(screen.getByRole('button', { name: 'Unlink' })).toBeDisabled()
  })

  it('requires confirmation before starting a link flow', async () => {
    mockProviders({ google: true, microsoft: false })
    renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'Link' }))

    expect(screen.getByText('Link Microsoft account?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })

  it('unlinks after confirmation and refreshes the user', async () => {
    mockProviders({ google: true, microsoft: true })
    renderSection()

    const unlinkButtons = screen.getAllByRole('button', { name: 'Unlink' })
    expect(unlinkButtons).toHaveLength(2)
    await userEvent.click(unlinkButtons[1])

    expect(screen.getByText('Remove Microsoft sign-in?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(unlinkProvider).toHaveBeenCalledWith('microsoft'))
    await waitFor(() => expect(refreshUser).toHaveBeenCalled())
  })

  it('surfaces a link error from the callback redirect', () => {
    mockProviders({ google: true, microsoft: false })
    renderSection('/settings/connected-accounts?linkError=expired')

    expect(screen.getByRole('alert')).toHaveTextContent('The linking session expired. Please try again.')
  })

  it('confirms a completed link from the callback redirect', () => {
    mockProviders({ google: true, microsoft: true })
    renderSection('/settings/connected-accounts?linked=microsoft')

    expect(screen.getByRole('alert')).toHaveTextContent('Microsoft account linked')
  })
})
