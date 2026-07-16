import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
  listGigContacts: vi.fn().mockResolvedValue([]),
  addGigContact: vi.fn().mockResolvedValue({}),
  setGigContactPrimary: vi.fn().mockResolvedValue({}),
  removeGigContact: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../api/venues.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/availability.ts', () => ({
  getAvailabilityOn: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
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
import { deleteGig, getGig, listGigs, listPastGigs, listUpcomingGigs, searchGigs } from '../api/gigs.ts'
import theme from '../theme.ts'
import { AuthContext } from '../contexts/authContext.ts'

const limitedCollection = (items, total = items.length) => ({ items, meta: { limit: 100, returned: items.length, total } })
const pastCollection = (items) => ({ items, meta: { limit: 100, returned: items.length, nextCursor: null } })

// Render as a writer (super admin grants every planning.write capability) so the
// create/edit/delete affordances gated on canWritePlanning are present.
const writerAuth = { user: { isSuperAdmin: true } }

function wrap(ui, { initialEntries = ['/'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={writerAuth}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
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
    await user.click(screen.getByText('Summer Tour'))
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
    has_pa_system: false,
    has_drumkit: false,
    has_stage_lights: false,
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
    deleteGig.mockClear()
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
    // Give the default 1s waitFor more headroom so full-suite load can't make it flake.
    await waitFor(
      () => expect(screen.queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument(),
      { timeout: 2000 }
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
