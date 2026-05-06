import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.js'
import RedeemInvitePage from '../pages/RedeemInvitePage.jsx'

vi.mock('../api/invites.js', () => ({
  redeemInvite: vi.fn(),
}))

vi.mock('../contexts/authContext.js', () => ({
  useAuth: vi.fn(),
}))

import { redeemInvite } from '../api/invites.js'
import { useAuth } from '../contexts/authContext.js'

function wrap(ui, initialEntry = '/redeem-invite') {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>
    </ThemeProvider>,
  )
}

describe('RedeemInvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({
      user: { id: 1, name: 'Alice', memberships: [] },
      logout: vi.fn(),
      refreshUser: vi.fn().mockResolvedValue(null),
    })
  })

  it('auto-redeems when ?code= is in the URL', async () => {
    redeemInvite.mockResolvedValue({
      tenant: { id: 1, slug: 'a', name: 'Band A' },
      role: 'member',
      status: 'pending',
    })
    wrap(<RedeemInvitePage />, '/redeem-invite?code=abc123')
    await waitFor(() => expect(redeemInvite).toHaveBeenCalledWith('abc123'))
    await waitFor(() => expect(screen.getByText(/Band A/)).toBeInTheDocument())
  })

  it('submits manually when no code in URL', async () => {
    redeemInvite.mockResolvedValue({
      tenant: { id: 1, slug: 'a', name: 'Band A' },
      role: 'member',
      status: 'pending',
    })
    const user = userEvent.setup()
    wrap(<RedeemInvitePage />)
    const input = await screen.findByLabelText(/invite code/i)
    await user.type(input, 'manual-code')
    await user.click(screen.getByRole('button', { name: /redeem/i }))
    expect(redeemInvite).toHaveBeenCalledWith('manual-code')
    await waitFor(() => expect(screen.getByText(/Band A/)).toBeInTheDocument())
  })

  it('shows error message when redemption fails', async () => {
    redeemInvite.mockRejectedValue(new Error('Invite has expired'))
    const user = userEvent.setup()
    wrap(<RedeemInvitePage />)
    const input = await screen.findByLabelText(/invite code/i)
    await user.type(input, 'bad-code')
    await user.click(screen.getByRole('button', { name: /redeem/i }))
    await waitFor(() =>
      expect(screen.getByText('Invite has expired')).toBeInTheDocument(),
    )
  })

  it('refreshes the user after successful redemption', async () => {
    redeemInvite.mockResolvedValue({
      tenant: { id: 1, slug: 'a', name: 'Band A' },
      role: 'member',
      status: 'pending',
    })
    const refreshUser = vi.fn().mockResolvedValue(null)
    useAuth.mockReturnValue({
      user: { id: 1, name: 'Alice', memberships: [] },
      logout: vi.fn(),
      refreshUser,
    })
    const user = userEvent.setup()
    wrap(<RedeemInvitePage />)
    const input = await screen.findByLabelText(/invite code/i)
    await user.type(input, 'good-code')
    await user.click(screen.getByRole('button', { name: /redeem/i }))
    await waitFor(() => expect(refreshUser).toHaveBeenCalled())
  })
})
