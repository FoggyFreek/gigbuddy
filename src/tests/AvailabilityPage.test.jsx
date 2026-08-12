import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AvailabilityPage from '../pages/AvailabilityPage.tsx'
import AvailabilitySection from '../components/AvailabilitySection.tsx'
import { listAvailability } from '../api/availability.ts'
import { getGig, listGigsInRange } from '../api/gigs.ts'
import { listMembers } from '../api/bandMembers.ts'
import { CompactLayoutContext } from '../hooks/useCompactLayout.ts'
import theme from '../theme.ts'

vi.mock('../api/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
}))

vi.mock('../api/availability.ts', () => ({
  evaluateEventAvailability: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
  getAvailabilityOn: vi.fn(),
}))

const emptyWindow = (items = []) => ({ items, meta: { from: '', to: '', returned: items.length } })

vi.mock('../api/gigs.ts', () => ({
  getGig: vi.fn(),
  listGigsInRange: vi.fn().mockResolvedValue({ items: [], meta: { from: '', to: '', returned: 0 } }),
}))

vi.mock('../api/rehearsals.ts', () => ({
  getRehearsal: vi.fn(),
  listRehearsalsInRange: vi.fn().mockResolvedValue({ items: [], meta: { from: '', to: '', returned: 0 } }),
}))

vi.mock('../api/bandEvents.ts', () => ({
  getBandEvent: vi.fn(),
  listBandEventsInRange: vi.fn().mockResolvedValue({ items: [], meta: { from: '', to: '', returned: 0 } }),
}))

function wrap(ui, initialEntries, compact = false) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <CompactLayoutContext.Provider value={compact}>{ui}</CompactLayoutContext.Provider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

describe('AvailabilityPage', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders page heading', async () => {
    await act(async () => { wrap(<AvailabilityPage />) })
    expect(screen.getByRole('heading', { level: 5, name: /calendar/i })).toBeInTheDocument()
  })

  it('renders calendar month/year label', async () => {
    wrap(<AvailabilityPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /previous month/i })).toBeInTheDocument())
  })

  it('fetches gigs for the padded calendar grid and plots adjacent-month days', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    listGigsInRange.mockResolvedValueOnce(emptyWindow([
      { id: 42, event_date: '2026-07-20', event_description: 'Show', status: 'confirmed' },
      { id: 43, event_date: '2026-08-01', event_description: 'Adjacent show', status: 'confirmed' },
    ]))
    const { container } = wrap(<AvailabilityPage />)
    await waitFor(() => {
      const cell = container.querySelector('[data-date="2026-07-20"]')
      expect(cell?.querySelector('[data-gig-id="42"]')).not.toBeNull()
      const adjacentCell = container.querySelector('[data-date="2026-08-01"]')
      expect(adjacentCell?.querySelector('[data-gig-id="43"]')).not.toBeNull()
    })
    expect(listGigsInRange).toHaveBeenCalledTimes(1)
    expect(listGigsInRange).toHaveBeenCalledWith({ from: '2026-06-29', to: '2026-08-09' })
  })

  it('looks up a deep-linked gig outside the loaded window and focuses its month', async () => {
    getGig.mockResolvedValueOnce({
      id: 123,
      event_date: '2026-06-18',
      event_description: 'Future show',
      status: 'confirmed',
    })

    const { container } = wrap(
      <AvailabilitySection basePath="/availability" />,
      ['/availability/gigs/123'],
    )

    await waitFor(() => expect(getGig).toHaveBeenCalledWith(123))
    await waitFor(() => {
      expect(container.querySelector('[data-date="2026-06-18"]')).not.toBeNull()
      expect(listGigsInRange).toHaveBeenCalledWith({ from: '2026-06-01', to: '2026-07-12' })
    })
    expect(getGig).toHaveBeenCalledTimes(1)
  })

  it('keeps the chosen month after opening a gig from the calendar', async () => {
    const user = userEvent.setup()
    const gig = {
      id: 123,
      event_date: '2026-04-18',
      event_description: 'Spring show',
      status: 'confirmed',
    }
    listGigsInRange
      .mockResolvedValueOnce(emptyWindow([gig]))
      .mockResolvedValueOnce(emptyWindow())
    getGig.mockResolvedValue(gig)

    const { container } = wrap(
      <AvailabilitySection basePath="/availability" />,
      ['/availability/gigs/123'],
    )

    await waitFor(() => {
      expect(container.querySelector('[data-gig-id="123"]')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'April 2026' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /next month/i }))
    await waitFor(() => expect(listGigsInRange).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'May 2026' })).toBeInTheDocument())
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

  it('keeps the add button inside the list column when a split view forces compact layout', async () => {
    wrap(<AvailabilitySection basePath="/availability" />, undefined, true)
    const fab = await screen.findByRole('button', { name: /add event/i })
    expect(getComputedStyle(fab).position).not.toBe('fixed')
    expect(getComputedStyle(fab.parentElement).position).toBe('sticky')
  })

  it('pins the add button to the viewport on a narrow screen', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = (query) => ({
      matches: query.includes('max-width'), media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
    })
    try {
      wrap(<AvailabilitySection basePath="/availability" />)
      const fab = await screen.findByRole('button', { name: /add event/i })
      expect(getComputedStyle(fab).position).toBe('fixed')
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('allows delegated linked-member slots to be edited from the compact agenda', async () => {
    const user = userEvent.setup()
    listMembers.mockResolvedValueOnce([
      { id: 9, name: 'Alice', color: '#e53935', user_id: 42, availability_managed_by_band: true },
    ])
    listAvailability.mockResolvedValueOnce([
      {
        id: 88,
        band_member_id: 9,
        start_date: '2026-04-15',
        end_date: '2026-04-15',
        status: 'unavailable',
        reason: 'Other booking',
      },
    ])

    const { container } = wrap(<AvailabilitySection />, undefined, true)
    await waitFor(() => expect(container.querySelector('[data-availability-marker="88"]')).not.toBeNull())
    const marker = container.querySelector('[data-availability-marker="88"]')
    expect(marker).toHaveAttribute('data-member-color', '#e53935')
    expect(marker).toHaveAttribute('data-availability-appearance', 'dashed')

    await user.click(marker.closest('[role="button"]'))
    expect(await screen.findByRole('heading', { name: /edit slot/i })).toBeInTheDocument()
  })
})
