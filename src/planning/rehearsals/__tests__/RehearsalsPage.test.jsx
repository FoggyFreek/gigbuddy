import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../rehearsals.ts', () => ({
  listRehearsals: vi.fn().mockResolvedValue([
    {
      id: 1,
      proposed_date: '2099-05-10',
      start_time: '19:00:00',
      end_time: '22:00:00',
      location: 'Studio A',
      status: 'option',
      participants: [],
    },
  ]),
  listUpcomingRehearsals: vi.fn().mockResolvedValue({
    items: [{
      id: 1,
      proposed_date: '2099-05-10',
      start_time: '19:00:00',
      end_time: '22:00:00',
      location: 'Studio A',
      status: 'option',
      participants: [],
    }],
    meta: { limit: 100, returned: 1 },
  }),
  listPastRehearsals: vi.fn().mockResolvedValue({
    items: [],
    meta: { limit: 100, returned: 0, nextCursor: null },
  }),
  getRehearsal: vi.fn().mockResolvedValue({
    id: 1,
    proposed_date: '2099-05-10',
    start_time: '19:00:00',
    end_time: '22:00:00',
    location: 'Studio A',
    notes: '',
    status: 'option',
    participants: [],
  }),
  createRehearsal: vi.fn(),
  updateRehearsal: vi.fn(),
  deleteRehearsal: vi.fn().mockResolvedValue({}),
  addParticipant: vi.fn(),
  removeParticipant: vi.fn(),
  setVote: vi.fn(),
}))
vi.mock('../../../people/memberships/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../availability/me.ts', () => ({
  listMyUpcomingRehearsals: vi.fn().mockResolvedValue({ items: [], meta: { limit: 100, returned: 0 } }),
  listMyPastRehearsals: vi.fn().mockResolvedValue({ items: [], meta: { limit: 100, returned: 0, nextCursor: null } }),
  getMyRehearsal: vi.fn(),
  setMyRehearsalVote: vi.fn().mockResolvedValue({}),
}))

import RehearsalsPage from '../RehearsalsPage.tsx'
import RehearsalDetailPage from '../RehearsalDetailPage.tsx'
import { deleteRehearsal, getRehearsal, listPastRehearsals, listRehearsals, listUpcomingRehearsals, setVote, updateRehearsal } from '../rehearsals.ts'
import { getMyRehearsal, setMyRehearsalVote } from '../../availability/me.ts'
import theme from '../../../theme.ts'
import { AuthContext } from '../../../contexts/authContext.ts'

// Render as a writer (super admin grants every planning.write capability) so the
// create/edit/delete affordances gated on canWritePlanning are present.
const writerAuth = { user: { isSuperAdmin: true } }

function wrap(ui, { initialEntries = ['/'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}><DialogProvider>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={writerAuth}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
        </AuthContext.Provider>
      </ThemeProvider>
    </DialogProvider></MemoryRouter>
  )
}

function wrapWithRoutes({ initialEntries }) {
  return render(
    <MemoryRouter initialEntries={initialEntries}><DialogProvider>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={writerAuth}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <Routes>
              <Route path="/rehearsals" element={<RehearsalsPage />}>
                <Route path=":id" element={<RehearsalDetailPage />} />
              </Route>
            </Routes>
          </LocalizationProvider>
        </AuthContext.Provider>
      </ThemeProvider>
    </DialogProvider></MemoryRouter>
  )
}

describe('RehearsalsPage', () => {
  beforeEach(() => {
    listRehearsals.mockClear()
    listUpcomingRehearsals.mockClear()
    listPastRehearsals.mockClear()
    deleteRehearsal.mockClear()
  })

  it('renders header and Add button', async () => {
    wrap(<RehearsalsPage />)
    expect(screen.getByRole('heading', { name: /rehearsals/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add$/i })).toBeInTheDocument()
    await waitFor(() => expect(listUpcomingRehearsals).toHaveBeenCalled())
    expect(listRehearsals).not.toHaveBeenCalled()
  })

  it('loads past rehearsals only after selecting the Past tab', async () => {
    const user = userEvent.setup()
    listPastRehearsals.mockResolvedValueOnce({
      items: [{ id: 9, proposed_date: '2020-05-10', location: 'Old Studio', status: 'planned', participants: [] }],
      meta: { limit: 100, returned: 1, nextCursor: null },
    })
    wrap(<RehearsalsPage />)

    await waitFor(() => expect(screen.getByText('Studio A')).toBeInTheDocument())
    expect(listPastRehearsals).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'Past' }))

    await waitFor(() => expect(screen.getByText('Old Studio')).toBeInTheDocument())
    expect(listPastRehearsals).toHaveBeenCalledWith(100, expect.any(String))
  })

  it('shows a status filter immediately before Add and filters rehearsals by status', async () => {
    const user = userEvent.setup()
    listUpcomingRehearsals.mockResolvedValueOnce({ items: [
      {
        id: 1,
        proposed_date: '2099-05-10',
        location: 'Studio A',
        status: 'option',
        participants: [],
      },
      {
        id: 2,
        proposed_date: '2099-06-10',
        location: 'Studio Planned',
        status: 'planned',
        participants: [],
      },
    ], meta: { limit: 100, returned: 2 } })
    wrap(<RehearsalsPage />)

    await waitFor(() => expect(screen.getByText('Studio Planned')).toBeInTheDocument())
    const filterButton = screen.getByRole('button', { name: /filter rehearsals/i })
    const addButton = screen.getByRole('button', { name: /^add$/i })
    expect(filterButton.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(filterButton)
    await user.click(screen.getByRole('menuitem', { name: /planned/i }))

    expect(screen.getByText('Studio A')).toBeInTheDocument()
    expect(screen.queryByText('Studio Planned')).not.toBeInTheDocument()
  })

  it('shows loaded rehearsals in the table', async () => {
    wrap(<RehearsalsPage />)
    await waitFor(() => expect(screen.getByText('Studio A')).toBeInTheDocument())
  })

  it('opens create modal when Add clicked', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalsPage />)
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByText('Propose rehearsal', { selector: 'h2' })).toBeInTheDocument()
  })

  it('updates the list row when a field is saved in the detail', async () => {
    const user = userEvent.setup()
    updateRehearsal.mockResolvedValue({})
    wrapWithRoutes({ initialEntries: ['/rehearsals/1'] })

    // Wait for detail to load — Location field shows the current value
    await waitFor(() => expect(screen.getByDisplayValue('Studio A')).toBeInTheDocument())

    // Clear the location and type a new value
    await user.clear(screen.getByLabelText('Location'))
    await user.type(screen.getByLabelText('Location'), 'New Place')

    // After debounce fires and save completes, the list should show the new location
    await waitFor(
      () => expect(screen.getByText('New Place')).toBeInTheDocument(),
      { timeout: 2000 }
    )
    expect(updateRehearsal).toHaveBeenCalledWith(1, expect.objectContaining({ location: 'New Place' }))
    // list was updated in-place, not via a full reload
    expect(listUpcomingRehearsals).toHaveBeenCalledTimes(1)
  })

  it('renders detail alongside the list at /rehearsals/:id and the Close button returns to /rehearsals', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/rehearsals/1'] })

    await waitFor(() => expect(screen.getByText('Rehearsal details')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /rehearsals/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^close$/i }))

    await waitFor(() => expect(screen.queryByText('Rehearsal details')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /rehearsals/i })).toBeInTheDocument()
  })

  it('removes a rehearsal from the still-mounted list after deleting it in detail', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/rehearsals/1'] })

    await waitFor(() => expect(screen.getByText('Rehearsal details')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteRehearsal).toHaveBeenCalledWith(1))
    expect(screen.queryByText('Studio A')).not.toBeInTheDocument()
    expect(screen.getByText(/no upcoming rehearsals/i)).toBeInTheDocument()
  })
})

// The rehearsal's own copy of the read-only-for-foreign-rows rule
// (useCrossTenantRow): a row the artist workspace doesn't own is labelled with
// its band, and that label alone decides.
describe('RehearsalDetailPage — cross-band rehearsal in a personal workspace', () => {
  const ARTIST_USER = {
    id: 9,
    activeTenantId: 1,
    activeTenantKind: 'personal',
    activeTenantRole: 'tenant_admin',
    permissions: ['app.view', 'planning.write'],
    bandMemberId: 3,
  }

  const CROSS_BAND_REHEARSAL = {
    id: 1,
    proposed_date: '2099-05-10',
    start_time: '19:00:00',
    end_time: '22:00:00',
    location: 'Studio A',
    notes: '',
    status: 'option',
    participants: [{ band_member_id: 22, name: 'Ann', position: 'drums', vote: null }],
    viewerBandMemberId: 22,
    tenantId: 9,
    tenantName: 'Other Band',
    tenantAvatarPath: null,
  }

  function renderAsArtist(rehearsal) {
    const switchTenant = vi.fn().mockResolvedValue(undefined)
    getMyRehearsal.mockResolvedValue(rehearsal)
    render(
      <MemoryRouter initialEntries={['/rehearsals/1']}><DialogProvider>
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
                <Route path="/rehearsals/:id" element={<RehearsalDetailPage />} />
              </Routes>
            </LocalizationProvider>
          </AuthContext.Provider>
        </ThemeProvider>
      </DialogProvider></MemoryRouter>
    )
    return switchTenant
  }

  beforeEach(() => {
    getRehearsal.mockClear()
    getMyRehearsal.mockReset()
    setVote.mockClear()
    setMyRehearsalVote.mockClear()
  })

  it('names the source band and offers no editing', async () => {
    const user = userEvent.setup()
    const switchTenant = renderAsArtist(CROSS_BAND_REHEARSAL)

    await screen.findByTestId('source-tenant-switch')
    expect(screen.getByText('Other Band')).toBeInTheDocument()
    expect(screen.getByLabelText('Location')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
    expect(getRehearsal).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Switch to band' }))
    expect(switchTenant).toHaveBeenCalledWith(9)
  })

  // The one write left: /api/rehearsals is out of reach for a band the viewer
  // isn't in, so the vote goes through the hub.
  it("routes the viewer's own vote through the cross-tenant hub", async () => {
    const user = userEvent.setup()
    renderAsArtist(CROSS_BAND_REHEARSAL)
    await screen.findByTestId('source-tenant-switch')

    await user.click(screen.getByRole('button', { name: 'Yes' }))

    await waitFor(() => expect(setMyRehearsalVote).toHaveBeenCalledWith(1, 'yes'))
    expect(setVote).not.toHaveBeenCalled()
  })

  it("keeps the full editor for the workspace's own rehearsal", async () => {
    const user = userEvent.setup()
    renderAsArtist({ ...CROSS_BAND_REHEARSAL, tenantId: 1, tenantName: 'Solo' })
    await waitFor(() => expect(screen.getByDisplayValue('Studio A')).toBeInTheDocument())

    expect(screen.queryByTestId('source-tenant-switch')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Location')).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Yes' }))

    await waitFor(() => expect(setVote).toHaveBeenCalledWith(1, 22, 'yes'))
    expect(setMyRehearsalVote).not.toHaveBeenCalled()
  })
})
