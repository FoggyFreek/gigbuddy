import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../bandEvents.ts', () => ({
  listBandEvents: vi.fn(),
  listUpcomingBandEvents: vi.fn(),
  listPastBandEvents: vi.fn(),
  getBandEvent: vi.fn().mockResolvedValue({
    id: 1,
    title: 'Studio session',
    event_date: '2099-06-15',
    start_time: null,
    end_time: null,
    location: null,
    notes: '',
  }),
  createBandEvent: vi.fn().mockResolvedValue({ id: 99 }),
  updateBandEvent: vi.fn().mockResolvedValue({}),
  deleteBandEvent: vi.fn().mockResolvedValue({}),
  addBandEventParticipant: vi.fn().mockResolvedValue({}),
  removeBandEventParticipant: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../people/memberships/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../availability/me.ts', () => ({
  listMyUpcomingBandEvents: vi.fn().mockResolvedValue({ items: [], meta: { limit: 100, returned: 0 } }),
  listMyPastBandEvents: vi.fn().mockResolvedValue({ items: [], meta: { limit: 100, returned: 0, nextCursor: null } }),
  getMyBandEvent: vi.fn(),
}))

import BandEventsPage from '../BandEventsPage.tsx'
import BandEventDetailPage from '../BandEventDetailPage.tsx'
import { addBandEventParticipant, deleteBandEvent, listBandEvents, listPastBandEvents, listUpcomingBandEvents, getBandEvent, removeBandEventParticipant, updateBandEvent } from '../bandEvents.ts'
import { listMembers } from '../../../people/memberships/bandMembers.ts'
import { getMyBandEvent } from '../../availability/me.ts'
import theme from '../../../theme.ts'
import { AuthContext } from '../../../contexts/authContext.ts'

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
              <Route path="/events" element={<BandEventsPage />}>
                <Route path=":id" element={<BandEventDetailPage />} />
              </Route>
            </Routes>
          </LocalizationProvider>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

const EVENTS = [
  {
    id: 1,
    title: 'Studio session',
    event_date: '2099-06-15',
    start_time: '10:00:00',
    end_time: '14:00:00',
    location: 'Studio A',
  },
]

describe('BandEventsPage', () => {
  beforeEach(() => {
    listBandEvents.mockReset()
    listBandEvents.mockResolvedValue(EVENTS)
    listUpcomingBandEvents.mockReset()
    listUpcomingBandEvents.mockResolvedValue({ items: EVENTS, meta: { limit: 100, returned: EVENTS.length } })
    listPastBandEvents.mockReset()
    listPastBandEvents.mockResolvedValue({ items: [], meta: { limit: 100, returned: 0, nextCursor: null } })
    listMembers.mockReset()
    listMembers.mockResolvedValue([])
    addBandEventParticipant.mockReset()
    addBandEventParticipant.mockResolvedValue({})
    removeBandEventParticipant.mockClear()
    deleteBandEvent.mockClear()
  })

  it('renders header and Add button', async () => {
    wrap(<BandEventsPage />)
    expect(screen.getByRole('heading', { name: /band events/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add$/i })).toBeInTheDocument()
    await waitFor(() => expect(listUpcomingBandEvents).toHaveBeenCalled())
    expect(listBandEvents).not.toHaveBeenCalled()
  })

  it('loads past events only after selecting the Past tab', async () => {
    const user = userEvent.setup()
    listPastBandEvents.mockResolvedValueOnce({
      items: [{ id: 9, title: 'Old meeting', start_date: '2020-05-10', end_date: '2020-05-10' }],
      meta: { limit: 100, returned: 1, nextCursor: null },
    })
    wrap(<BandEventsPage />)

    await waitFor(() => expect(screen.getByText('Studio session')).toBeInTheDocument())
    expect(listPastBandEvents).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'Past' }))

    await waitFor(() => expect(screen.getByText('Old meeting')).toBeInTheDocument())
    expect(listPastBandEvents).toHaveBeenCalledWith(100, expect.any(String))
  })

  it('shows loaded events in the table', async () => {
    wrap(<BandEventsPage />)
    await waitFor(() => expect(screen.getByText('Studio session')).toBeInTheDocument())
  })

  it('opens the create modal when Add is clicked', async () => {
    const user = userEvent.setup()
    wrap(<BandEventsPage />)
    await waitFor(() => expect(listUpcomingBandEvents).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByText('Add band event', { selector: 'h2' })).toBeInTheDocument()
  })

  it('updates the list row when the detail title is saved', async () => {
    // Provide start_date (required field) so title changes pass validation and trigger a save
    getBandEvent.mockResolvedValueOnce({
      id: 1,
      title: 'Studio session',
      start_date: '2099-06-15',
      end_date: null,
      start_time: null,
      end_time: null,
      location: null,
      notes: '',
    })
    wrapWithRoutes({ initialEntries: ['/events/1'] })

    // Wait for detail to load
    const titleInput = await waitFor(() => screen.getByDisplayValue('Studio session'))

    // Use fireEvent.change to atomically set the new title (avoids clear→type
    // multi-step sequence that could race with required-field validation)
    fireEvent.change(titleInput, { target: { value: 'Rehearsal day' } })

    // After debounce fires and save completes, the list should reflect the new title
    await waitFor(
      () => expect(screen.getByText(/Rehearsal day/)).toBeInTheDocument(),
      { timeout: 2000 }
    )
    expect(updateBandEvent).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Rehearsal day' }))
    expect(listUpcomingBandEvents).toHaveBeenCalledTimes(1)
  })

  it('updates the selected list row after adding a participant in the detail pane', async () => {
    const user = userEvent.setup()
    const eventDetail = {
      id: 1,
      title: 'Studio session',
      start_date: '2099-06-15',
      end_date: '2099-06-15',
      start_time: null,
      end_time: null,
      location: null,
      notes: '',
      members_availability: [],
      availability_days: [],
    }
    const alice = {
      member_id: 7,
      name: 'Alice',
      position: 'lead',
      color: '#e53935',
      status: 'available',
      reason: null,
    }
    getBandEvent.mockResolvedValueOnce(eventDetail)
    listMembers.mockResolvedValueOnce([{ id: 7, name: 'Alice', position: 'lead', color: '#e53935' }])
    addBandEventParticipant.mockResolvedValueOnce({
      ...eventDetail,
      members_availability: [alice],
    })

    wrapWithRoutes({ initialEntries: ['/events/1'] })

    const participantSelect = await screen.findByRole('combobox', { name: /add band member/i })
    await user.click(participantSelect)
    await user.click(screen.getByRole('option', { name: /Alice/ }))
    await user.click(screen.getAllByRole('button', { name: /^add$/i }).at(-1))

    await waitFor(() => expect(addBandEventParticipant).toHaveBeenCalledWith(1, 7))
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
    const eventDetail = {
      id: 1,
      title: 'Studio session',
      start_date: '2099-06-15',
      end_date: '2099-06-15',
      start_time: null,
      end_time: null,
      location: null,
      notes: '',
      members_availability: [alice],
      availability_days: [],
    }
    listUpcomingBandEvents.mockResolvedValue({
      items: [{ ...EVENTS[0], members_availability: [alice] }],
      meta: { limit: 100, returned: 1 },
    })
    getBandEvent
      .mockResolvedValueOnce(eventDetail)
      .mockResolvedValueOnce({ ...eventDetail, members_availability: [] })

    wrapWithRoutes({ initialEntries: ['/events/1'] })
    expect(await screen.findByText('A')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /remove Alice/i }))

    await waitFor(() => expect(removeBandEventParticipant).toHaveBeenCalledWith(1, 7))
    await waitFor(() => expect(screen.queryByText('A')).not.toBeInTheDocument())
  })

  it('renders detail alongside the list at /events/:id and the Close button returns to /events', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/events/1'] })

    await waitFor(() => expect(screen.getByText('Band event details')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /band events/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^close$/i }))

    await waitFor(() => expect(screen.queryByText('Band event details')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /band events/i })).toBeInTheDocument()
  })

  it('removes an event from the still-mounted list after deleting it in detail', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/events/1'] })

    await waitFor(() => expect(screen.getByText('Band event details')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteBandEvent).toHaveBeenCalledWith(1))
    expect(screen.queryByText('Studio session')).not.toBeInTheDocument()
    expect(screen.getByText(/no upcoming events/i)).toBeInTheDocument()
  })
})

// The band event's own copy of the read-only-for-foreign-rows rule
// (useCrossTenantRow): a row the artist workspace doesn't own is labelled with
// its band, and that label alone decides.
describe('BandEventDetailPage — cross-band event in a personal workspace', () => {
  const ARTIST_USER = {
    id: 9,
    activeTenantId: 1,
    activeTenantKind: 'personal',
    activeTenantRole: 'tenant_admin',
    permissions: ['app.view', 'planning.write'],
    bandMemberId: 3,
  }

  const CROSS_BAND_EVENT = {
    id: 1,
    title: 'Studio session',
    start_date: '2099-06-15',
    end_date: '2099-06-15',
    start_time: null,
    end_time: null,
    location: 'Studio A',
    notes: '',
    tenantId: 9,
    tenantName: 'Other Band',
    tenantAvatarPath: null,
  }

  function renderAsArtist(event) {
    const switchTenant = vi.fn().mockResolvedValue(undefined)
    getMyBandEvent.mockResolvedValue(event)
    render(
      <MemoryRouter initialEntries={['/events/1']}>
        <ThemeProvider theme={theme}>
          <AuthContext.Provider
            value={{
              user: ARTIST_USER,
              setUser: () => {},
              logout: async () => {},
              switchTenant,
              refreshUser: async () => undefined,
            }}
          >
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <Routes>
                <Route path="/events/:id" element={<BandEventDetailPage />} />
              </Routes>
            </LocalizationProvider>
          </AuthContext.Provider>
        </ThemeProvider>
      </MemoryRouter>
    )
    return switchTenant
  }

  beforeEach(() => {
    getBandEvent.mockClear()
    getMyBandEvent.mockReset()
  })

  it('names the source band and offers no editing', async () => {
    const user = userEvent.setup()
    const switchTenant = renderAsArtist(CROSS_BAND_EVENT)

    await screen.findByTestId('source-tenant-switch')
    expect(screen.getByText('Other Band')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Studio session')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
    expect(getBandEvent).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Switch to band' }))
    expect(switchTenant).toHaveBeenCalledWith(9)
  })

  it("keeps the full editor for the workspace's own event", async () => {
    renderAsArtist({ ...CROSS_BAND_EVENT, tenantId: 1, tenantName: 'Solo' })
    await waitFor(() => expect(screen.getByDisplayValue('Studio session')).toBeInTheDocument())

    expect(screen.queryByTestId('source-tenant-switch')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Studio session')).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
  })
})
