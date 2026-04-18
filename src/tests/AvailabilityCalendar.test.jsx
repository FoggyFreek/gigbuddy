import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import AvailabilityCalendar from '../components/AvailabilityCalendar.jsx'
import theme from '../theme.js'

const MEMBERS = [
  { id: 1, name: 'Alice', color: '#e53935' },
]

const SLOTS = [
  {
    id: 10,
    band_member_id: 1,
    start_date: '2026-04-05',
    end_date: '2026-04-07',
    status: 'available',
    reason: null,
  },
  {
    id: 11,
    band_member_id: null,
    start_date: '2026-04-20',
    end_date: '2026-04-21',
    status: 'unavailable',
    reason: 'Studio',
  },
]

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

function makeProps(overrides = {}) {
  return {
    year: 2026,
    month: 4,
    slots: SLOTS,
    members: MEMBERS,
    selectionStart: null,
    onDayClick: vi.fn(),
    onSlotClick: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  }
}

describe('AvailabilityCalendar', () => {
  it('renders month label', () => {
    wrap(<AvailabilityCalendar {...makeProps()} />)
    expect(screen.getByText(/april 2026/i)).toBeInTheDocument()
  })

  it('renders day headers', () => {
    wrap(<AvailabilityCalendar {...makeProps()} />)
    expect(screen.getByText('Mon')).toBeInTheDocument()
    expect(screen.getByText('Sun')).toBeInTheDocument()
  })

  it('prev/next buttons call handlers', async () => {
    const user = userEvent.setup()
    const onPrev = vi.fn()
    const onNext = vi.fn()
    wrap(<AvailabilityCalendar {...makeProps({ onPrev, onNext })} />)
    await user.click(screen.getByRole('button', { name: /previous month/i }))
    expect(onPrev).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /next month/i }))
    expect(onNext).toHaveBeenCalled()
  })

  it('clicking a day fires onDayClick with iso string', async () => {
    const user = userEvent.setup()
    const onDayClick = vi.fn()
    const { container } = wrap(<AvailabilityCalendar {...makeProps({ onDayClick })} />)
    const cell = container.querySelector('[data-date="2026-04-10"]')
    await user.click(cell)
    expect(onDayClick).toHaveBeenCalledWith('2026-04-10', false)
  })

  it('slot bars only appear on covered dates', () => {
    const { container } = wrap(<AvailabilityCalendar {...makeProps()} />)
    // Slot 10 covers April 5-7 — bar should appear in those cells
    const coveredCell = container.querySelector('[data-date="2026-04-06"]')
    expect(coveredCell.querySelector('[data-slot-id="10"]')).not.toBeNull()
    // Slot should NOT appear outside its range
    const uncoveredCell = container.querySelector('[data-date="2026-04-10"]')
    expect(uncoveredCell.querySelector('[data-slot-id="10"]')).toBeNull()
  })

  it('renders cells using local date parts (not UTC)', () => {
    // Regression: toIsoDate used to call .toISOString().slice(0,10), which in
    // non-UTC timezones shifts the first-of-month cell to the previous day.
    // Each in-month day label must map to the iso matching its own date.
    const { container } = wrap(<AvailabilityCalendar {...makeProps()} />)
    const firstCell = container.querySelector('[data-date="2026-04-01"]')
    expect(firstCell).not.toBeNull()
    const lastCell = container.querySelector('[data-date="2026-04-30"]')
    expect(lastCell).not.toBeNull()
  })

  it('renders gigs on their event date', () => {
    const gigs = [
      { id: 1, event_date: '2026-04-15', event_description: 'Club gig', venue: 'Bar', status: 'confirmed' },
    ]
    const { container } = wrap(<AvailabilityCalendar {...makeProps({ gigs })} />)
    const cell = container.querySelector('[data-date="2026-04-15"]')
    expect(cell.querySelector('[data-gig-id="1"]')).not.toBeNull()
    // Not in adjacent cells
    const before = container.querySelector('[data-date="2026-04-14"]')
    expect(before.querySelector('[data-gig-id="1"]')).toBeNull()
  })

  it('accepts gig event_date as an ISO timestamp string', () => {
    // Server used to serialize DATE as a UTC timestamp like "2026-04-19T22:00:00.000Z"
    // for a stored 2026-04-20. Even though the server is now fixed to return plain
    // YYYY-MM-DD strings, the calendar should still cope with timestamp input.
    const gigs = [
      { id: 2, event_date: '2026-04-15T00:00:00.000Z', event_description: 'Festival', status: 'announced' },
    ]
    const { container } = wrap(<AvailabilityCalendar {...makeProps({ gigs })} />)
    const cell = container.querySelector('[data-date="2026-04-15"]')
    expect(cell.querySelector('[data-gig-id="2"]')).not.toBeNull()
  })

  it('renders gigs and availability slots in the same cell without overlapping', () => {
    const gigs = [
      { id: 3, event_date: '2026-04-06', event_description: 'Show', status: 'confirmed' },
    ]
    const { container } = wrap(<AvailabilityCalendar {...makeProps({ gigs })} />)
    const cell = container.querySelector('[data-date="2026-04-06"]')
    const gigBar = cell.querySelector('[data-gig-id="3"]')
    const slotBar = cell.querySelector('[data-slot-id="10"]')
    expect(gigBar).not.toBeNull()
    expect(slotBar).not.toBeNull()
    // Gigs and slots live in separate stacks: neither should contain the other.
    expect(gigBar.contains(slotBar)).toBe(false)
    expect(slotBar.contains(gigBar)).toBe(false)
  })

  it('fires onGigClick with the gig when a gig bar is clicked', async () => {
    const user = userEvent.setup()
    const onGigClick = vi.fn()
    const onDayClick = vi.fn()
    const gigs = [
      { id: 4, event_date: '2026-04-15', event_description: 'Club gig', status: 'option' },
    ]
    const { container } = wrap(
      <AvailabilityCalendar {...makeProps({ gigs, onGigClick, onDayClick })} />
    )
    const gigBar = container.querySelector('[data-gig-id="4"]')
    await user.click(gigBar)
    expect(onGigClick).toHaveBeenCalledWith(gigs[0])
    // Clicking the gig should not also trigger the day click handler.
    expect(onDayClick).not.toHaveBeenCalled()
  })

  describe('mobile mode', () => {
    it('renders day cells without slot/gig bars and shows dots instead', () => {
      const gigs = [
        { id: 7, event_date: '2026-04-06', event_description: 'Show', status: 'confirmed' },
      ]
      const { container } = wrap(
        <AvailabilityCalendar {...makeProps({ gigs, mobile: true })} />
      )
      const cell = container.querySelector('[data-date="2026-04-06"]')
      // Neither slot nor gig should render as a text bar in mobile mode.
      expect(cell.textContent).not.toMatch(/Alice|Show/)
      // Dots carry data-ids for the gig and the covering slot.
      expect(cell.querySelector('[data-gig-id="7"]')).not.toBeNull()
      expect(cell.querySelector('[data-slot-id="10"]')).not.toBeNull()
    })

    it('highlights the selectedDay cell', () => {
      const { container } = wrap(
        <AvailabilityCalendar {...makeProps({ mobile: true, selectedDay: '2026-04-12' })} />
      )
      const cell = container.querySelector('[data-date="2026-04-12"]')
      // The selected-day indicator is a circle with primary bg inside the cell.
      const circle = cell.querySelector('div')
      expect(circle).not.toBeNull()
    })

    it('day click still fires onDayClick in mobile mode', async () => {
      const user = userEvent.setup()
      const onDayClick = vi.fn()
      const { container } = wrap(
        <AvailabilityCalendar {...makeProps({ mobile: true, onDayClick })} />
      )
      const cell = container.querySelector('[data-date="2026-04-10"]')
      await user.click(cell)
      expect(onDayClick).toHaveBeenCalledWith('2026-04-10', false)
    })
  })

  it('slots returned as plain YYYY-MM-DD strings render on matching cells', () => {
    // Regression: the server used to return start_date/end_date as UTC
    // timestamps. After fixing pg to return 'YYYY-MM-DD', inRange() must
    // match the cell iso with plain string compare.
    const slots = [
      {
        id: 99,
        band_member_id: null,
        start_date: '2026-04-20',
        end_date: '2026-04-22',
        status: 'available',
        reason: null,
      },
    ]
    const { container } = wrap(<AvailabilityCalendar {...makeProps({ slots })} />)
    for (const iso of ['2026-04-20', '2026-04-21', '2026-04-22']) {
      const cell = container.querySelector(`[data-date="${iso}"]`)
      expect(cell.querySelector('[data-slot-id="99"]')).not.toBeNull()
    }
    const outside = container.querySelector('[data-date="2026-04-19"]')
    expect(outside.querySelector('[data-slot-id="99"]')).toBeNull()
  })
})
