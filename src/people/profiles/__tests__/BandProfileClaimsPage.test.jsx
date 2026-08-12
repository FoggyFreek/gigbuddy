import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../../../theme.ts'
import BandProfileClaimsPage from '../../../admin/band-profile-claims/BandProfileClaimsPage.tsx'
import { CompactLayoutContext } from '../../../hooks/useCompactLayout.ts'

vi.mock('../../../admin/band-profile-claims/bandProfileClaims.ts', () => ({
  listClaimQueue: vi.fn(),
  listUnclaimedProfiles: vi.fn(),
  approveClaim: vi.fn(),
  rejectClaim: vi.fn(),
}))

import { listClaimQueue, listUnclaimedProfiles } from '../../../admin/band-profile-claims/bandProfileClaims.ts'

const approvedClaim = {
  id: 41,
  bandProfileId: null,
  bandProfileName: 'The Example Band',
  status: 'approved',
  message: 'We can verify ownership through our website.',
  decisionReason: null,
  createdAt: '2026-08-01T10:30:00.000Z',
  decidedAt: '2026-08-02T12:45:00.000Z',
  tenant: {
    id: 7,
    slug: 'example-band',
    displayName: 'Example Band Workspace',
    kind: 'band',
    archived: false,
    socials: {
      instagram: null,
      facebook: null,
      tiktok: null,
      youtube: null,
      spotify: null,
    },
  },
  requestedBy: { email: 'owner@example.test', name: 'Band Owner' },
  profileUsers: [],
  decidedBy: { email: 'admin@gigbuddy.test', name: 'Site Admin' },
  bandProfile: null,
}

const rejectedClaim = {
  ...approvedClaim,
  id: 42,
  status: 'rejected',
  decisionReason: 'Ownership could not be verified.',
}

const pendingClaim = {
  ...approvedClaim,
  id: 43,
  bandProfileId: 9,
  status: 'pending',
  decidedAt: null,
  decidedBy: null,
  tenant: {
    ...approvedClaim.tenant,
    socials: {
      instagram: 'exampleband',
      facebook: null,
      tiktok: '@exampleband',
      youtube: null,
      spotify: 'claiming-spotify-artist',
    },
  },
  bandProfile: {
    id: 9,
    name: 'The Example Band',
    countryCode: 'nl',
    spotifyUrl: 'https://open.spotify.com/artist/profile-spotify-artist',
    websiteUrl: 'https://the-example-band.test/',
    contactEmail: 'contact@the-example-band.test',
  },
  profileUsers: [
    {
      id: 51,
      name: 'Matched Musician',
      email: 'matched@example.test',
      requestingTenantMembership: { status: 'approved', role: 'reader' },
    },
    {
      id: 52,
      name: 'Outside Musician',
      email: 'outside@example.test',
      requestingTenantMembership: null,
    },
  ],
}

function wrap({ compact = false } = {}) {
  return render(
    <CompactLayoutContext.Provider value={compact}>
      <ThemeProvider theme={theme}>
        <BandProfileClaimsPage />
      </ThemeProvider>
    </CompactLayoutContext.Provider>,
  )
}

describe('BandProfileClaimsPage approved claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listClaimQueue.mockImplementation(({ status }) => Promise.resolve({
      items: status === 'approved' ? [approvedClaim] : status === 'rejected' ? [rejectedClaim] : [],
      meta: { limit: 20, returned: status === 'pending' ? 0 : 1, nextCursor: null },
    }))
  })

  it('shows approved claims in a table with reviewer details on desktop', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(screen.getByRole('tab', { name: 'Approved' }))

    const table = await screen.findByRole('table', { name: 'Approved band profile claims' })
    const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers).toEqual([
      'Band',
      'Claimed by',
      'Claimed on',
      'Requested by',
      'Requested on',
      'Approved by',
      'Approved on',
      'Status',
      'Information',
    ])

    const row = within(table).getAllByRole('row')[1]
    expect(within(row).getByText('The Example Band')).toBeInTheDocument()
    expect(within(row).getByText('Example Band Workspace')).toBeInTheDocument()
    expect(within(row).getByText('Band Owner')).toBeInTheDocument()
    expect(within(row).getByText('Site Admin')).toBeInTheDocument()
    const information = within(row).getByLabelText('Claim information')
    expect(information).toBeInTheDocument()
    await user.hover(information)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('We can verify ownership through our website.')
  })

  it('keeps approved claims in cards in compact mode', async () => {
    const user = userEvent.setup()
    wrap({ compact: true })

    await user.click(screen.getByRole('tab', { name: 'Approved' }))
    await screen.findByText('The Example Band')

    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument())
    expect(screen.getByText('We can verify ownership through our website.')).toBeInTheDocument()
  })

  it('shows rejected claims in the same desktop table with rejected decision labels', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(screen.getByRole('tab', { name: 'Rejected' }))

    const table = await screen.findByRole('table', { name: 'Rejected band profile claims' })
    const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers).toEqual([
      'Band',
      'Claimed by',
      'Claimed on',
      'Requested by',
      'Requested on',
      'Rejected by',
      'Rejected on',
      'Status',
      'Information',
    ])
    expect(within(table).getByText('Site Admin')).toBeInTheDocument()
    expect(within(table).getByLabelText('Claim information')).toBeInTheDocument()
  })
})

describe('BandProfileClaimsPage pending claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listClaimQueue.mockResolvedValue({
      items: [pendingClaim],
      meta: { limit: 20, returned: 1, nextCursor: null },
    })
  })

  it('shows requester contact details and both sides of the social comparison', async () => {
    wrap()

    expect(await screen.findByText('Band Owner')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'owner@example.test' })).toHaveAttribute(
      'href',
      'mailto:owner@example.test',
    )

    const claimingBand = screen.getByRole('region', { name: 'Claiming band socials' })
    expect(within(claimingBand).getByRole('link', { name: 'Instagram' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/exampleband',
    )
    expect(within(claimingBand).getByRole('link', { name: 'TikTok' })).toHaveAttribute(
      'href',
      'https://www.tiktok.com/@exampleband',
    )
    expect(within(claimingBand).getByRole('link', { name: 'Spotify' })).toHaveAttribute(
      'href',
      'https://open.spotify.com/artist/claiming-spotify-artist',
    )

    const claimedProfile = screen.getByRole('region', { name: 'Claimed profile links' })
    expect(within(claimedProfile).getByRole('link', { name: 'Spotify' })).toHaveAttribute(
      'href',
      pendingClaim.bandProfile.spotifyUrl,
    )
    expect(within(claimedProfile).getByRole('link', { name: 'Website' })).toHaveAttribute(
      'href',
      pendingClaim.bandProfile.websiteUrl,
    )

    const profileUsers = screen.getByRole('region', { name: 'Band profile users' })
    expect(within(profileUsers).getByText('Matched Musician')).toBeInTheDocument()
    expect(within(profileUsers).getByRole('link', { name: 'matched@example.test' })).toHaveAttribute(
      'href',
      'mailto:matched@example.test',
    )
    expect(within(profileUsers).getByText('Member of requesting band')).toBeInTheDocument()
    expect(within(profileUsers).getByText('Outside Musician')).toBeInTheDocument()
    expect(within(profileUsers).getByText('Not in requesting band')).toBeInTheDocument()
  })
})

describe('BandProfileClaimsPage unclaimed profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listClaimQueue.mockResolvedValue({
      items: [],
      meta: { limit: 20, returned: 0, nextCursor: null },
    })
    listUnclaimedProfiles.mockImplementation(({ cursor }) => Promise.resolve(cursor ? {
      items: [{ id: 72, name: 'Last Band', memberCount: 1, createdAt: '2026-08-01T00:00:00.000Z' }],
      meta: { limit: 25, returned: 1, total: 26, nextCursor: null },
    } : {
      items: [{ id: 71, name: 'Unclaimed Band', memberCount: 4, createdAt: '2026-08-02T00:00:00.000Z' }],
      meta: { limit: 25, returned: 1, total: 26, nextCursor: 'next-page' },
    }))
  })

  it('shows member counts in a paginated table and loads the next cursor page', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(screen.getByRole('tab', { name: 'Unclaimed' }))

    const table = await screen.findByRole('table', { name: 'Unclaimed band profiles' })
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Band profile',
      'Member count',
    ])
    expect(within(table).getByText('Unclaimed Band')).toBeInTheDocument()
    expect(within(table).getByText('4')).toBeInTheDocument()
    expect(screen.getByText('1–25 of 26')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))

    expect(await screen.findByText('Last Band')).toBeInTheDocument()
    expect(listUnclaimedProfiles).toHaveBeenLastCalledWith({ limit: 25, cursor: 'next-page' })
  })
})
