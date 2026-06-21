import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GigDetailPage from '../pages/GigDetailPage.tsx'
import theme from '../theme.ts'

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
}))

function gigFixture(id) {
  return {
    id,
    event_date: '2026-06-15',
    event_description: `Gig ${id}`,
    venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam' },
    event_link: '',
    start_time: '20:00:00',
    end_time: '23:00:00',
    status: 'option',
    booking_fee_cents: 15000,
    admission: 'free',
    ticket_link: null,
    notes: '',
    has_pa_system: false,
    has_drumkit: false,
    has_stage_lights: false,
    tasks: [],
    attachments: [],
    participants: [],
  }
}

vi.mock('../api/gigs.ts', () => ({
  getGig: vi.fn(),
  updateGig: vi.fn().mockResolvedValue({}),
  deleteGig: vi.fn().mockResolvedValue({}),
  addGigParticipant: vi.fn().mockResolvedValue({}),
  removeGigParticipant: vi.fn().mockResolvedValue({}),
  setGigVote: vi.fn().mockResolvedValue({}),
  uploadGigBanner: vi.fn().mockResolvedValue({ banner_path: 'test/banner.jpg' }),
  deleteGigBanner: vi.fn().mockResolvedValue({}),
  listGigContacts: vi.fn().mockResolvedValue([]),
  addGigContact: vi.fn().mockResolvedValue({}),
  setGigContactPrimary: vi.fn().mockResolvedValue({}),
  removeGigContact: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../api/venues.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))

import { getGig } from '../api/gigs.ts'

// Navigates within the same router so GigDetailPage stays mounted across the id change —
// the split-view scenario the stale-gig guard protects against.
function NavTo({ to, children }) {
  const navigate = useNavigate()
  return <button onClick={() => navigate(to)}>{children}</button>
}

function renderPage(id) {
  return render(
    <MemoryRouter initialEntries={[`/gigs/${id}`]}>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <NavTo to="/gigs/2">go to gig 2</NavTo>
          <Routes>
            <Route path="/gigs/:id" element={<GigDetailPage />} />
          </Routes>
        </LocalizationProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

// The detail header is the row that holds the back button and title (the event name
// once the gig loads); scope share-button queries to it so the assertion can't be
// satisfied by a share button elsewhere.
function header() {
  return screen.getByLabelText('back').closest('div')
}

describe('GigDetailPage — header share button', () => {
  beforeEach(() => {
    getGig.mockReset()
    getGig.mockResolvedValue(gigFixture(1))
  })

  it('shows the share button in the header once the gig loads', async () => {
    renderPage(1)
    // Not present before the gig resolves.
    expect(within(header()).queryByLabelText('share gig')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(within(header()).getByLabelText('share gig')).toBeInTheDocument()
    )
  })

  it('hides the share button while a different id is loading, then shows it', async () => {
    const user = userEvent.setup()
    let resolveSecond
    renderPage(1)
    await waitFor(() =>
      expect(within(header()).getByLabelText('share gig')).toBeInTheDocument()
    )

    // Navigate to gig 2 whose fetch hasn't resolved yet — the page stays mounted, so the
    // stale gig 1 must not remain shareable in the header.
    getGig.mockReturnValueOnce(new Promise((res) => { resolveSecond = res }))
    await user.click(screen.getByText('go to gig 2'))
    await waitFor(() =>
      expect(within(header()).queryByLabelText('share gig')).not.toBeInTheDocument()
    )

    resolveSecond(gigFixture(2))
    await waitFor(() =>
      expect(within(header()).getByLabelText('share gig')).toBeInTheDocument()
    )
  })
})
