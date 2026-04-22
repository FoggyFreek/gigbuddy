import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.js', () => ({
  listGigs: vi.fn(),
  getGig: vi.fn(),
  createGig: vi.fn(),
  updateGig: vi.fn(),
  deleteGig: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/availability.js', () => ({
  getAvailabilityOn: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))

import GigsPage from '../pages/GigsPage.jsx'
import { deleteGig, listGigs } from '../api/gigs.js'
import theme from '../theme.js'

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
    </ThemeProvider>
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

describe('GigsPage — delete flow', () => {
  let confirmSpy

  beforeEach(() => {
    listGigs.mockReset()
    listGigs.mockResolvedValue(GIGS)
    deleteGig.mockClear()
  })

  afterEach(() => {
    confirmSpy?.mockRestore()
  })

  it('renders header, Add button, and loaded gigs', async () => {
    wrap(<GigsPage />)
    expect(screen.getByRole('heading', { name: /^gigs$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add gig/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
  })

  it('calls deleteGig and reloads when delete is confirmed', async () => {
    const user = userEvent.setup()
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    wrap(<GigsPage />)
    await waitFor(() => expect(listGigs).toHaveBeenCalledTimes(1))
    await waitFor(() => screen.getByText('Jazz Night'))

    await user.click(screen.getByRole('button', { name: /delete gig/i }))

    expect(confirmSpy).toHaveBeenCalledWith('Delete "Jazz Night"?')
    await waitFor(() => expect(deleteGig).toHaveBeenCalledWith(42))
    await waitFor(() => expect(listGigs).toHaveBeenCalledTimes(2))
  })

  it('does not call deleteGig when user cancels the confirmation', async () => {
    const user = userEvent.setup()
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    wrap(<GigsPage />)
    await waitFor(() => screen.getByText('Jazz Night'))

    await user.click(screen.getByRole('button', { name: /delete gig/i }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(deleteGig).not.toHaveBeenCalled()
    expect(listGigs).toHaveBeenCalledTimes(1)
  })

  it('falls back to the formatted date when the gig has no description', async () => {
    listGigs.mockResolvedValue([{ ...GIGS[0], id: 7, event_description: null }])
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    wrap(<GigsPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /delete gig/i })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /delete gig/i }))

    expect(confirmSpy).toHaveBeenCalled()
    const prompt = confirmSpy.mock.calls[0][0]
    expect(prompt).toMatch(/^Delete ".+"\?$/)
    expect(prompt).not.toContain('this gig')
  })
})
