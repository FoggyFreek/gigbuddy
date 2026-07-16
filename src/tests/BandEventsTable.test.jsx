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

  it('shows the upcoming empty state by default', () => {
    wrap(<BandEventsTable events={[]} onRowClick={() => {}} />)
    expect(screen.getByText(/No upcoming events/i)).toBeInTheDocument()
  })

  it('renders Upcoming/Past tabs and reports tab changes', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    wrap(<BandEventsTable events={[]} activeTab="upcoming" onTabChange={onTabChange} />)
    expect(screen.getByRole('tab', { name: 'Upcoming', selected: true })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Past' }))
    expect(onTabChange).toHaveBeenCalledWith('past')
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

  it('shows Load more for a paginated past feed', async () => {
    const user = userEvent.setup()
    const onLoadMore = vi.fn()
    wrap(<BandEventsTable events={EVENTS} activeTab="past" hasMore onLoadMore={onLoadMore} />)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
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
      expect(screen.getByText(/No upcoming events/i)).toBeInTheDocument()
    })
  })
})
