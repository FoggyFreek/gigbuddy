import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.js', () => ({
  listGigs: vi.fn(),
  getGig: vi.fn(),
  createGig: vi.fn(),
  updateGig: vi.fn(),
  deleteGig: vi.fn().mockResolvedValue({}),
  listGigContacts: vi.fn().mockResolvedValue([]),
  addGigContact: vi.fn().mockResolvedValue({}),
  setGigContactPrimary: vi.fn().mockResolvedValue({}),
  removeGigContact: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../api/venues.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/availability.js', () => ({
  getAvailabilityOn: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))
vi.mock('../api/bandMembers.js', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))

import GigsPage from '../pages/GigsPage.jsx'
import GigDetailPage from '../pages/GigDetailPage.jsx'
import { deleteGig, getGig, listGigs } from '../api/gigs.js'
import theme from '../theme.js'

function wrap(ui, { initialEntries = ['/'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

function wrapWithRoutes({ initialEntries }) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Routes>
            <Route path="/gigs" element={<GigsPage />}>
              <Route path=":id" element={<GigDetailPage />} />
            </Route>
          </Routes>
        </LocalizationProvider>
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
    expect(screen.getByRole('button', { name: /add gig/i })).toBeInTheDocument()
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

    await waitFor(() => expect(screen.getByText('Gig details')).toBeInTheDocument())
    // list stays visible to the left in split view
    expect(screen.getByRole('heading', { name: /^gigs$/i })).toBeInTheDocument()
    // in split-view mode the top-left back arrow is hidden
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^close$/i }))

    await waitFor(() => expect(screen.queryByText('Gig details')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /^gigs$/i })).toBeInTheDocument()
  })

  it('removes a gig from the still-mounted list after deleting it in detail', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/gigs/42'] })

    await waitFor(() => expect(screen.getByText('Gig details')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteGig).toHaveBeenCalledWith(42))
    expect(screen.queryByText('Jazz Night')).not.toBeInTheDocument()
    expect(screen.getByText(/no gigs yet/i)).toBeInTheDocument()
  })
})
