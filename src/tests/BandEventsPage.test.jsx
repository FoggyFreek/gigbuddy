import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/bandEvents.js', () => ({
  listBandEvents: vi.fn(),
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
}))

import BandEventsPage from '../pages/BandEventsPage.jsx'
import {
  deleteBandEvent,
  listBandEvents,
} from '../api/bandEvents.js'
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
    deleteBandEvent.mockClear()
  })

  it('renders header and Add event button', async () => {
    wrap(<BandEventsPage />)
    expect(screen.getByRole('heading', { name: /band events/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add event/i })).toBeInTheDocument()
    await waitFor(() => expect(listBandEvents).toHaveBeenCalled())
  })

  it('shows loaded events in the table', async () => {
    wrap(<BandEventsPage />)
    await waitFor(() => expect(screen.getByText('Studio session')).toBeInTheDocument())
  })

  it('opens the create modal when Add event is clicked', async () => {
    const user = userEvent.setup()
    wrap(<BandEventsPage />)
    await waitFor(() => expect(listBandEvents).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /add event/i }))
    expect(screen.getByText('Add band event', { selector: 'h2' })).toBeInTheDocument()
  })

  it('calls deleteBandEvent and reloads when delete is confirmed in the dialog', async () => {
    const user = userEvent.setup()
    wrap(<BandEventsPage />)
    await waitFor(() => expect(listBandEvents).toHaveBeenCalledTimes(1))
    await waitFor(() => screen.getByText('Studio session'))

    await user.click(screen.getByRole('button', { name: /delete event/i }))
    expect(screen.getByText(/delete event\?/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteBandEvent).toHaveBeenCalledWith(1))
    await waitFor(() => expect(listBandEvents).toHaveBeenCalledTimes(2))
  })

  it('does not call deleteBandEvent when Cancel is clicked in the dialog', async () => {
    const user = userEvent.setup()
    wrap(<BandEventsPage />)
    await waitFor(() => screen.getByText('Studio session'))

    await user.click(screen.getByRole('button', { name: /delete event/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(deleteBandEvent).not.toHaveBeenCalled()
    expect(listBandEvents).toHaveBeenCalledTimes(1)
  })

  it('opens the edit modal for ?open=1 and returns to the page on close', async () => {
    const user = userEvent.setup()
    wrap(<BandEventsPage />, { initialEntries: ['/events?open=1'] })

    await waitFor(() => expect(screen.getByText('Band event')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /^close$/i }))

    // Wait for the reload triggered by close to finish — only then can we confirm
    // the modal hasn't been reopened by the ?open= effect re-firing.
    await waitFor(() => expect(listBandEvents).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Band event')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /band events/i })).toBeInTheDocument()
  })
})
