import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
    </ThemeProvider>
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
  let confirmSpy

  beforeEach(() => {
    listBandEvents.mockReset()
    listBandEvents.mockResolvedValue(EVENTS)
    deleteBandEvent.mockClear()
  })

  afterEach(() => {
    confirmSpy?.mockRestore()
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

  it('calls deleteBandEvent and reloads when delete is confirmed', async () => {
    const user = userEvent.setup()
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    wrap(<BandEventsPage />)
    await waitFor(() => expect(listBandEvents).toHaveBeenCalledTimes(1))
    await waitFor(() => screen.getByText('Studio session'))

    await user.click(screen.getByRole('button', { name: /delete event/i }))

    expect(confirmSpy).toHaveBeenCalledWith('Delete "Studio session"?')
    await waitFor(() => expect(deleteBandEvent).toHaveBeenCalledWith(1))
    await waitFor(() => expect(listBandEvents).toHaveBeenCalledTimes(2))
  })

  it('does not call deleteBandEvent when user cancels the confirmation', async () => {
    const user = userEvent.setup()
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    wrap(<BandEventsPage />)
    await waitFor(() => screen.getByText('Studio session'))

    await user.click(screen.getByRole('button', { name: /delete event/i }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(deleteBandEvent).not.toHaveBeenCalled()
    expect(listBandEvents).toHaveBeenCalledTimes(1)
  })
})
