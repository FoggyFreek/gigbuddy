import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import GigAvailabilityPanel from '../components/GigAvailabilityPanel.jsx'
import theme from '../theme.js'

vi.mock('../api/availability.js', () => ({
  getAvailabilityOn: vi.fn(),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))

import { getAvailabilityOn } from '../api/availability.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const RESPONSE_WITH_MEMBERS = {
  bandWide: null,
  members: [
    { member_id: 1, name: 'Alice', position: 'lead', status: 'available', reason: null, source: 'member' },
    { member_id: 2, name: 'Bob', position: 'lead', status: 'unavailable', reason: 'Holiday', source: 'member' },
    { member_id: 3, name: 'Carol', position: 'lead', status: 'default', reason: null, source: 'default' },
  ],
}

describe('GigAvailabilityPanel', () => {
  it('renders nothing when eventDate is empty', () => {
    wrap(<GigAvailabilityPanel eventDate="" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing when no members returned', async () => {
    getAvailabilityOn.mockResolvedValueOnce({ bandWide: null, members: [] })
    wrap(<GigAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(getAvailabilityOn).toHaveBeenCalledWith('2026-05-10'), { timeout: 1000 })
    expect(screen.queryByRole('generic', { name: /alice/i })).not.toBeInTheDocument()
  })

  it('shows success chip for available member', async () => {
    getAvailabilityOn.mockResolvedValueOnce(RESPONSE_WITH_MEMBERS)
    wrap(<GigAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument(), { timeout: 1000 })
  })

  it('shows error chip for unavailable member with reason', async () => {
    getAvailabilityOn.mockResolvedValueOnce(RESPONSE_WITH_MEMBERS)
    wrap(<GigAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(screen.getByText(/bob.*holiday/i)).toBeInTheDocument(), { timeout: 1000 })
  })

  it('shows outlined chip for default member', async () => {
    getAvailabilityOn.mockResolvedValueOnce(RESPONSE_WITH_MEMBERS)
    wrap(<GigAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(screen.getByText('Carol')).toBeInTheDocument(), { timeout: 1000 })
  })

  it('shows band-wide banner when bandWide slot present', async () => {
    getAvailabilityOn.mockResolvedValueOnce({
      bandWide: { status: 'unavailable', reason: 'Tour break' },
      members: [{ member_id: 1, name: 'Alice', position: 'lead', status: 'unavailable', reason: 'Tour break', source: 'band' }],
    })
    wrap(<GigAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(screen.getByText(/band-wide.*tour break/i)).toBeInTheDocument(), { timeout: 1000 })
  })

  it('hides sub/optional members unless explicitly available', async () => {
    getAvailabilityOn.mockResolvedValueOnce({
      bandWide: null,
      members: [
        { member_id: 1, name: 'Alice', position: 'lead', status: 'default', reason: null, source: 'default' },
        { member_id: 2, name: 'Dave', position: 'sub', status: 'default', reason: null, source: 'default' },
        { member_id: 3, name: 'Eve', position: 'optional', status: 'default', reason: null, source: 'default' },
        { member_id: 4, name: 'Frank', position: 'sub', status: 'available', reason: null, source: 'member' },
      ],
    })
    wrap(<GigAvailabilityPanel eventDate="2026-05-10" />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument(), { timeout: 1000 })
    expect(screen.queryByText('Dave')).not.toBeInTheDocument()
    expect(screen.queryByText('Eve')).not.toBeInTheDocument()
    expect(screen.getByText('Frank')).toBeInTheDocument()
  })
})
