import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockIsMobile = false
vi.mock('@mui/material/useMediaQuery', () => ({
  default: () => mockIsMobile,
}))

import RehearsalsTable from '../components/RehearsalsTable.jsx'
import theme from '../theme.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
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
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Votes')).toBeInTheDocument()
  })

  it('renders a delete icon per row and calls onDelete without triggering row click', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const onRowClick = vi.fn()
    wrap(<RehearsalsTable rehearsals={REHEARSALS} onRowClick={onRowClick} onDelete={onDelete} />)
    const buttons = screen.getAllByRole('button', { name: /delete rehearsal/i })
    expect(buttons.length).toBe(REHEARSALS.length)
    await user.click(buttons[0])
    expect(onDelete).toHaveBeenCalledWith(REHEARSALS[0])
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('shows empty state when no rehearsals', () => {
    wrap(<RehearsalsTable rehearsals={[]} onRowClick={() => {}} />)
    expect(screen.getByText(/No rehearsals yet/i)).toBeInTheDocument()
  })

  it('renders rehearsal rows with status chips', () => {
    wrap(<RehearsalsTable rehearsals={REHEARSALS} onRowClick={() => {}} />)
    expect(screen.getByText('Studio A')).toBeInTheDocument()
    expect(screen.getByText('planned')).toBeInTheDocument()
    expect(screen.getByText('option')).toBeInTheDocument()
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

  describe('mobile', () => {
    beforeEach(() => { mockIsMobile = true })
    afterEach(() => { mockIsMobile = false })

    it('does not render the desktop header', () => {
      wrap(<RehearsalsTable rehearsals={REHEARSALS} onRowClick={() => {}} />)
      expect(screen.queryByText('Location')).not.toBeInTheDocument()
      expect(screen.queryByText('Participants')).not.toBeInTheDocument()
    })

    it('renders a card per rehearsal with status chip', () => {
      wrap(<RehearsalsTable rehearsals={REHEARSALS} onRowClick={() => {}} />)
      expect(screen.getByText('planned')).toBeInTheDocument()
      expect(screen.getByText('option')).toBeInTheDocument()
    })

    it('shows empty state when no rehearsals', () => {
      wrap(<RehearsalsTable rehearsals={[]} onRowClick={() => {}} />)
      expect(screen.getByText(/No rehearsals yet/i)).toBeInTheDocument()
    })
  })
})
