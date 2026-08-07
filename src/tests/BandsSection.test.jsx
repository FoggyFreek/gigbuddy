import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import { AuthContext } from '../contexts/authContext.ts'
import BandsSection from '../components/settings/BandsSection.tsx'
import { parseInviteCode } from '../utils/inviteCode.ts'
import { redeemInvite } from '../api/invites.ts'
import {
  searchBands,
  listJoinRequests,
  requestToJoinBand,
  withdrawJoinRequest,
} from '../api/bandDirectory.ts'

vi.mock('../api/invites.ts', () => ({ redeemInvite: vi.fn() }))
vi.mock('../api/bandDirectory.ts', () => ({
  searchBands: vi.fn(),
  listJoinRequests: vi.fn(),
  requestToJoinBand: vi.fn(),
  withdrawJoinRequest: vi.fn(),
}))

const USER = {
  id: 1,
  name: 'Alpha User',
  activeTenantId: 3,
  activeTenantKind: 'personal',
  memberships: [
    { tenantId: 3, displayName: 'Alpha User', kind: 'personal', status: 'approved', role: 'tenant_admin' },
    {
      tenantId: 1,
      displayName: 'Band A',
      tenantAvatarPath: 'tenants/1/avatar/band-a.png',
      kind: 'band',
      status: 'approved',
      role: 'member',
    },
    {
      tenantId: 2,
      displayName: 'Band B',
      tenantAvatarPath: 'tenants/2/avatar/band-b.png',
      kind: 'band',
      status: 'pending',
      role: 'member',
    },
  ],
}

let refreshUser

function wrap(user = USER) {
  refreshUser = vi.fn().mockResolvedValue(user)
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider
        value={{ user, setUser: vi.fn(), logout: vi.fn(), switchTenant: vi.fn(), refreshUser }}
      >
        <BandsSection />
      </AuthContext.Provider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  redeemInvite.mockResolvedValue({ tenant_id: 2 })
  searchBands.mockResolvedValue({ items: [], meta: { limit: 10 } })
  listJoinRequests.mockResolvedValue({ items: [] })
  requestToJoinBand.mockResolvedValue({
    tenant: { id: 9, slug: 'open-road', displayName: 'Open Road' }, status: 'pending',
  })
  withdrawJoinRequest.mockResolvedValue(undefined)
})

describe('parseInviteCode', () => {
  it('takes a bare code as-is, trimmed', () => {
    expect(parseInviteCode('  ABC123  ')).toBe('ABC123')
  })

  it('pulls the code out of a pasted invite link', () => {
    expect(parseInviteCode('https://app.gigbuddy.test/redeem-invite?code=ABC123')).toBe('ABC123')
    expect(parseInviteCode('/redeem-invite?code=ABC123&x=1')).toBe('ABC123')
  })

  it('returns nothing for a link that carries no code', () => {
    expect(parseInviteCode('https://app.gigbuddy.test/redeem-invite')).toBe('')
  })

  it('does not mistake a code containing a colon for a URL', () => {
    expect(parseInviteCode('abc:def')).toBe('abc:def')
  })

  it('is empty for empty input', () => {
    expect(parseInviteCode('')).toBe('')
    expect(parseInviteCode(null)).toBe('')
  })
})

describe('BandsSection', () => {
  it('lists the bands but never the workspace itself', () => {
    wrap()
    expect(screen.getByText('Band A')).toBeInTheDocument()
    expect(screen.getByText('Band B')).toBeInTheDocument()
    expect(screen.queryByText('Alpha User')).not.toBeInTheDocument()
  })

  it('shows each band avatar in front of its name', () => {
    wrap()
    expect(screen.getByRole('img', { name: 'Band A' })).toHaveAttribute(
      'src',
      '/api/tenants/1/avatar',
    )
    expect(screen.getByRole('img', { name: 'Band B' })).toHaveAttribute(
      'src',
      '/api/tenants/2/avatar',
    )
  })

  it('marks a pending membership as awaiting the band', () => {
    wrap()
    expect(screen.getByText('Waiting for the band to approve you')).toBeInTheDocument()
  })

  it('joins with a pasted invite URL and reports the pending state', async () => {
    const user = userEvent.setup()
    wrap()

    await user.type(
      screen.getByLabelText('Invite link or code'),
      'https://app.gigbuddy.test/redeem-invite?code=XYZ789',
    )
    await user.click(screen.getByRole('button', { name: 'Join' }))

    await waitFor(() => expect(redeemInvite).toHaveBeenCalledWith('XYZ789'))
    expect(await screen.findByText(/once a band admin approves you/i)).toBeInTheDocument()
    await waitFor(() => expect(refreshUser).toHaveBeenCalled())
  })

  it('joins with a bare code', async () => {
    const user = userEvent.setup()
    wrap()
    await user.type(screen.getByLabelText('Invite link or code'), 'XYZ789')
    await user.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(redeemInvite).toHaveBeenCalledWith('XYZ789'))
  })

  it('rejects a link with no code without calling the API', async () => {
    const user = userEvent.setup()
    wrap()
    await user.type(screen.getByLabelText('Invite link or code'), 'https://app.gigbuddy.test/redeem-invite')
    await user.click(screen.getByRole('button', { name: 'Join' }))

    expect(await screen.findByText(/doesn't contain an invite code/i)).toBeInTheDocument()
    expect(redeemInvite).not.toHaveBeenCalled()
  })

  it('says so when the musician is in no band yet', () => {
    wrap({ ...USER, memberships: [USER.memberships[0]] })
    expect(screen.getByText('You are not in any band yet.')).toBeInTheDocument()
  })
})

describe('BandDirectorySearch', () => {
  const HIT = {
    id: 9, slug: 'open-road', displayName: 'Open Road', logoPath: null, membershipStatus: 'none',
  }

  it('does not search until the query is long enough', async () => {
    const user = userEvent.setup()
    wrap()
    await user.type(screen.getByLabelText('Band name'), 'ab')
    await waitFor(() => expect(searchBands).not.toHaveBeenCalled())
  })

  it('searches and offers to ask a discoverable band', async () => {
    searchBands.mockResolvedValue({ items: [HIT], meta: { limit: 10 } })
    const user = userEvent.setup()
    wrap()

    await user.type(screen.getByLabelText('Band name'), 'Open')
    await waitFor(() => expect(searchBands).toHaveBeenCalledWith('Open'))
    expect(await screen.findByText('Open Road')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ask to join' }))
    await user.type(await screen.findByLabelText(/Message/), 'I play bass.')
    await user.click(screen.getByRole('button', { name: 'Send request' }))

    await waitFor(() => expect(requestToJoinBand).toHaveBeenCalledWith(9, 'I play bass.'))
  })

  it('labels a band the caller already asked instead of offering again', async () => {
    searchBands.mockResolvedValue({
      items: [{ ...HIT, membershipStatus: 'pending' }], meta: { limit: 10 },
    })
    const user = userEvent.setup()
    wrap()
    await user.type(screen.getByLabelText('Band name'), 'Open')
    expect(await screen.findByText('Request sent')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask to join' })).not.toBeInTheDocument()
  })

  it('explains the cap rather than offering an upgrade', async () => {
    searchBands.mockResolvedValue({ items: [HIT], meta: { limit: 10 } })
    requestToJoinBand.mockRejectedValue(
      Object.assign(new Error('cap'), { code: 'join_request_limit' }),
    )
    const user = userEvent.setup()
    wrap()

    await user.type(screen.getByLabelText('Band name'), 'Open')
    await user.click(await screen.findByRole('button', { name: 'Ask to join' }))
    await user.click(screen.getByRole('button', { name: 'Send request' }))

    expect(await screen.findByText(/three open requests/i)).toBeInTheDocument()
    expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument()
  })

  it('withdraws an open request', async () => {
    listJoinRequests.mockResolvedValue({
      items: [{ tenantId: 9, slug: 'open-road', displayName: 'Open Road', requestMessage: null, createdAt: 'x' }],
    })
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(withdrawJoinRequest).toHaveBeenCalledWith(9))
  })
})
