import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import BandParticipantsSection from '../components/BandParticipantsSection.tsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.ts'
import theme from '../theme.ts'

const PARTICIPANTS = [
  { band_member_id: 1, name: 'Alice', position: 'guitar', color: '#f00', vote: 'yes' },
]
const CANDIDATES = [{ id: 2, name: 'Bob', position: 'bass' }]

function wrap(ui, { compact = false } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <CompactLayoutContext.Provider value={compact}>{ui}</CompactLayoutContext.Provider>
    </ThemeProvider>,
  )
}

function baseProps(overrides = {}) {
  return {
    participants: PARTICIPANTS,
    candidateMembers: CANDIDATES,
    addMemberId: '',
    emptyText: 'No participants yet.',
    addParticipantLabel: 'Add participant',
    getRemoveParticipantLabel: (participant) => `remove ${participant.name}`,
    onAddMemberChange: vi.fn(),
    onAddParticipant: vi.fn(),
    onRemoveParticipant: vi.fn(),
    onVote: vi.fn(),
    ...overrides,
  }
}

describe('BandParticipantsSection', () => {
  it('writer mode shows vote, remove and the add row', () => {
    wrap(<BandParticipantsSection {...baseProps()} />)
    expect(screen.getByRole('button', { name: 'Yes' })).toBeEnabled()
    expect(screen.getByLabelText('remove Alice')).toBeInTheDocument()
    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('reader mode disables voting and hides remove + add affordances', () => {
    wrap(<BandParticipantsSection {...baseProps({ canWrite: false })} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'No' })).toBeDisabled()
    expect(screen.queryByLabelText('remove Alice')).not.toBeInTheDocument()
    expect(screen.queryByText('Add')).not.toBeInTheDocument()
  })

  it('supports event-specific row content without showing vote controls', () => {
    wrap(
      <BandParticipantsSection
        {...baseProps({ onVote: undefined })}
        renderParticipantEnd={() => <span>Unavailable</span>}
      />,
    )

    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument()
  })

  it('can limit voting to the current participant', () => {
    wrap(
      <BandParticipantsSection
        {...baseProps({
          participants: [
            ...PARTICIPANTS,
            { band_member_id: 2, name: 'Bob', position: 'bass', vote: null },
          ],
          canWrite: false,
          shouldShowVote: (participant) => participant.band_member_id === 1,
          canVote: (participant) => participant.band_member_id === 1,
        })}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'Yes' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Yes' })).toBeEnabled()
  })

  it('hides vote controls for events in the past', () => {
    wrap(<BandParticipantsSection {...baseProps({ eventDate: '2000-01-01' })} />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'No' })).not.toBeInTheDocument()
  })

  it('hides vote controls when the event is no longer an option', () => {
    wrap(<BandParticipantsSection {...baseProps({ eventStatus: 'confirmed' })} />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'No' })).not.toBeInTheDocument()
  })

  it('uses the compact two-column layout with identity, details and actions in their requested cells', () => {
    wrap(
      <BandParticipantsSection
        {...baseProps()}
        renderParticipantEnd={() => <span>Available</span>}
      />,
      { compact: true },
    )

    const identity = screen.getByTestId('band-participant-identity-1')
    const details = screen.getByTestId('band-participant-details-1')
    const actions = screen.getByTestId('band-participant-actions-1')

    expect(identity).toHaveTextContent('Alice')
    expect(details).toHaveTextContent('guitar')
    expect(details).toHaveTextContent('Available')
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Yes' }))
    expect(actions).toContainElement(screen.getByLabelText('remove Alice'))
  })
})
