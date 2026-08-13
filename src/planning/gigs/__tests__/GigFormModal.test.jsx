import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GigFormModal from '../components/GigFormModal.tsx'
import theme from '../../../theme.ts'

vi.mock('../../availability/availability.ts', () => ({
  getAvailabilityOn: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  evaluateEventAvailability: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))

vi.mock('../../../people/memberships/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock('../gigs.ts', () => ({
  createGig: vi.fn().mockResolvedValue({ id: 99 }),
  getGig: vi.fn().mockResolvedValue({
    id: 1,
    event_date: '2026-06-15',
    event_description: 'Jazz Night',
    venue: 'Bimhuis',
    city: 'Amsterdam',
    event_link: '',
    start_time: '20:00:00',
    end_time: '23:00:00',
    status: 'confirmed',
    booking_fee_cents: 15000,
    admission: 'free',
    ticket_link: null,
    notes: 'Bring own PA',
    tasks: [],
    attachments: [],
    participants: [],
  }),
  getGigMerchSummary: vi.fn().mockResolvedValue({ unitsSold: 0, netCents: 0, grossCents: 0 }),
  updateGig: vi.fn().mockResolvedValue({}),
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

vi.mock('../../../people/venues/venues.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../people/my-bands/myBands.ts', () => ({
  listMyBands: vi.fn().mockResolvedValue({ items: [] }),
}))

vi.mock('../../../finance/invoices/invoices.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  listInvoicesByGig: vi.fn().mockResolvedValue([]),
}))

import { createGig, getGig } from '../gigs.ts'
import { getAvailabilityOn } from '../../availability/availability.ts'
import { AuthContext } from '../../../contexts/authContext.ts'

// Editing a gig (auto-save fields) is gated on planning.write, so the modal
// needs an authenticated user with that permission in context.
const AUTH_VALUE = {
  user: { id: 1, permissions: ['app.view', 'planning.write', 'purchase.create'], activeTenantRole: 'contributor' },
  setUser: () => {},
  logout: async () => {},
  switchTenant: async () => undefined,
  refreshUser: async () => undefined,
}

function wrap(ui, tenantKind = 'band', extraPermissions = []) {
  const permissions = [...AUTH_VALUE.user.permissions, ...extraPermissions]
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ ...AUTH_VALUE, user: { ...AUTH_VALUE.user, activeTenantKind: tenantKind, permissions } }}>
        <ThemeProvider theme={theme}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
        </ThemeProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

describe('GigFormModal — create mode', () => {
  it('renders the new gig dialog title', () => {
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByText('New gig')).toBeInTheDocument()
  })

  it('uses the shared date entry field', () => {
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByLabelText(/^date$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'open date picker' })).toBeInTheDocument()
  })

  it('shows Cancel and Create buttons', () => {
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
  })

  it('shows validation errors when required fields are empty', async () => {
    const user = userEvent.setup()
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: /create/i }))
    const errors = screen.getAllByText('Required')
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it('calls createGig and onClose when form is valid', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<GigFormModal mode="create" onClose={onClose} />)

    await user.type(screen.getByLabelText(/event description/i), 'Rock Show')
    const dateInput = screen.getByLabelText(/^date$/i)
    await user.type(dateInput, '2026-08-01')

    await user.click(screen.getByRole('button', { name: /create/i }))
    await waitFor(() => expect(createGig).toHaveBeenCalled())
    expect(createGig).toHaveBeenCalledWith(
      expect.objectContaining({ event_description: 'Rock Show', event_date: '2026-08-01' })
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('sends the next date for a 22:00 to 02:00 gig', async () => {
    createGig.mockClear()
    const user = userEvent.setup()
    wrap(<GigFormModal mode="create" onClose={() => {}} />)

    await user.type(screen.getByLabelText(/event description/i), 'Late show')
    await user.type(screen.getByLabelText(/^date$/i), '2026-08-13')
    const [startHours, startMinutes] = within(screen.getByRole('group', { name: /start time/i }))
      .getAllByRole('spinbutton')
    await user.click(startHours)
    await user.keyboard('22')
    await user.click(startMinutes)
    await user.keyboard('00')
    const [endHours, endMinutes] = within(screen.getByRole('group', { name: /end time/i }))
      .getAllByRole('spinbutton')
    await user.click(endHours)
    await user.keyboard('02')
    await user.click(endMinutes)
    await user.keyboard('00')
    await user.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(createGig).toHaveBeenCalledWith(expect.objectContaining({
      event_date: '2026-08-13',
      end_date: '2026-08-14',
      start_time: '22:00',
      end_time: '02:00',
    })))
  })

  // Regression: my_band_id is personal-workspace-only. The server 403s if the
  // field is present at all outside one, so a band workspace must omit it —
  // sending it as null used to trip that gate on every gig creation.
  it('omits my_band_id when creating from a band workspace', async () => {
    createGig.mockClear()
    const user = userEvent.setup()
    wrap(<GigFormModal mode="create" onClose={() => {}} />, 'band')

    await user.type(screen.getByLabelText(/event description/i), 'Rock Show')
    await user.type(screen.getByLabelText(/^date$/i), '2026-08-01')
    await user.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(createGig).toHaveBeenCalled())
    expect(createGig.mock.calls[0][0]).not.toHaveProperty('my_band_id')
  })

  it('includes my_band_id when creating from a personal workspace', async () => {
    createGig.mockClear()
    const user = userEvent.setup()
    wrap(<GigFormModal mode="create" onClose={() => {}} />, 'personal')

    await user.type(screen.getByLabelText(/event description/i), 'Rock Show')
    await user.type(screen.getByLabelText(/^date$/i), '2026-08-01')
    await user.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(createGig).toHaveBeenCalled())
    expect(createGig.mock.calls[0][0]).toHaveProperty('my_band_id', null)
  })

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<GigFormModal mode="create" onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  // A personal workspace's fixed profile member is not a band availability
  // roster; /api/availability is gated on band_availability.
  it('skips the member availability panel in a personal workspace', async () => {
    getAvailabilityOn.mockClear()
    vi.useFakeTimers()
    try {
      wrap(<GigFormModal mode="create" initialDate="2026-08-01" onClose={() => {}} />, 'personal')
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    } finally {
      vi.useRealTimers()
    }

    expect(getAvailabilityOn).not.toHaveBeenCalled()
    expect(screen.queryByText('Member availability')).not.toBeInTheDocument()
  })

  it('hides the notes field in create mode', () => {
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    expect(screen.queryByLabelText(/notes/i)).not.toBeInTheDocument()
  })

  it('renders member availability section in create mode', () => {
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByText(/member availability/i)).toBeInTheDocument()
  })
})

describe('GigFormModal — edit mode', () => {
  beforeEach(() => {
    getGig.mockClear()
  })

  it('loads and renders gig data', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => expect(getGig).toHaveBeenCalledWith(1, expect.objectContaining({ signal: expect.any(AbortSignal) })))
    await waitFor(() => {
      expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument()
    })
  })

  it('shows Close button (not Create) in edit mode', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByRole('button', { name: /close/i }))
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument()
  })

  it('renders guaranteed fee field in edit mode', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />, 'band', ['finance.view'])
    await waitFor(() => screen.getByLabelText(/guaranteed fee/i))
    expect(screen.getByLabelText(/guaranteed fee/i)).toBeInTheDocument()
  })

  // The terms tab is finance data, so a member without finance.view gets no
  // fee or merch-cut fields at all.
  it('hides the terms fields without finance.view', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Jazz Night'))
    expect(screen.queryByLabelText(/guaranteed fee/i)).not.toBeInTheDocument()
  })

  it('renders notes field', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Bring own PA'))
    expect(screen.getByDisplayValue('Bring own PA')).toBeInTheDocument()
  })

  it('keeps edit-mode availability inside the participants section', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Jazz Night'))
    expect(screen.getByRole('button', { name: 'Participants' })).toBeInTheDocument()
    expect(screen.queryByText(/member availability/i)).not.toBeInTheDocument()
  })

})
