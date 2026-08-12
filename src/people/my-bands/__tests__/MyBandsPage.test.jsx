import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../../../theme.ts'
import MyBandsPage from '../MyBandsPage.tsx'
import { ThemeModeContext } from '../../../contexts/themeModeContext.ts'
import { CompactLayoutContext } from '../../../hooks/useCompactLayout.ts'

vi.mock('../myBands.ts', () => ({
  listMyBands: vi.fn(),
  addMyBand: vi.fn(),
  getRemovalPreview: vi.fn(),
  removeMyBand: vi.fn(),
}))
vi.mock('../../band-profiles/bandProfiles.ts', () => ({
  searchBandProfiles: vi.fn(),
  getBandProfile: vi.fn(),
  updateBandProfile: vi.fn(),
}))
vi.mock('../../memberships/bandDirectory.ts', () => ({
  searchBands: vi.fn(),
  requestToJoinBand: vi.fn(),
  listJoinRequests: vi.fn(),
  withdrawJoinRequest: vi.fn(),
}))
vi.mock('../../memberships/invites.ts', () => ({ redeemInvite: vi.fn() }))
vi.mock('../../../planning/availability/me.ts', () => ({ leaveTenant: vi.fn() }))
vi.mock('../../../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('../../../planning/shared/useCrossTenantNavigate.ts', () => ({ useCrossTenantNavigate: vi.fn() }))

import { listMyBands, getRemovalPreview, removeMyBand } from '../myBands.ts'
import { searchBandProfiles } from '../../band-profiles/bandProfiles.ts'
import { searchBands, listJoinRequests, withdrawJoinRequest } from '../../memberships/bandDirectory.ts'
import { leaveTenant } from '../../../planning/availability/me.ts'
import { useAuth } from '../../../contexts/authContext.ts'
import { useCrossTenantNavigate } from '../../../planning/shared/useCrossTenantNavigate.ts'

const profile = (over = {}) => ({
  id: 5001,
  name: 'Off Platform',
  countryCode: 'nl',
  spotifyUrl: null,
  websiteUrl: 'https://offplatform.example',
  contactEmail: null,
  status: 'claimable',
  claimed: false,
  claimedTenant: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  canEdit: true,
  ...over,
})

const myBand = ({ bandProfile, ...over } = {}) => ({
  id: 11,
  eventCounts: { gigs: 2, rehearsals: 1, bandEvents: 0 },
  addedAt: '2026-01-01T00:00:00.000Z',
  ...over,
  // After the spread: overrides describe the profile's fields, not the whole
  // profile, so they must not replace the built one.
  bandProfile: profile(bandProfile),
})

const AUTH = {
  user: {
    id: 1,
    memberships: [
      { tenantId: 7, tenantName: 'Real Band', kind: 'band', status: 'approved', tenantAvatarPath: null },
      { tenantId: 8, tenantName: 'My workspace', kind: 'personal', status: 'approved', tenantAvatarPath: null },
    ],
  },
  refreshUser: vi.fn(),
}

const wrap = ({ mode = 'light', compact = false } = {}) => render(
  <ThemeModeContext.Provider value={{ mode, toggleTheme: vi.fn(), variant: 'default', setVariant: vi.fn() }}>
    <CompactLayoutContext.Provider value={compact}>
      <ThemeProvider theme={theme}>
        <MemoryRouter><MyBandsPage /></MemoryRouter>
      </ThemeProvider>
    </CompactLayoutContext.Provider>
  </ThemeModeContext.Provider>,
)

describe('MyBandsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue(AUTH)
    useCrossTenantNavigate.mockReturnValue(vi.fn())
    listMyBands.mockResolvedValue({ items: [myBand()], meta: { limit: 50, returned: 1 } })
    searchBandProfiles.mockResolvedValue({ items: [], meta: { limit: 10, returned: 0 } })
    searchBands.mockResolvedValue({ items: [], meta: { limit: 10 } })
    listJoinRequests.mockResolvedValue({ items: [] })
  })

  it('lists gigbuddy bands and off-platform profiles together', async () => {
    wrap()
    await waitFor(() => expect(screen.getAllByText('Off Platform').length).toBeGreaterThan(0))

    expect(screen.getAllByText('Real Band').length).toBeGreaterThan(0)
    // The personal workspace itself is not one of the artist's bands.
    expect(screen.queryByText('My workspace')).toBeNull()
  })

  it('explains the search-first workflow and presents both creation options', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(screen.getByRole('button', { name: 'Add band' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(
      "Add a band by first searching for existing bands. If your band isn't on gigBuddy and has no public profile yet, you can create a new band or public band profile.",
    )).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Create a new band' })).toBeInTheDocument()
    expect(within(dialog).getByText(
      'If you manage this band and want to invite more members. This will count towards your gigBuddy bands limit.',
    )).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Create a public band profile' })).toBeInTheDocument()
    expect(within(dialog).getByText(
      'For a band you take part in, but is not (yet) on gigBuddy. You can link events to this band so you stay organized.',
    )).toBeInTheDocument()

    const createBand = within(dialog).getByRole('button', { name: 'Create band' })
    const createProfile = within(dialog).getByRole('button', { name: 'Create public profile' })
    expect(createBand).toBeDisabled()
    expect(createProfile).toBeDisabled()

    await user.type(within(dialog).getByRole('textbox', { name: 'Band name' }), 'Fresh Band')
    await waitFor(() => expect(createBand).toBeEnabled())
    expect(createProfile).toBeEnabled()
  })

  it('shows GigBuddy membership with a logo and tooltip', async () => {
    const user = userEvent.setup()
    wrap()

    const logo = await screen.findByRole('img', { name: 'On gigbuddy' })
    expect(logo).toHaveAttribute('src', '/icons/gb_light_128.png')
    await user.hover(logo)

    expect(await screen.findByRole('tooltip')).toHaveTextContent('On gigbuddy')
  })

  it('uses the dark-theme GigBuddy status icon', async () => {
    wrap({ mode: 'dark' })

    const logo = await screen.findByRole('img', { name: 'On gigbuddy' })
    expect(logo).toHaveAttribute('src', '/icons/gb_dark_128.png')
  })

  it('centers compact GigBuddy status and actions in the card body', async () => {
    wrap({ compact: true })

    const bandName = await screen.findByText('Real Band')
    const card = bandName.closest('.MuiCard-root')
    const content = card.querySelector('.MuiCardContent-root')
    const logo = within(card).getByRole('img', { name: 'On gigbuddy' })

    expect(content.firstElementChild.firstElementChild).toBe(logo)
    expect(within(content).getByRole('button', { name: 'Open band' })).toBeInTheDocument()
    expect(within(content).getByRole('button', { name: 'Leave band' })).toBeInTheDocument()
    expect(card.querySelector('.MuiCardActions-root')).toBeNull()
  })

  // The two halves behave differently, and the row has to say which it is.
  it('offers leaving a gigbuddy band and removing a profile', async () => {
    wrap()
    await waitFor(() => expect(screen.getAllByText('Off Platform').length).toBeGreaterThan(0))

    expect(screen.getAllByRole('button', { name: 'Leave band' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBeGreaterThan(0)
  })

  it('does not offer editing a profile somebody else created', async () => {
    listMyBands.mockResolvedValue({
      items: [myBand({ bandProfile: { canEdit: false } })],
      meta: { limit: 50, returned: 1 },
    })
    wrap()
    await waitFor(() => expect(screen.getAllByText('Off Platform').length).toBeGreaterThan(0))

    screen.getAllByRole('button', { name: 'Edit' }).forEach((b) => expect(b).toBeDisabled())
  })

  it('does not offer editing a profile that is being claimed', async () => {
    listMyBands.mockResolvedValue({
      items: [myBand({ bandProfile: { status: 'pending_claim' } })],
      meta: { limit: 50, returned: 1 },
    })
    wrap()
    await waitFor(() => expect(screen.getAllByText('Off Platform').length).toBeGreaterThan(0))

    screen.getAllByRole('button', { name: 'Edit' }).forEach((b) => expect(b).toBeDisabled())
  })
})

describe('removing a band', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue(AUTH)
    useCrossTenantNavigate.mockReturnValue(vi.fn())
    listMyBands.mockResolvedValue({ items: [myBand()], meta: { limit: 50, returned: 1 } })
    listJoinRequests.mockResolvedValue({ items: [] })
    getRemovalPreview.mockResolvedValue({ gigs: 2, rehearsals: 1, bandEvents: 0 })
    removeMyBand.mockResolvedValue({ removed: true, mode: 'keep' })
  })

  const openRemove = async (user) => {
    wrap()
    await waitFor(() => expect(screen.getAllByText('Off Platform').length).toBeGreaterThan(0))
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    await screen.findByText(/3 of your events/)
  }

  // Removing a band must never destroy a musician's events by accident.
  it('keeps the events by default', async () => {
    const user = userEvent.setup()
    await openRemove(user)

    await user.click(screen.getByRole('button', { name: 'Remove band' }))

    expect(removeMyBand).toHaveBeenCalledWith(11, 'keep')
  })

  it('needs a second confirmation before deleting them', async () => {
    const user = userEvent.setup()
    await openRemove(user)

    await user.click(screen.getByRole('radio', { name: /Delete my events/ }))
    await user.click(screen.getByRole('button', { name: 'Remove band' }))

    // First click only arms the destructive action.
    expect(removeMyBand).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /Yes, delete 3 events/ }))
    expect(removeMyBand).toHaveBeenCalledWith(11, 'delete')
  })
})

describe('leaving a band', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue(AUTH)
    useCrossTenantNavigate.mockReturnValue(vi.fn())
    listMyBands.mockResolvedValue({ items: [], meta: { limit: 50, returned: 0 } })
    listJoinRequests.mockResolvedValue({ items: [] })
  })

  it('explains the last-admin rule instead of showing a raw error', async () => {
    const err = new Error('This band must keep at least one admin')
    err.code = 'last_tenant_admin'
    err.status = 409
    leaveTenant.mockRejectedValue(err)
    const user = userEvent.setup()

    wrap()
    await waitFor(() => expect(screen.getAllByText('Real Band').length).toBeGreaterThan(0))
    await user.click(screen.getAllByRole('button', { name: 'Leave band' })[0])

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Leave band' }))

    expect(await screen.findByText(/only admin/i)).toBeInTheDocument()
  })
})

// Outstanding join requests are capped and this is the only place to withdraw
// one, so an artist whose requests go unanswered would otherwise be stuck.
describe('pending join requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue(AUTH)
    useCrossTenantNavigate.mockReturnValue(vi.fn())
    listMyBands.mockResolvedValue({ items: [], meta: { limit: 50, returned: 0 } })
    listJoinRequests.mockResolvedValue({
      items: [{ tenantId: 99, slug: 'hopeful', displayName: 'Hopeful Band', requestMessage: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    })
    withdrawJoinRequest.mockResolvedValue(undefined)
  })

  it('shows a band the artist asked to join, and withdraws it', async () => {
    const user = userEvent.setup()
    wrap()
    await waitFor(() => expect(screen.getAllByText('Hopeful Band').length).toBeGreaterThan(0))

    await user.click(screen.getAllByRole('button', { name: 'Withdraw' })[0])

    expect(withdrawJoinRequest).toHaveBeenCalledWith(99)
  })

  it('does not list a band twice when the membership already exists', async () => {
    listJoinRequests.mockResolvedValue({
      items: [{ tenantId: 7, slug: 'real-band', displayName: 'Real Band', requestMessage: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    })
    wrap()
    await waitFor(() => expect(screen.getAllByText('Real Band').length).toBeGreaterThan(0))

    expect(screen.queryAllByRole('button', { name: 'Withdraw' })).toHaveLength(0)
  })
})
