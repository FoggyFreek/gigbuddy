import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../bandEvents.ts', () => ({
  createBandEvent: vi.fn().mockResolvedValue({ id: 99 }),
  getBandEvent: vi.fn().mockResolvedValue({
    id: 1,
    title: 'Studio session',
    start_date: '2099-06-15',
    end_date: '2099-06-17',
    start_time: '10:00:00',
    end_time: '14:00:00',
    location: 'Studio A',
    notes: 'Bring reference tracks',
  }),
  updateBandEvent: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../availability/availability.ts', () => ({
  evaluateEventAvailability: vi.fn().mockResolvedValue({ members: [], days: [] }),
}))

vi.mock('../../../people/my-bands/myBands.ts', () => ({
  listMyBands: vi.fn().mockResolvedValue({ items: [] }),
}))

import BandEventFormModal from '../components/BandEventFormModal.tsx'
import { createBandEvent, getBandEvent, updateBandEvent } from '../bandEvents.ts'
import { evaluateEventAvailability } from '../../availability/availability.ts'
import { AuthContext } from '../../../contexts/authContext.ts'
import theme from '../../../theme.ts'

function wrap(ui, tenantKind = 'band') {
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={{
        user: { id: 1, activeTenantId: 7, activeTenantKind: tenantKind },
        setUser: () => {},
        logout: async () => {},
        switchTenant: async () => undefined,
        refreshUser: async () => undefined,
      }}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
      </AuthContext.Provider>
    </ThemeProvider>
  )
}

describe('BandEventFormModal — create mode', () => {
  beforeEach(() => {
    createBandEvent.mockClear()
    evaluateEventAvailability.mockReset()
    evaluateEventAvailability.mockResolvedValue({ members: [], days: [] })
  })

  it('renders the add event dialog title', () => {
    wrap(<BandEventFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByText('Add band event')).toBeInTheDocument()
  })

  it('shows Cancel and Add event buttons', () => {
    wrap(<BandEventFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add event/i })).toBeInTheDocument()
  })

  it('shows validation errors when required fields are empty', async () => {
    const user = userEvent.setup()
    wrap(<BandEventFormModal mode="create" onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: /add event/i }))
    const errors = screen.getAllByText('Required')
    expect(errors.length).toBeGreaterThanOrEqual(2)
    expect(createBandEvent).not.toHaveBeenCalled()
  })

  it('calls createBandEvent and onClose when form is valid', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<BandEventFormModal mode="create" onClose={onClose} />)

    await user.type(screen.getByLabelText(/title/i), 'Photo shoot')
    const dateInput = screen.getByLabelText(/start date\s*\*?/i)
    await user.type(dateInput, '2099-09-01')

    await user.click(screen.getByRole('button', { name: /add event/i }))

    await waitFor(() => expect(createBandEvent).toHaveBeenCalled())
    expect(createBandEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Photo shoot',
        start_date: '2099-09-01',
      })
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<BandEventFormModal mode="create" onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(createBandEvent).not.toHaveBeenCalled()
  })

  // Regression: my_band_id is personal-workspace-only. The server 403s if the
  // field is present at all outside one, so a band workspace must omit it —
  // sending it as null used to trip that gate on every band event creation.
  it('omits my_band_id when creating from a band workspace', async () => {
    const user = userEvent.setup()
    wrap(<BandEventFormModal mode="create" onClose={() => {}} />, 'band')

    await user.type(screen.getByLabelText(/title/i), 'Photo shoot')
    await user.type(screen.getByLabelText(/start date\s*\*?/i), '2099-09-01')
    await user.click(screen.getByRole('button', { name: /add event/i }))

    await waitFor(() => expect(createBandEvent).toHaveBeenCalled())
    expect(createBandEvent.mock.calls[0][0]).not.toHaveProperty('my_band_id')
  })

  it('includes my_band_id when creating from a personal workspace', async () => {
    const user = userEvent.setup()
    wrap(<BandEventFormModal mode="create" onClose={() => {}} />, 'personal')

    await user.type(screen.getByLabelText(/title/i), 'Photo shoot')
    await user.type(screen.getByLabelText(/start date\s*\*?/i), '2099-09-01')
    await user.click(screen.getByRole('button', { name: /add event/i }))

    await waitFor(() => expect(createBandEvent).toHaveBeenCalled())
    expect(createBandEvent.mock.calls[0][0]).toHaveProperty('my_band_id', null)
  })

  it('explains that availability follows the date while no date is set', async () => {
    const user = userEvent.setup()
    wrap(<BandEventFormModal mode="create" onClose={() => {}} />)

    expect(screen.getByText('Availability is shown as soon as you select a date.')).toBeInTheDocument()
    expect(evaluateEventAvailability).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/start date\s*\*?/i), '2099-09-01')
    await waitFor(() => expect(evaluateEventAvailability).toHaveBeenCalled())
    expect(screen.queryByText('Availability is shown as soon as you select a date.')).not.toBeInTheDocument()
  })

  it('checks lead availability across the event span before creation', async () => {
    evaluateEventAvailability.mockResolvedValueOnce({
      members: [
        { member_id: 1, name: 'Ann Bell', position: 'lead', status: 'unavailable', reason: 'Holiday' },
        { member_id: 2, name: 'Sam Kerr', position: 'optional', status: 'available', reason: null },
      ],
      days: [],
    })
    const user = userEvent.setup()
    wrap(<BandEventFormModal mode="create" onClose={() => {}} />)

    await user.type(screen.getByLabelText(/title/i), 'Photo shoot')
    await user.type(screen.getByLabelText(/start date\s*\*?/i), '2099-09-01')
    await user.type(screen.getByLabelText(/^end date/i), '2099-09-03')

    await waitFor(() => expect(evaluateEventAvailability).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'band_event',
      start_date: '2099-09-01',
      end_date: '2099-09-03',
    })))
    expect(await screen.findByText('Ann Bell')).toBeInTheDocument()
    expect(screen.queryByText('Holiday')).not.toBeInTheDocument()
    expect(screen.queryByText('Sam Kerr')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add event/i }))
    expect(await screen.findByText(/lead member unavailable/i)).toBeInTheDocument()
    expect(createBandEvent).not.toHaveBeenCalled()
  })

  // A personal workspace's fixed profile member is not a band availability
  // roster; /api/availability is gated on band_availability.
  it('skips the availability check in a personal workspace', async () => {
    vi.useFakeTimers()
    try {
      wrap(<BandEventFormModal mode="create" initialDate="2099-09-01" onClose={() => {}} />, 'personal')
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    } finally {
      vi.useRealTimers()
    }

    expect(evaluateEventAvailability).not.toHaveBeenCalled()
    expect(screen.queryByText('Availability')).not.toBeInTheDocument()
  })
})

describe('BandEventFormModal — edit mode', () => {
  beforeEach(() => {
    getBandEvent.mockClear()
    updateBandEvent.mockClear()
  })

  it('loads and renders event data', async () => {
    wrap(<BandEventFormModal mode="edit" bandEventId={1} onClose={() => {}} />)
    await waitFor(() => expect(getBandEvent).toHaveBeenCalledWith(1))
    await waitFor(() => {
      expect(screen.getByDisplayValue('Studio session')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('Studio A')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bring reference tracks')).toBeInTheDocument()
  })

  it('shows Close button (not Add event) in edit mode', async () => {
    wrap(<BandEventFormModal mode="edit" bandEventId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByRole('button', { name: /close/i }))
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add event/i })).not.toBeInTheDocument()
  })

  it('auto-saves when location is edited', async () => {
    const user = userEvent.setup()
    wrap(<BandEventFormModal mode="edit" bandEventId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Studio A'))

    const locationInput = screen.getByDisplayValue('Studio A')
    await user.clear(locationInput)
    await user.type(locationInput, 'Studio B')

    await waitFor(
      () => expect(updateBandEvent).toHaveBeenCalledWith(1, { location: 'Studio B' }),
      { timeout: 2000 }
    )
  })

  it('moves a single-date event end to the next day when its end time is earlier', async () => {
    getBandEvent.mockResolvedValueOnce({
      id: 1,
      title: 'Late show',
      start_date: '2099-06-15',
      end_date: '2099-06-15',
      start_time: '22:00:00',
      end_time: null,
      location: '',
      notes: '',
    })
    const user = userEvent.setup()
    wrap(<BandEventFormModal mode="edit" bandEventId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Late show'))

    const [hours, minutes] = within(screen.getByRole('group', { name: /end time/i }))
      .getAllByRole('spinbutton')
    await user.click(hours)
    await user.keyboard('02')
    await user.click(minutes)
    await user.keyboard('00')

    await waitFor(
      () => expect(updateBandEvent).toHaveBeenCalledWith(1, {
        end_time: '02:00',
        end_date: '2099-06-16',
      }),
      { timeout: 2000 },
    )
  })

  it('flushes pending saves and calls onClose when Close is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<BandEventFormModal mode="edit" bandEventId={1} onClose={onClose} />)
    await waitFor(() => screen.getByDisplayValue('Studio session'))

    await user.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
