import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'

import BandEventAvailabilitySection from '../components/BandEventAvailabilitySection.tsx'
import theme from '../../../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const MEMBERS = [
  { member_id: 1, name: 'Ann Bell', color: '#f00', position: 'lead', status: 'unavailable', reason: 'Holiday', source: 'member' },
  { member_id: 2, name: 'Rik Dane', color: '#0f0', position: 'lead', status: 'available', reason: null, source: 'member' },
]

const SPAN_DAYS = [
  {
    date: '2099-06-15',
    bandWide: null,
    members: [
      { member_id: 1, status: 'available', reason: null, source: 'default' },
      { member_id: 2, status: 'available', reason: null, source: 'member' },
    ],
  },
  {
    date: '2099-06-16',
    bandWide: null,
    members: [
      { member_id: 1, status: 'unavailable', reason: 'Holiday', source: 'member' },
      { member_id: 2, status: 'available', reason: null, source: 'member' },
    ],
  },
]

const SINGLE_DAY = [{ date: '2099-06-15', bandWide: null, members: SPAN_DAYS[1].members }]

describe('BandEventAvailabilitySection', () => {
  it('shows status in the chip and keeps conflict details in its tooltip', async () => {
    const user = userEvent.setup()
    wrap(<BandEventAvailabilitySection members={MEMBERS} days={SINGLE_DAY} />)
    expect(screen.getByText('Ann Bell')).toBeInTheDocument()
    const unavailableChip = screen.getByText('Unavailable')
    expect(screen.queryByText('Holiday')).not.toBeInTheDocument()
    await user.hover(unavailableChip)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Ann Bell.*Holiday/i)
    expect(screen.getByText('Available')).toBeInTheDocument()
  })

  it('breaks a multi-day span down per day, labelled with date and status', () => {
    wrap(<BandEventAvailabilitySection members={MEMBERS} days={SPAN_DAYS} />)
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    expect(screen.queryByText('Available')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Jun 15 — Available')).toHaveLength(2)
    expect(screen.getByLabelText('Jun 16 — Unavailable — Holiday')).toBeInTheDocument()
  })

  it('omits the per-day breakdown for a single-day event', () => {
    wrap(<BandEventAvailabilitySection members={MEMBERS} days={SINGLE_DAY} />)
    expect(screen.queryByLabelText(/Jun 15/)).not.toBeInTheDocument()
  })

  it('shows a redacted member as busy without inventing a reason', () => {
    const redacted = [{ member_id: 3, name: 'Sam Kerr', position: 'lead', status: 'unavailable', reason: null }]
    wrap(<BandEventAvailabilitySection members={redacted} days={SINGLE_DAY} />)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/—/)).not.toBeInTheDocument()
  })

  it('announces a band-wide block above the roster', () => {
    const days = [{ date: '2099-06-15', bandWide: { status: 'unavailable', reason: 'Studio closed' }, members: SINGLE_DAY[0].members }]
    wrap(<BandEventAvailabilitySection members={MEMBERS} days={days} />)
    expect(screen.getByText(/Whole band on Jun 15: Unavailable — Studio closed/)).toBeInTheDocument()
  })

  it('falls back to an empty state without a roster', () => {
    wrap(<BandEventAvailabilitySection members={[]} days={SINGLE_DAY} />)
    expect(screen.getByText(/No band members have been added/)).toBeInTheDocument()
  })

  it('lets a writer explicitly add and remove event members', async () => {
    const user = userEvent.setup()
    const onAddMember = vi.fn()
    const onRemoveMember = vi.fn()
    wrap(
      <BandEventAvailabilitySection
        members={MEMBERS}
        days={SPAN_DAYS}
        candidateMembers={[{ id: 3, name: 'Sam Kerr', position: 'optional' }]}
        canWrite
        onAddMember={onAddMember}
        onRemoveMember={onRemoveMember}
      />,
    )

    await user.click(screen.getByRole('button', { name: /remove ann bell/i }))
    expect(onRemoveMember).toHaveBeenCalledWith(1)

    await user.click(screen.getByLabelText(/add band member/i))
    await user.click(screen.getByRole('option', { name: /sam kerr/i }))
    expect(onAddMember).toHaveBeenCalledWith(3)
  })
})
