import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.js'
import InvitesSection from '../components/InvitesSection.jsx'

vi.mock('../api/invites.js', () => ({
  listInvites: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
}))

import { listInvites, createInvite, revokeInvite } from '../api/invites.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const ACTIVE = {
  id: 1,
  code: 'abc',
  url: 'http://localhost/redeem-invite?code=abc',
  role: 'member',
  created_at: '2026-05-01T00:00:00Z',
  created_by_name: 'Admin',
  expires_at: null,
  used_at: null,
  used_by_name: null,
}

describe('InvitesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists invites returned by the API', async () => {
    listInvites.mockResolvedValue([ACTIVE])
    wrap(<InvitesSection canIssueAdmin={false} />)
    await waitFor(() => expect(screen.getByText('member')).toBeInTheDocument())
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('shows empty state when no invites exist', async () => {
    listInvites.mockResolvedValue([])
    wrap(<InvitesSection canIssueAdmin={false} />)
    await waitFor(() => expect(screen.getByText(/No invites yet/)).toBeInTheDocument())
  })

  it('creates a new invite via the dialog', async () => {
    listInvites.mockResolvedValue([])
    const created = { ...ACTIVE, id: 2, code: 'new' }
    createInvite.mockResolvedValue(created)
    const user = userEvent.setup()
    wrap(<InvitesSection canIssueAdmin={false} />)
    await waitFor(() => expect(screen.getByText(/No invites yet/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /new invite/i }))
    await user.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() =>
      expect(createInvite).toHaveBeenCalledWith({ role: 'member', expiresInDays: 14 }),
    )
  })

  it('disables the tenant_admin option for non-super issuers', async () => {
    listInvites.mockResolvedValue([])
    const user = userEvent.setup()
    wrap(<InvitesSection canIssueAdmin={false} />)
    await waitFor(() => expect(screen.getByText(/No invites yet/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /new invite/i }))
    await user.click(screen.getByRole('combobox'))
    const option = await screen.findByRole('option', { name: /tenant_admin/ })
    expect(option).toHaveAttribute('aria-disabled', 'true')
  })

  it('revokes an active invite', async () => {
    listInvites.mockResolvedValueOnce([ACTIVE])
    listInvites.mockResolvedValueOnce([{ ...ACTIVE, expires_at: new Date(Date.now() - 1000).toISOString() }])
    revokeInvite.mockResolvedValue(null)
    const user = userEvent.setup()
    wrap(<InvitesSection canIssueAdmin={false} />)
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /revoke invite/i }))
    expect(revokeInvite).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByText('expired')).toBeInTheDocument())
  })

  it('copies the invite URL to the clipboard', async () => {
    listInvites.mockResolvedValue([ACTIVE])
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText })
    wrap(<InvitesSection canIssueAdmin={false} />)
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /copy invite url/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ACTIVE.url))
  })
})
