import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.ts', () => ({
  listGigs: vi.fn(),
  listUpcomingGigs: vi.fn(),
  listPastGigs: vi.fn(),
  searchGigs: vi.fn(),
  getGig: vi.fn(),
  getGigMerchSummary: vi.fn().mockResolvedValue({ unitsSold: 0, netCents: 0, grossCents: 0 }),
  createGig: vi.fn(),
  updateGig: vi.fn(),
  deleteGig: vi.fn().mockResolvedValue({}),
  addGigParticipant: vi.fn().mockResolvedValue({}),
  removeGigParticipant: vi.fn().mockResolvedValue({}),
  setGigVote: vi.fn().mockResolvedValue({}),
  listGigContacts: vi.fn().mockResolvedValue([]),
  addGigContact: vi.fn().mockResolvedValue({}),
  setGigContactPrimary: vi.fn().mockResolvedValue({}),
  removeGigContact: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../api/me.ts', () => ({
  listMyUpcomingGigs: vi.fn(),
  listMyPastGigs: vi.fn(),
  searchMyGigs: vi.fn(),
  getMyGig: vi.fn(),
  setMyTaskDone: vi.fn(),
}))
vi.mock('../api/venues.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/invoices.ts', () => ({
  listInvoicesByGig: vi.fn().mockResolvedValue([]),
  draftFromGig: vi.fn(),
  createInvoice: vi.fn(),
}))
vi.mock('../api/availability.ts', () => ({
  getAvailabilityOn: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  evaluateEventAvailability: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))
vi.mock('../api/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/profile.ts', () => ({
  getProfile: vi.fn().mockResolvedValue({ banner_path: null }),
  getBannerPath: vi.fn().mockResolvedValue(null),
}))
vi.mock('../components/TourShareDialog.tsx', () => ({
  default: ({ open, gigs }) => open
    ? <div data-testid="tour-share-gigs">{gigs.map((gig) => gig.event_description).join(',')}</div>
    : null,
}))
vi.mock('../components/BannerMosaicDialog.tsx', () => ({
  default: ({ open, gigs }) => open
    ? <div data-testid="mosaic-share-gigs">{gigs.map((gig) => gig.event_description).join(',')}</div>
    : null,
}))

import GigsPage from '../pages/GigsPage.tsx'
import GigDetailPage from '../pages/GigDetailPage.tsx'
import { addGigParticipant, deleteGig, getGig, listGigs, listPastGigs, listUpcomingGigs, removeGigParticipant, searchGigs } from '../api/gigs.ts'
import { evaluateEventAvailability } from '../api/availability.ts'
import { listMembers } from '../api/bandMembers.ts'
import { listMyUpcomingGigs } from '../api/me.ts'
import theme from '../theme.ts'
import { AuthContext } from '../contexts/authContext.ts'
import { ProfileContext } from '../contexts/profileContext.ts'

const limitedCollection = (items, total = items.length) => ({ items, meta: { limit: 100, returned: items.length, total } })
const pastCollection = (items) => ({ items, meta: { limit: 100, returned: items.length, nextCursor: null } })

// Render as a writer (super admin grants every planning.write capability) so the
// create/edit/delete affordances gated on canWritePlanning are present.
const writerAuth = { user: { isSuperAdmin: true } }

const integrationProfile = (configured = true) => ({
  bandName: '', setBandName: vi.fn(), accentColor: null, setAccentColor: vi.fn(),
  integrations: { shopify: configured, bandsintown: configured, mollie: configured, resend: configured },
  isIntegrationConfigured: () => configured,
  setIntegrationConfigured: vi.fn(),
})

function wrap(ui, { initialEntries = ['/'], integrationsConfigured = true, auth = writerAuth } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={auth}>
          <ProfileContext.Provider value={integrationProfile(integrationsConfigured)}>
            <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
          </ProfileContext.Provider>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

function wrapWithRoutes({ initialEntries }) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={writerAuth}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <Routes>
              <Route path="/gigs" element={<GigsPage />}>
                <Route path=":id" element={<GigDetailPage />} />
              </Route>
            </Routes>
          </LocalizationProvider>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

const GIGS = [
  {
    id: 42,
    event_date: '2099-06-15T00:00:00.000Z',
    event_description: 'Jazz Night',
    venue: 'Bimhuis',
    city: 'Amsterdam',
    start_time: '20:00:00',
    end_time: '23:00:00',
    status: 'confirmed',
    open_task_count: 0,
  },
]

describe('GigsPage', () => {
  beforeEach(() => {
    listGigs.mockReset()
    listGigs.mockResolvedValue(GIGS)
    listUpcomingGigs.mockReset()
    listUpcomingGigs.mockResolvedValue(limitedCollection(GIGS))
    listPastGigs.mockReset()
    listPastGigs.mockResolvedValue(pastCollection([]))
    searchGigs.mockReset()
    searchGigs.mockResolvedValue([])
    listMyUpcomingGigs.mockReset()
    listMyUpcomingGigs.mockResolvedValue(limitedCollection([]))
  })

  it('renders header, Add button, and loaded gigs without fetching the full unscoped gig list', async () => {
    wrap(<GigsPage />)
    expect(screen.getByRole('heading', { name: /^gigs$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add$/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())

    // The Upcoming tab is served entirely by the bounded /upcoming fetch —
    // the legacy bare listGigs() (used only by Tour Share/Export/Banner
    // Mosaic) must stay untouched until one of those is actually opened.
    expect(listGigs).not.toHaveBeenCalled()
  })

  it('uses the aggregate upcoming API and renders source-band identity in a personal workspace', async () => {
    listMyUpcomingGigs.mockResolvedValue(limitedCollection([{
      ...GIGS[0], tenantId: 9, tenantName: 'Other Band', tenantAvatarPath: null,
    }]))
    wrap(<GigsPage />, {
      auth: { user: { isSuperAdmin: true, activeTenantId: 1, activeTenantKind: 'personal' } },
    })
    await screen.findByText('Other Band')
    expect(listMyUpcomingGigs).toHaveBeenCalledWith(100, expect.any(String))
    expect(listUpcomingGigs).not.toHaveBeenCalled()
  })

  it('hides band sharing actions in a personal workspace', async () => {
    listMyUpcomingGigs.mockResolvedValue(limitedCollection([GIGS[0]]))
    wrap(<GigsPage />, {
      auth: { user: { isSuperAdmin: true, activeTenantId: 1, activeTenantKind: 'personal' } },
    })

    await screen.findByText('Jazz Night')
    expect(screen.queryByRole('button', { name: /share tour dates/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create tour card/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /banner mosaic/i })).not.toBeInTheDocument()
    expect(listGigs).not.toHaveBeenCalled()
  })

  it('hides Bandsintown actions when Bandsintown is not configured', async () => {
    const user = userEvent.setup()
    wrap(<GigsPage />, { integrationsConfigured: false })
    await screen.findByText('Jazz Night')

    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^export$/i }))
    expect(screen.queryByRole('button', { name: /bandsintown/i })).not.toBeInTheDocument()
  })

  it('lazily fetches the full gig list the first time Export or Share is opened', async () => {
    const user = userEvent.setup()
    wrap(<GigsPage />)
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
    expect(listGigs).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /share tour dates/i }))
    await waitFor(() => expect(listGigs).toHaveBeenCalledTimes(1))

    // Re-opening the same (or the Export) menu must not re-fetch.
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /^export$/i }))
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument())
    expect(listGigs).toHaveBeenCalledTimes(1)
  })

  it('uses the selected type and tag filters for tour cards and banner mosaics', async () => {
    const user = userEvent.setup()
    const filterGigs = [
      { ...GIGS[0], id: 42, event_description: 'Matching Gig', tags: [{ id: 1, name: 'Summer Tour' }] },
      { ...GIGS[0], id: 43, status: 'announced', event_description: 'Wrong Type', tags: [{ id: 1, name: 'Summer Tour' }] },
      { ...GIGS[0], id: 44, event_description: 'Wrong Tag', tags: [{ id: 2, name: 'Club Shows' }] },
      { ...GIGS[0], id: 45, status: 'option', event_description: 'Matching Option', tags: [{ id: 1, name: 'Summer Tour' }] },
    ]
    listGigs.mockResolvedValue(filterGigs)
    listUpcomingGigs.mockResolvedValue(limitedCollection(filterGigs))
    wrap(<GigsPage />)

    await waitFor(() => expect(screen.getByText('Matching Gig')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Types' }))
    await user.click(screen.getByText('Announced'))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Tags' }))
    // Rows render their own tag chips, so the filter option is only unambiguous
    // inside the open menu.
    await user.click(within(await screen.findByRole('menu')).getByText('Summer Tour'))
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: /share tour dates/i }))
    await waitFor(() => expect(listGigs).toHaveBeenCalled())
    const shareMenu = screen.getByRole('menu')
    expect(within(shareMenu).queryByText('Confirmed')).not.toBeInTheDocument()
    expect(within(shareMenu).queryByText('Announced')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /create tour card/i }))
    expect(screen.getByTestId('tour-share-gigs')).toHaveTextContent('Matching Gig')
    expect(screen.getByTestId('tour-share-gigs')).toHaveTextContent('Matching Option')
    expect(screen.getByTestId('tour-share-gigs')).not.toHaveTextContent('Wrong Type')
    expect(screen.getByTestId('tour-share-gigs')).not.toHaveTextContent('Wrong Tag')

    await user.click(screen.getByRole('button', { name: /share tour dates/i }))
    await user.click(screen.getByRole('button', { name: /banner mosaic/i }))
    expect(screen.getByTestId('mosaic-share-gigs')).toHaveTextContent('Matching Gig')
    expect(screen.getByTestId('mosaic-share-gigs')).toHaveTextContent('Matching Option')
    expect(screen.getByTestId('mosaic-share-gigs')).not.toHaveTextContent('Wrong Type')
    expect(screen.getByTestId('mosaic-share-gigs')).not.toHaveTextContent('Wrong Tag')
  })
})

describe('GigsPage — split-view detail route', () => {
  const GIG_DETAIL = {
    ...GIGS[0],
    booking_fee_cents: null,
    notes: '',
    tasks: [],
    participants: [],
  }

  beforeEach(() => {
    listGigs.mockClear()
    listGigs.mockResolvedValue(GIGS)
    listUpcomingGigs.mockReset()
    listUpcomingGigs.mockResolvedValue(limitedCollection(GIGS))
    listPastGigs.mockReset()
    listPastGigs.mockResolvedValue(pastCollection([]))
    searchGigs.mockReset()
    searchGigs.mockResolvedValue([])
    getGig.mockClear()
    getGig.mockResolvedValue(GIG_DETAIL)
    addGigParticipant.mockClear()
    removeGigParticipant.mockClear()
    listMembers.mockReset()
    listMembers.mockResolvedValue([])
    evaluateEventAvailability.mockReset()
    evaluateEventAvailability.mockResolvedValue({ bandWide: null, members: [] })
    deleteGig.mockClear()
  })

  it('updates the selected list row after adding a participant in the detail pane', async () => {
    const user = userEvent.setup()
    const alice = {
      member_id: 7,
      name: 'Alice',
      position: 'lead',
      color: '#e53935',
      status: 'available',
      reason: null,
    }
    getGig
      .mockResolvedValueOnce(GIG_DETAIL)
      .mockResolvedValueOnce({
        ...GIG_DETAIL,
        participants: [{ band_member_id: 7, name: 'Alice', position: 'lead', color: '#e53935' }],
      })
    listMembers.mockResolvedValueOnce([{ id: 7, name: 'Alice', position: 'lead', color: '#e53935' }])
    evaluateEventAvailability.mockImplementation(async ({ participant_ids }) => ({
      bandWide: null,
      members: participant_ids?.includes(7) ? [alice] : [],
    }))

    wrapWithRoutes({ initialEntries: ['/gigs/42?tab=participants'] })

    const participantPicker = await screen.findByRole('combobox', { name: /add participant/i })
    await user.click(participantPicker)
    await user.click(screen.getByRole('option', { name: /Alice/ }))

    await waitFor(() => expect(addGigParticipant).toHaveBeenCalledWith(42, 7))
    expect(await screen.findByText('A')).toBeInTheDocument()
  })

  it('updates the selected list row after removing a participant in the detail pane', async () => {
    const user = userEvent.setup()
    const alice = {
      member_id: 7,
      name: 'Alice',
      position: 'lead',
      color: '#e53935',
      status: 'available',
      reason: null,
    }
    listUpcomingGigs.mockResolvedValue(limitedCollection([{
      ...GIGS[0],
      members_availability: [alice],
    }]))
    getGig
      .mockResolvedValueOnce({
        ...GIG_DETAIL,
        participants: [{ band_member_id: 7, name: 'Alice', position: 'lead', color: '#e53935' }],
      })
      .mockResolvedValueOnce(GIG_DETAIL)
    evaluateEventAvailability.mockImplementation(async ({ participant_ids }) => ({
      bandWide: null,
      members: participant_ids?.includes(7) ? [alice] : [],
    }))

    wrapWithRoutes({ initialEntries: ['/gigs/42?tab=participants'] })
    expect(await screen.findByText('A')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /remove Alice/i }))

    await waitFor(() => expect(removeGigParticipant).toHaveBeenCalledWith(42, 7))
    await waitFor(() => expect(screen.queryByText('A')).not.toBeInTheDocument())
  })

  it('renders detail alongside the list at /gigs/:id and the Close button returns to /gigs', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/gigs/42'] })

    await waitFor(() => expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument())
    // list stays visible to the left in split view
    expect(screen.getByRole('heading', { name: /^gigs$/i })).toBeInTheDocument()
    // in split-view mode the top-left back arrow is hidden
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^close$/i }))

    // Close flushes (async) then navigates back to /gigs, unmounting the detail.
    await waitFor(
      () => expect(screen.queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument()
    )
    expect(screen.getByRole('heading', { name: /^gigs$/i })).toBeInTheDocument()
  })

  it('removes a gig from the still-mounted list after deleting it in detail', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/gigs/42'] })

    await waitFor(() => expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteGig).toHaveBeenCalledWith(42))
    // The detail pane closes on delete (navigating back to /gigs unmounts it) and
    // the still-mounted list drops the deleted gig. Both the detail title and the
    // list row carry 'Jazz Night', so wait until every instance is gone.
    await waitFor(() => expect(screen.queryByText('Jazz Night')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument()
    expect(screen.getByText(/no upcoming gigs/i)).toBeInTheDocument()
  })

  it('returns to the list after deleting in compact (mobile) view', async () => {
    const user = userEvent.setup()
    // Force compact layout: useMediaQuery(up('sm')) → false.
    const originalMatchMedia = window.matchMedia
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
    })
    try {
      wrapWithRoutes({ initialEntries: ['/gigs/42'] })

      // Compact: detail is full-screen with a back arrow, no split-view close button.
      await waitFor(() => expect(screen.getByRole('button', { name: /^back$/i })).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^delete$/i }))
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

      await waitFor(() => expect(deleteGig).toHaveBeenCalledWith(42))
      // Back to the list: detail unmounts (its back arrow disappears) and the list,
      // hidden behind the detail in compact view, becomes visible again.
      await waitFor(() => expect(screen.getByRole('heading', { name: /^gigs$/i })).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('resolves the Past tab from the detail pane\'s own getGig() fetch, without a second fetch of the same gig', async () => {
    const pastGig = { ...GIGS[0], id: 99, event_date: '2020-01-01T00:00:00.000Z', event_description: 'Old Show' }
    listPastGigs.mockResolvedValue(pastCollection([pastGig]))
    getGig.mockResolvedValue({ ...GIG_DETAIL, id: 99, event_date: pastGig.event_date, event_description: 'Old Show' })

    wrapWithRoutes({ initialEntries: ['/gigs/99'] })

    await waitFor(() => expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument())
    await waitFor(() => expect(listPastGigs).toHaveBeenCalled())
    expect(screen.getByRole('tab', { name: 'Past', selected: true })).toBeInTheDocument()
    // The list page must not make its own redundant getGig(99) call — the
    // one GigDetailContent already made (to render the pane) is reused via
    // the outlet context's onGigDetailLoaded callback.
    expect(getGig).toHaveBeenCalledTimes(1)
    expect(getGig).toHaveBeenCalledWith(99, expect.anything())
    // And the full unscoped list stays untouched — nothing here opened
    // Export/Share.
    expect(listGigs).not.toHaveBeenCalled()
    // The initial-tab fetch is deferred until the deep link's date is known,
    // so a past-gig deep link never fires the throwaway default /upcoming
    // request (see deferInitialTabLoadRef in GigsPage.tsx).
    expect(listUpcomingGigs).not.toHaveBeenCalled()
  })
})
