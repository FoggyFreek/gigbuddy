import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import GigParticipantsSection from '../components/GigParticipantsSection.tsx'
import theme from '../theme.ts'

const PARTICIPANTS = [
  { band_member_id: 1, name: 'Alice', position: 'guitar', color: '#f00', vote: 'yes' },
]
const CANDIDATES = [{ id: 2, name: 'Bob', position: 'bass' }]

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

function baseProps(overrides = {}) {
  return {
    participants: PARTICIPANTS,
    candidateMembers: CANDIDATES,
    addMemberId: '',
    onAddMemberChange: vi.fn(),
    onAddParticipant: vi.fn(),
    onRemoveParticipant: vi.fn(),
    onVote: vi.fn(),
    ...overrides,
  }
}

describe('GigParticipantsSection', () => {
  it('writer mode shows vote, remove and the add row', () => {
    wrap(<GigParticipantsSection {...baseProps()} />)
    expect(screen.getByRole('button', { name: 'Yes' })).toBeEnabled()
    expect(screen.getByLabelText('remove Alice')).toBeInTheDocument()
    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('reader mode disables voting and hides remove + add affordances', () => {
    wrap(<GigParticipantsSection {...baseProps({ canWrite: false })} />)
    // The roster is still visible…
    expect(screen.getByText('Alice')).toBeInTheDocument()
    // …but voting is disabled and there is no remove or add control.
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'No' })).toBeDisabled()
    expect(screen.queryByLabelText('remove Alice')).not.toBeInTheDocument()
    expect(screen.queryByText('Add')).not.toBeInTheDocument()
  })
})
