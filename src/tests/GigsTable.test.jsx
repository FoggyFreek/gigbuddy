import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockIsMobile = false
vi.mock('@mui/material/useMediaQuery', () => ({
  default: () => mockIsMobile,
}))

import GigsTable from '../components/GigsTable.tsx'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

function futureDateISO(daysFromNow) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

const GIGS = [
  {
    id: 1,
    event_date: futureDateISO(5),
    event_description: 'Jazz Night',
    venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam' },
    start_time: '20:00:00',
    end_time: '23:00:00',
    status: 'confirmed',
    open_task_count: 2,
  },
  {
    id: 2,
    event_date: futureDateISO(15),
    event_description: 'Summer Festival',
    venue: { id: 12, name: 'Summer Fest', category: 'festival', city: 'Rotterdam' },
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
    expect(screen.getByText('Open tasks')).toBeInTheDocument()
    // Status is shown as a header-less colour dot, not a labelled column.
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
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

  it('shows status as a colour dot without a text label on desktop rows', () => {
    wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
    expect(screen.queryByText('confirmed')).not.toBeInTheDocument()
    expect(screen.queryByText('option')).not.toBeInTheDocument()
  })

  it('renders the open-task badge only when there are open tasks', () => {
    wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
    // Jazz Night has 2 open tasks → badge visible; Summer Festival has 0 → no badge.
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('calls onRowClick with the gig when a row is clicked', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    wrap(<GigsTable gigs={GIGS} onRowClick={onRowClick} />)
    await user.click(screen.getByText('Jazz Night'))
    expect(onRowClick).toHaveBeenCalledWith(GIGS[0])
  })

  it('shows dashes for missing time values', () => {
    wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
    // Summer Festival has no start/end time — time cell renders as "—–—"
    expect(screen.getByText('—–—')).toBeInTheDocument()
  })

  it('renders the event banner thumbnail when banner_path is set', () => {
    const withBanner = [{ ...GIGS[0], banner_path: 'tenants/1/gig-banners/abc.jpg' }]
    const { container } = wrap(<GigsTable gigs={withBanner} onRowClick={() => {}} />)
    const banner = container.querySelector('img[src="/api/files/tenants/1/gig-banners/abc.jpg"]')
    expect(banner).toBeInTheDocument()
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

    it('renders each gig as a card with description and a status icon', () => {
      wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
      // Meta line combines description · venue · city in one span — use a regex.
      expect(screen.getByText(/Jazz Night/)).toBeInTheDocument()
      expect(screen.getByText(/Summer Festival/)).toBeInTheDocument()
      // Status is rendered as an icon (no text label): confirmed → EventAvailable, option → LiveHelp.
      expect(screen.getByTestId('EventAvailableIcon')).toBeInTheDocument()
      expect(screen.getByTestId('LiveHelpIcon')).toBeInTheDocument()
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

    it('does not render a banner background on compact cards when banner_path is set', () => {
      const withBanner = [{ ...GIGS[0], banner_path: 'tenants/1/gig-banners/abc.jpg' }]
      wrap(<GigsTable gigs={withBanner} onRowClick={() => {}} />)
      expect(screen.queryByTestId('gig-card-banner-1')).not.toBeInTheDocument()
    })

    it('does not render a banner background when banner_path is missing', () => {
      wrap(<GigsTable gigs={GIGS} onRowClick={() => {}} />)
      expect(screen.queryByTestId('gig-card-banner-1')).not.toBeInTheDocument()
    })
  })
})
