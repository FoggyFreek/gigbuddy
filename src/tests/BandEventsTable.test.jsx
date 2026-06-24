import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockIsMobile = false
vi.mock('@mui/material/useMediaQuery', () => ({
  default: () => mockIsMobile,
}))

import BandEventsTable from '../components/BandEventsTable.tsx'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

function formatDateISO(daysFromNow) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

function futureDateISO(daysFromNow) {
  return formatDateISO(daysFromNow)
}

function pastDateISO(daysAgo) {
  return formatDateISO(-daysAgo)
}

const EVENTS = [
  {
    id: 1,
    title: 'Studio session',
    start_date: '2099-06-15',
    end_date: '2099-06-17',
    start_time: '10:00:00',
    end_time: '14:00:00',
    location: 'Studio A',
  },
  {
    id: 2,
    title: 'Band meeting',
    start_date: '2099-07-01',
    end_date: '2099-07-01',
    start_time: null,
    end_time: null,
    location: null,
  },
]

describe('BandEventsTable', () => {
  it('renders column headers', () => {
    wrap(<BandEventsTable events={[]} onRowClick={() => {}} />)
    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Time')).toBeInTheDocument()
    expect(screen.getByText('Location')).toBeInTheDocument()
  })

  it('shows empty state when no events', () => {
    wrap(<BandEventsTable events={[]} onRowClick={() => {}} />)
    expect(screen.getByText(/No events yet/i)).toBeInTheDocument()
  })

  it('renders event rows with title chip and location', () => {
    wrap(<BandEventsTable events={EVENTS} onRowClick={() => {}} />)
    expect(screen.getByText('Studio session')).toBeInTheDocument()
    expect(screen.getByText('Band meeting')).toBeInTheDocument()
    expect(screen.getByText('Studio A')).toBeInTheDocument()
  })

  it('shows dashes for missing times/location', () => {
    wrap(<BandEventsTable events={EVENTS} onRowClick={() => {}} />)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('calls onRowClick with the event when a row is clicked', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    wrap(<BandEventsTable events={EVENTS} onRowClick={onRowClick} />)
    await user.click(screen.getByText('Studio A'))
    expect(onRowClick).toHaveBeenCalledWith(EVENTS[0])
  })

  it('sorts only the past band events table by date descending by default', async () => {
    const user = userEvent.setup()
    const events = [
      { ...EVENTS[0], id: 10, start_date: pastDateISO(30), end_date: pastDateISO(30), title: 'Old Past Event' },
      { ...EVENTS[0], id: 11, start_date: pastDateISO(1), end_date: pastDateISO(1), title: 'Most Recent Past Event' },
      { ...EVENTS[0], id: 12, start_date: pastDateISO(10), end_date: pastDateISO(10), title: 'Middle Past Event' },
      { ...EVENTS[0], id: 13, start_date: futureDateISO(20), end_date: futureDateISO(20), title: 'Later Upcoming Event' },
      { ...EVENTS[0], id: 14, start_date: futureDateISO(5), end_date: futureDateISO(5), title: 'Earlier Upcoming Event' },
    ]

    wrap(<BandEventsTable events={events} onRowClick={() => {}} />)
    await user.click(screen.getByText('Past events (3)'))

    const recent = screen.getByText('Most Recent Past Event')
    const middle = screen.getByText('Middle Past Event')
    const old = screen.getByText('Old Past Event')
    const laterUpcoming = screen.getByText('Later Upcoming Event')
    const earlierUpcoming = screen.getByText('Earlier Upcoming Event')

    expect(recent.compareDocumentPosition(middle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(middle.compareDocumentPosition(old) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(laterUpcoming.compareDocumentPosition(earlierUpcoming) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  describe('mobile (compact card layout)', () => {
    beforeEach(() => { mockIsMobile = true })
    afterEach(() => { mockIsMobile = false })

    it('does not render the desktop table header', () => {
      wrap(<BandEventsTable events={EVENTS} onRowClick={() => {}} />)
      expect(screen.queryByText('Start')).not.toBeInTheDocument()
      expect(screen.queryByText('End')).not.toBeInTheDocument()
      expect(screen.queryByText('Location')).not.toBeInTheDocument()
    })

    it('renders a card per event', () => {
      wrap(<BandEventsTable events={EVENTS} onRowClick={() => {}} />)
      expect(screen.getByText(/Studio session/)).toBeInTheDocument()
      expect(screen.getByText(/Band meeting/)).toBeInTheDocument()
    })

    it('clicking a card calls onRowClick with the event', async () => {
      const user = userEvent.setup()
      const onRowClick = vi.fn()
      wrap(<BandEventsTable events={EVENTS} onRowClick={onRowClick} />)
      await user.click(screen.getByText(/Studio session/))
      expect(onRowClick).toHaveBeenCalledWith(EVENTS[0])
    })

    it('shows empty state when no events', () => {
      wrap(<BandEventsTable events={[]} onRowClick={() => {}} />)
      expect(screen.getByText(/No events yet/i)).toBeInTheDocument()
    })
  })
})
