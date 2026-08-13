import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BandAvailabilityPanel from '../components/BandAvailabilityPanel.tsx'
import theme from '../../../theme.ts'

vi.mock('../availability.ts', () => ({
  getAvailabilityOn: vi.fn(),
  getAvailabilitySpan: vi.fn(),
  evaluateEventAvailability: vi.fn(),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))

import { evaluateEventAvailability, getAvailabilityOn, getAvailabilitySpan } from '../availability.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const RESPONSE_WITH_MEMBERS = {
  bandWide: null,
  members: [
    { member_id: 1, name: 'Alice', position: 'lead', status: 'available', reason: null, source: 'member' },
    { member_id: 2, name: 'Bob', position: 'lead', status: 'unavailable', reason: 'Holiday', source: 'member' },
    { member_id: 3, name: 'Carol', position: 'lead', status: 'available', reason: null, source: 'default' },
  ],
}

describe('BandAvailabilityPanel', () => {
  beforeEach(() => {
    getAvailabilityOn.mockClear()
    getAvailabilitySpan.mockClear()
    evaluateEventAvailability.mockReset()
    evaluateEventAvailability.mockImplementation((body) => body.end_date !== body.start_date
      ? getAvailabilitySpan(body.start_date, body.end_date)
      : getAvailabilityOn(body.start_date))
  })

  it('explains that availability follows the date when eventDate is empty', () => {
    wrap(<BandAvailabilityPanel eventDate="" />)
    expect(screen.getByText('Availability is shown as soon as you select a date.')).toBeInTheDocument()
    expect(evaluateEventAvailability).not.toHaveBeenCalled()
  })

  it('renders nothing when no members returned', async () => {
    getAvailabilityOn.mockResolvedValueOnce({ bandWide: null, members: [] })
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(getAvailabilityOn).toHaveBeenCalledWith('2026-05-10'), { timeout: 1000 })
    expect(screen.queryByRole('generic', { name: /alice/i })).not.toBeInTheDocument()
  })

  it('shows success chip for available member', async () => {
    getAvailabilityOn.mockResolvedValueOnce(RESPONSE_WITH_MEMBERS)
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument(), { timeout: 1000 })
  })

  it('shows error chip for unavailable member with reason', async () => {
    const user = userEvent.setup()
    getAvailabilityOn.mockResolvedValueOnce(RESPONSE_WITH_MEMBERS)
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" />)
    const chip = await screen.findByText('Bob')
    expect(screen.queryByText('Holiday')).not.toBeInTheDocument()
    await user.hover(chip)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Bob.*Holiday/i)
  })

  it('shows an orange warning chip inside the travel margin', async () => {
    const user = userEvent.setup()
    getAvailabilityOn.mockResolvedValueOnce({
      bandWide: null,
      members: [{ member_id: 1, name: 'Alice', position: 'lead', status: 'travel_margin', reason: 'Other show' }],
    })
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" />)
    const chip = await screen.findByText('Alice')
    expect(screen.queryByText('Other show')).not.toBeInTheDocument()
    await user.hover(chip)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Alice.*Other show/i)
    expect(document.querySelector('.MuiChip-colorWarning')).not.toBeNull()
  })

  it('shows outlined chip for default member', async () => {
    getAvailabilityOn.mockResolvedValueOnce(RESPONSE_WITH_MEMBERS)
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(screen.getByText('Carol')).toBeInTheDocument(), { timeout: 1000 })
  })

  it('shows band-wide banner when bandWide slot present', async () => {
    getAvailabilityOn.mockResolvedValueOnce({
      bandWide: { status: 'unavailable', reason: 'Tour break' },
      members: [{ member_id: 1, name: 'Alice', position: 'lead', status: 'unavailable', reason: 'Tour break', source: 'band' }],
    })
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(screen.getByText(/band-wide.*tour break/i)).toBeInTheDocument(), { timeout: 1000 })
  })

  it('shows only lead members while creating an event', async () => {
    getAvailabilityOn.mockResolvedValueOnce({
      bandWide: null,
      members: [
        { member_id: 1, name: 'Alice', position: 'lead', status: 'available', reason: null, source: 'default' },
        { member_id: 2, name: 'Dave', position: 'sub', status: 'available', reason: null, source: 'default' },
        { member_id: 3, name: 'Eve', position: 'optional', status: 'available', reason: null, source: 'default' },
        { member_id: 4, name: 'Frank', position: 'sub', status: 'available', reason: null, source: 'member' },
      ],
    })
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument(), { timeout: 1000 })
    expect(screen.queryByText('Dave')).not.toBeInTheDocument()
    expect(screen.queryByText('Eve')).not.toBeInTheDocument()
    expect(screen.queryByText('Frank')).not.toBeInTheDocument()
  })

  it('shows every lead member as unavailable when another gig already books the day', async () => {
    getAvailabilityOn.mockResolvedValueOnce({
      bandWide: null,
      members: [
        { member_id: 1, name: 'Alice', position: 'lead', status: 'unavailable', reason: 'Booked elsewhere', source: 'booking' },
        { member_id: 2, name: 'Bob', position: 'lead', status: 'unavailable', reason: 'Booked elsewhere', source: 'booking' },
        { member_id: 3, name: 'Carol', position: 'lead', status: 'unavailable', reason: 'Booked elsewhere', source: 'booking' },
      ],
    })
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" />)

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument(), { timeout: 1000 })
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Carol')).toBeInTheDocument()
    expect(screen.queryByText('Booked elsewhere')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.MuiChip-colorError')).toHaveLength(3)
  })

  it('queries a span when endDate differs from eventDate', async () => {
    getAvailabilitySpan.mockResolvedValueOnce(RESPONSE_WITH_MEMBERS)
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" endDate="2026-05-12" />)
    await waitFor(() => expect(getAvailabilitySpan).toHaveBeenCalledWith('2026-05-10', '2026-05-12'), { timeout: 1000 })
    expect(getAvailabilityOn).not.toHaveBeenCalled()
  })

  it('queries a single day when endDate equals eventDate', async () => {
    getAvailabilityOn.mockResolvedValueOnce(RESPONSE_WITH_MEMBERS)
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" endDate="2026-05-10" />)
    await waitFor(() => expect(getAvailabilityOn).toHaveBeenCalledWith('2026-05-10'), { timeout: 1000 })
    expect(getAvailabilitySpan).not.toHaveBeenCalled()
  })

  it('skips fetching and clears data when endDate precedes eventDate', async () => {
    const onDataLoad = vi.fn()
    wrap(<BandAvailabilityPanel eventDate="2026-05-10" endDate="2026-05-01" onDataLoad={onDataLoad} />)
    await waitFor(() => expect(onDataLoad).toHaveBeenCalledWith(null))
    expect(getAvailabilityOn).not.toHaveBeenCalled()
    expect(getAvailabilitySpan).not.toHaveBeenCalled()
  })
})
