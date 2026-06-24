import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockIsMobile = false
vi.mock('@mui/material/useMediaQuery', () => ({
  default: () => mockIsMobile,
}))

import RehearsalsTable from '../components/RehearsalsTable.tsx'
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

function pastDateISO(daysAgo) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

const REHEARSALS = [
  {
    id: 1,
    proposed_date: '2099-06-15',
    start_time: '19:00:00',
    end_time: '22:00:00',
    location: 'Studio A',
    status: 'planned',
    participants: [
      { band_member_id: 10, name: 'Alice', color: '#e53935', position: 'lead', vote: 'yes' },
      { band_member_id: 11, name: 'Bob', color: '#1e88e5', position: 'lead', vote: 'yes' },
    ],
  },
  {
    id: 2,
    proposed_date: '2099-07-01',
    start_time: null,
    end_time: null,
    location: null,
    status: 'option',
    participants: [
      { band_member_id: 10, name: 'Alice', color: '#e53935', position: 'lead', vote: 'yes' },
      { band_member_id: 11, name: 'Bob', color: '#1e88e5', position: 'lead', vote: null },
    ],
  },
]

describe('RehearsalsTable', () => {
  it('renders column headers', () => {
    wrap(<RehearsalsTable rehearsals={[]} onRowClick={() => {}} />)
    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.getByText('Location')).toBeInTheDocument()
    expect(screen.getByText('Votes')).toBeInTheDocument()
    // Status is shown as a header-less colour dot, not a labelled column.
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
  })

  it('shows empty state when no rehearsals', () => {
    wrap(<RehearsalsTable rehearsals={[]} onRowClick={() => {}} />)
    expect(screen.getByText(/No rehearsals yet/i)).toBeInTheDocument()
  })

  it('renders rehearsal rows and shows status as an icon without a text label', () => {
    wrap(<RehearsalsTable rehearsals={REHEARSALS} onRowClick={() => {}} />)
    expect(screen.getByText('Studio A')).toBeInTheDocument()
    expect(screen.queryByText('planned')).not.toBeInTheDocument()
    expect(screen.queryByText('option')).not.toBeInTheDocument()
    // Status is conveyed by the gig-style icon: planned → EventAvailable, option → LiveHelp.
    expect(screen.getByTestId('EventAvailableIcon')).toBeInTheDocument()
    expect(screen.getByTestId('LiveHelpIcon')).toBeInTheDocument()
  })

  it('renders a visual progress bar for each rehearsal with participants', () => {
    wrap(<RehearsalsTable rehearsals={REHEARSALS} onRowClick={() => {}} />)
    const bars = screen.getAllByTestId('participant-progress')
    expect(bars.length).toBeGreaterThanOrEqual(REHEARSALS.length)
  })

  it('renders one progress bar per rehearsal row', () => {
    wrap(<RehearsalsTable rehearsals={REHEARSALS} onRowClick={() => {}} />)
    const bars = screen.getAllByTestId('participant-progress')
    expect(bars.length).toBe(REHEARSALS.length)
  })

  it('calls onRowClick with the rehearsal on row click', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    wrap(<RehearsalsTable rehearsals={REHEARSALS} onRowClick={onRowClick} />)
    await user.click(screen.getByText('Studio A'))
    expect(onRowClick).toHaveBeenCalledWith(REHEARSALS[0])
  })

  it('sorts only the past rehearsals table by date descending by default', async () => {
    const user = userEvent.setup()
    const rehearsals = [
      { ...REHEARSALS[0], id: 10, proposed_date: pastDateISO(30), location: 'Old Past Rehearsal' },
      { ...REHEARSALS[0], id: 11, proposed_date: pastDateISO(1), location: 'Most Recent Past Rehearsal' },
      { ...REHEARSALS[0], id: 12, proposed_date: pastDateISO(10), location: 'Middle Past Rehearsal' },
      { ...REHEARSALS[0], id: 13, proposed_date: futureDateISO(20), location: 'Later Upcoming Rehearsal' },
      { ...REHEARSALS[0], id: 14, proposed_date: futureDateISO(5), location: 'Earlier Upcoming Rehearsal' },
    ]

    wrap(<RehearsalsTable rehearsals={rehearsals} onRowClick={() => {}} />)
    await user.click(screen.getByText('Past rehearsals (3)'))

    const recent = screen.getByText('Most Recent Past Rehearsal')
    const middle = screen.getByText('Middle Past Rehearsal')
    const old = screen.getByText('Old Past Rehearsal')
    const laterUpcoming = screen.getByText('Later Upcoming Rehearsal')
    const earlierUpcoming = screen.getByText('Earlier Upcoming Rehearsal')

    expect(recent.compareDocumentPosition(middle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(middle.compareDocumentPosition(old) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(laterUpcoming.compareDocumentPosition(earlierUpcoming) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  describe('mobile', () => {
    beforeEach(() => { mockIsMobile = true })
    afterEach(() => { mockIsMobile = false })

    it('does not render the desktop header', () => {
      wrap(<RehearsalsTable rehearsals={REHEARSALS} onRowClick={() => {}} />)
      expect(screen.queryByText('Location')).not.toBeInTheDocument()
      expect(screen.queryByText('Participants')).not.toBeInTheDocument()
    })

    it('renders a card per rehearsal with a status icon', () => {
      wrap(<RehearsalsTable rehearsals={REHEARSALS} onRowClick={() => {}} />)
      expect(screen.queryByText('planned')).not.toBeInTheDocument()
      expect(screen.queryByText('option')).not.toBeInTheDocument()
      expect(screen.getByTestId('EventAvailableIcon')).toBeInTheDocument()
      expect(screen.getByTestId('LiveHelpIcon')).toBeInTheDocument()
    })

    it('shows empty state when no rehearsals', () => {
      wrap(<RehearsalsTable rehearsals={[]} onRowClick={() => {}} />)
      expect(screen.getByText(/No rehearsals yet/i)).toBeInTheDocument()
    })
  })
})
