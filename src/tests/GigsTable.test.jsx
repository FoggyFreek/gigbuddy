import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockIsMobile = false
vi.mock('@mui/material/useMediaQuery', () => ({
  default: () => mockIsMobile,
}))

import GigsTable from '../components/GigsTable.jsx'
import theme from '../theme.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const GIGS = [
  {
    id: 1,
    event_date: '2026-06-15T00:00:00.000Z',
    event_description: 'Jazz Night',
    venue: 'Bimhuis',
    city: 'Amsterdam',
    start_time: '20:00:00',
    end_time: '23:00:00',
    status: 'confirmed',
    open_task_count: 2,
  },
  {
    id: 2,
    event_date: '2026-07-01T00:00:00.000Z',
    event_description: 'Summer Festival',
    venue: null,
    city: 'Rotterdam',
    start_time: null,
    end_time: null,
    status: 'option',
    open_task_count: 0,
  },
]

describe('GigsTable', () => {
  it('renders column headers', () => {
    wrap(<GigsTable gigs={[]} onRowClick={() => {}} />)
    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.getByText('Event')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Open tasks')).toBeInTheDocument()
  })

  it('shows empty state when no gigs', () => {
    wrap(<GigsTable gigs={[]} onRowClick={() => {}} />)
    expect(screen.getByText(/No gigs yet/i)).toBeInTheDocument()
  })

  it('renders gig rows', () => {
    wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
    expect(screen.getByText('Jazz Night')).toBeInTheDocument()
    expect(screen.getByText('Summer Festival')).toBeInTheDocument()
    expect(screen.getByText('Bimhuis')).toBeInTheDocument()
    expect(screen.getByText('Amsterdam')).toBeInTheDocument()
  })

  it('renders status chips', () => {
    wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
    expect(screen.getByText('confirmed')).toBeInTheDocument()
    expect(screen.getByText('option')).toBeInTheDocument()
  })

  it('renders open task counts', () => {
    wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('calls onRowClick with the gig when a row is clicked', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    wrap(<GigsTable gigs={GIGS} onRowClick={onRowClick} />)
    await user.click(screen.getByText('Jazz Night'))
    expect(onRowClick).toHaveBeenCalledWith(GIGS[0])
  })

  it('shows dashes for missing venue/time', () => {
    wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
    // Summer Festival has no venue or times — expect em-dashes
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })

  describe('mobile (compact card layout)', () => {
    beforeEach(() => { mockIsMobile = true })
    afterEach(() => { mockIsMobile = false })

    it('does not render the desktop table header', () => {
      wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
      expect(screen.queryByText('Date')).not.toBeInTheDocument()
      expect(screen.queryByText('Event')).not.toBeInTheDocument()
      expect(screen.queryByText('Open tasks')).not.toBeInTheDocument()
    })

    it('renders each gig as a card with description and status chip', () => {
      wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
      // Meta line combines description · venue · city in one span — use a regex.
      expect(screen.getByText(/Jazz Night/)).toBeInTheDocument()
      expect(screen.getByText(/Summer Festival/)).toBeInTheDocument()
      expect(screen.getByText('confirmed')).toBeInTheDocument()
      expect(screen.getByText('option')).toBeInTheDocument()
    })

    it('only shows the task-count badge when there are open tasks', () => {
      wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
      // Jazz Night has 2 open tasks → badge visible; Summer Festival has 0 → no badge.
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.queryByText('0')).not.toBeInTheDocument()
    })

    it('clicking a card calls onRowClick with the gig', async () => {
      const user = userEvent.setup()
      const onRowClick = vi.fn()
      wrap(<GigsTable gigs={GIGS} onRowClick={onRowClick} />)
      await user.click(screen.getByText(/Summer Festival/))
      expect(onRowClick).toHaveBeenCalledWith(GIGS[1])
    })

    it('shows empty state when no gigs', () => {
      wrap(<GigsTable gigs={[]} onRowClick={() => {}} />)
      expect(screen.getByText(/No gigs yet/i)).toBeInTheDocument()
    })
  })
})
