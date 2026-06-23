import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.ts', () => ({
  listGigs: vi.fn(),
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

import GigsPage from '../pages/GigsPage.tsx'
import GigDetailPage from '../pages/GigDetailPage.tsx'
import { deleteGig, getGig, listGigs } from '../api/gigs.ts'
import theme from '../theme.ts'
import { AuthContext } from '../contexts/authContext.ts'

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
  })

  it('renders header, Add button, and loaded gigs', async () => {
    wrap(<GigsPage />)
    expect(screen.getByRole('heading', { name: /^gigs$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add$/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
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

    await waitFor(() => expect(screen.queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument())
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
    expect(screen.getByText(/no gigs yet/i)).toBeInTheDocument()
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
})
