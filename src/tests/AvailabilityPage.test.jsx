import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AvailabilityPage from '../components/AvailabilityPage.jsx'
import { listAvailability } from '../api/availability.js'
import { listGigs } from '../api/gigs.js'
import theme from '../theme.js'

vi.mock('../api/bandMembers.js', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
}))

vi.mock('../api/availability.js', () => ({
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
  getAvailabilityOn: vi.fn(),
}))

vi.mock('../api/gigs.js', () => ({
  listGigs: vi.fn().mockResolvedValue([]),
}))

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('AvailabilityPage', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders page heading', () => {
    wrap(<AvailabilityPage />)
    expect(screen.getByRole('heading', { level: 5, name: /availability/i })).toBeInTheDocument()
  })

  it('renders calendar month/year label', async () => {
    wrap(<AvailabilityPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /previous month/i })).toBeInTheDocument())
  })

  it('fetches gigs on mount and plots them on the calendar', async () => {
    listGigs.mockResolvedValueOnce([
      { id: 42, event_date: '2026-04-20', event_description: 'Show', status: 'confirmed' },
    ])
    const { container } = wrap(<AvailabilityPage />)
    await waitFor(() => {
      const cell = container.querySelector('[data-date="2026-04-20"]')
      expect(cell?.querySelector('[data-gig-id="42"]')).not.toBeNull()
    })
    expect(listGigs).toHaveBeenCalledTimes(1)
  })

  it('renders availability slots returned as plain date strings', async () => {
    listAvailability.mockResolvedValueOnce([
      {
        id: 77,
        band_member_id: null,
        start_date: '2026-04-20',
        end_date: '2026-04-22',
        status: 'available',
        reason: null,
      },
    ])
    const { container } = wrap(<AvailabilityPage />)
    await waitFor(() => {
      const cell = container.querySelector('[data-date="2026-04-21"]')
      expect(cell?.querySelector('[data-slot-id="77"]')).not.toBeNull()
    })
  })
})
