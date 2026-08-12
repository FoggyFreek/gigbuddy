import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArtistCalendarSection from '../components/ArtistCalendarSection.tsx'
import { AuthContext } from '../../../contexts/authContext.ts'
import theme from '../../../theme.ts'
import { listMyAgenda } from '../me.ts'
import { createBandEvent } from '../../events/bandEvents.ts'
import { createGig } from '../../gigs/gigs.ts'
import { getAvailabilitySpan } from '../availability.ts'
import {
  createMyAvailability,
  deleteMyAvailability,
  listMyAvailability,
  updateMyAvailability,
} from '../../../user/availability/userAvailability.ts'

vi.mock('../me.ts', () => ({ listMyAgenda: vi.fn() }))
vi.mock('../../../user/availability/userAvailability.ts', () => ({
  createMyAvailability: vi.fn(),
  deleteMyAvailability: vi.fn(),
  listMyAvailability: vi.fn(),
  updateMyAvailability: vi.fn(),
}))
vi.mock('../../events/bandEvents.ts', () => ({
  createBandEvent: vi.fn(),
  getBandEvent: vi.fn(),
  updateBandEvent: vi.fn(),
}))
vi.mock('../availability.ts', () => ({
  evaluateEventAvailability: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  getAvailabilitySpan: vi.fn(),
  getAvailabilityOn: vi.fn(),
}))
vi.mock('../../gigs/gigs.ts', () => ({ createGig: vi.fn() }))
vi.mock('../../../people/venues/venues.ts', () => ({
  searchVenues: vi.fn().mockResolvedValue([]),
  createVenue: vi.fn(),
  updateVenue: vi.fn(),
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))

const USER = { id: 1, activeTenantId: 7, activeTenantKind: 'personal' }
let switchTenant

function wrap() {
  switchTenant = vi.fn().mockResolvedValue({})
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <MemoryRouter initialEntries={['/availability']}>
          <AuthContext.Provider value={{
            user: USER,
            setUser: vi.fn(),
            logout: vi.fn(),
            switchTenant,
            refreshUser: vi.fn(),
          }}>
            <Routes>
              <Route path="/availability" element={<ArtistCalendarSection />} />
              <Route path="/availability/events/:id" element={<div>other event detail</div>} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      </LocalizationProvider>
    </ThemeProvider>,
  )
}

const agendaItem = (over = {}) => ({
  type: 'band_event',
  id: 42,
  date: '2026-08-12',
  endDate: '2026-08-12',
  startTime: null,
  endTime: null,
  title: 'Photo shoot',
  description: 'Photo shoot — Other Band',
  location: 'Studio',
  status: null,
  tenantId: 2,
  tenantName: 'Other Band',
  kind: 'band',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  listMyAgenda.mockResolvedValue({ items: [agendaItem()], meta: { from: '', to: '', returned: 1 } })
  listMyAvailability.mockResolvedValue({
    items: [{
      id: 9,
      start_date: '2026-08-14',
      end_date: '2026-08-14',
      status: 'unavailable',
      reason: 'Holiday',
      created_by_user_id: 1,
      created_in_tenant_id: null,
    }],
    meta: { from: '', to: '', returned: 1 },
  })
  createMyAvailability.mockResolvedValue({})
  updateMyAvailability.mockResolvedValue({})
  deleteMyAvailability.mockResolvedValue(undefined)
  createBandEvent.mockResolvedValue({ id: 77 })
  createGig.mockResolvedValue({ id: 88 })
  // A personal workspace has no band availability; the endpoint would 403 there.
  getAvailabilitySpan.mockRejectedValue(new Error('forbidden'))
})

describe('ArtistCalendarSection', () => {
  it('renders required bookings with the band name and opens them inside the artist workspace', async () => {
    const user = userEvent.setup()
    listMyAgenda.mockResolvedValue({
      items: [
        agendaItem(),
        agendaItem({
          type: 'rehearsal',
          id: 43,
          date: '2026-08-13',
          title: 'Rehearsal',
          description: 'Rehearsal — Other Band',
        }),
      ],
      meta: { from: '', to: '', returned: 2 },
    })
    wrap()

    await screen.findByText('Photo shoot — Other Band')
    expect(screen.getByText('Rehearsal — Other Band')).toBeInTheDocument()
    await user.click(screen.getByText('Photo shoot — Other Band'))

    expect(switchTenant).not.toHaveBeenCalled()
    expect(await screen.findByText('other event detail')).toBeInTheDocument()
  })

  it('edits and removes the artist\'s own availability from the calendar', async () => {
    const user = userEvent.setup()
    const { container } = wrap()
    await waitFor(() => expect(container.querySelector('[data-slot-id="9"]')).not.toBeNull())
    const slot = container.querySelector('[data-slot-id="9"]')
    await user.click(slot)

    expect(screen.getByRole('heading', { name: 'Edit slot' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteMyAvailability).toHaveBeenCalledWith(9))
  })

  it('labels the artist\'s own slots "Me" rather than the band-wide fallback', async () => {
    const { container } = wrap()
    await waitFor(() => expect(container.querySelector('[data-slot-id="9"]')).not.toBeNull())

    const slot = container.querySelector('[data-slot-id="9"]')
    expect(slot.textContent).toBe('Me')
  })

  it('creates user-owned availability without a band member id', async () => {
    const user = userEvent.setup()
    const { container } = wrap()
    await waitFor(() => expect(listMyAgenda).toHaveBeenCalled())

    await user.click(container.querySelector('[data-date="2026-08-20"]'))
    await user.click(await screen.findByText('Availability'))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createMyAvailability).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-08-20',
      end_date: '2026-08-20',
      status: 'unavailable',
    })))
    expect(createMyAvailability.mock.calls[0][0]).not.toHaveProperty('band_member_id')
  })

  it('creates a personal event on the clicked day and reloads the month', async () => {
    const user = userEvent.setup()
    const { container } = wrap()
    await waitFor(() => expect(listMyAgenda).toHaveBeenCalled())

    await user.click(container.querySelector('[data-date="2026-08-20"]'))
    await user.click(await screen.findByText('Personal event'))

    await user.type(screen.getByLabelText(/title/i), 'Studio day')
    await user.click(screen.getByRole('button', { name: /add event/i }))

    await waitFor(() => expect(createBandEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Studio day',
      start_date: '2026-08-20',
      end_date: '2026-08-20',
    })))
    // The dialog closes onto a fresh agenda read, so the new event lands in the grid.
    await waitFor(() => expect(listMyAgenda).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: /add event/i })).not.toBeInTheDocument()
  })

  it('creates a gig on the clicked day and reloads the month', async () => {
    const user = userEvent.setup()
    const { container } = wrap()
    await waitFor(() => expect(listMyAgenda).toHaveBeenCalled())

    await user.click(container.querySelector('[data-date="2026-08-20"]'))
    await user.click(await screen.findByText('Gig'))

    await user.type(screen.getByLabelText(/event description/i), 'Solo set')
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(createGig).toHaveBeenCalledWith(expect.objectContaining({
      event_date: '2026-08-20',
      event_description: 'Solo set',
    })))
    await waitFor(() => expect(listMyAgenda).toHaveBeenCalledTimes(2))
  })
})
