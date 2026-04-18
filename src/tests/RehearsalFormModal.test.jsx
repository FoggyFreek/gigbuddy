import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RehearsalFormModal from '../components/RehearsalFormModal.jsx'
import theme from '../theme.js'

vi.mock('../api/bandMembers.js', () => ({
  listMembers: vi.fn().mockResolvedValue([
    { id: 10, name: 'Alice', color: '#e53935', position: 'lead' },
    { id: 11, name: 'Bob', color: '#1e88e5', position: 'lead' },
    { id: 12, name: 'Sam', color: '#43a047', position: 'sub' },
  ]),
}))

vi.mock('../api/rehearsals.js', () => ({
  createRehearsal: vi.fn().mockResolvedValue({ id: 99 }),
  updateRehearsal: vi.fn().mockResolvedValue({}),
  getRehearsal: vi.fn().mockResolvedValue({
    id: 1,
    proposed_date: '2099-05-10',
    start_time: '19:00:00',
    end_time: '22:00:00',
    location: 'Studio A',
    notes: '',
    status: 'option',
    participants: [
      { band_member_id: 10, name: 'Alice', color: '#e53935', position: 'lead', vote: 'yes' },
      { band_member_id: 11, name: 'Bob', color: '#1e88e5', position: 'lead', vote: null },
    ],
  }),
  addParticipant: vi.fn().mockResolvedValue({}),
  removeParticipant: vi.fn().mockResolvedValue(null),
  setVote: vi.fn().mockResolvedValue({}),
}))

import {
  addParticipant,
  createRehearsal,
  getRehearsal,
  removeParticipant,
  setVote,
  updateRehearsal,
} from '../api/rehearsals.js'

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
    </ThemeProvider>
  )
}

describe('RehearsalFormModal — create mode', () => {
  beforeEach(() => {
    createRehearsal.mockClear()
  })

  it('renders the propose rehearsal dialog', () => {
    wrap(<RehearsalFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByText('Propose rehearsal')).toBeInTheDocument()
  })

  it('shows Cancel and Propose buttons', () => {
    wrap(<RehearsalFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /propose/i })).toBeInTheDocument()
  })

  it('validates required date field', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalFormModal mode="create" onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: /propose/i }))
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(createRehearsal).not.toHaveBeenCalled()
  })

  it('creates rehearsal with extra member ids when valid', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<RehearsalFormModal mode="create" onClose={onClose} />)

    // Wait for members to load so the "Also include" chips render.
    await waitFor(() => screen.getByText(/Sam/))

    const dateInput = screen.getByLabelText(/^date$/i)
    await user.type(dateInput, '2099-08-01')

    // Select the 'sub' member Sam as extra.
    await user.click(screen.getByText(/Sam/))

    await user.click(screen.getByRole('button', { name: /propose/i }))

    await waitFor(() => expect(createRehearsal).toHaveBeenCalled())
    expect(createRehearsal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposed_date: '2099-08-01',
        extra_member_ids: [12],
      })
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('RehearsalFormModal — edit mode', () => {
  beforeEach(() => {
    getRehearsal.mockClear()
    updateRehearsal.mockClear()
    setVote.mockClear()
    addParticipant.mockClear()
    removeParticipant.mockClear()
  })

  it('loads rehearsal and renders participants', async () => {
    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)
    await waitFor(() => expect(getRehearsal).toHaveBeenCalledWith(1))
    await waitFor(() => screen.getByDisplayValue('Studio A'))
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('disables "Plan this rehearsal" until all votes are yes', async () => {
    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Studio A'))
    const planButton = screen.getByRole('button', { name: /plan this rehearsal/i })
    expect(planButton).toBeDisabled()
  })

  it('calls setVote when a vote toggle is clicked', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Studio A'))
    // Bob has no vote yet; click the Yes button within his row.
    // Two Yes buttons exist (one per participant). The second "No" toggle belongs to Bob.
    const yesButtons = screen.getAllByRole('button', { name: /^yes$/i })
    // Click Bob's yes button (second in participant order).
    await user.click(yesButtons[1])
    await waitFor(() => expect(setVote).toHaveBeenCalledWith(1, 11, 'yes'))
  })

  it('calls removeParticipant when delete icon clicked', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Studio A'))
    await user.click(screen.getByRole('button', { name: /remove alice/i }))
    await waitFor(() => expect(removeParticipant).toHaveBeenCalledWith(1, 10))
  })

  it('auto-saves location edits via debounced save', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Studio A'))
    const locationInput = screen.getByDisplayValue('Studio A')
    await user.clear(locationInput)
    await user.type(locationInput, 'Studio B')
    await waitFor(
      () => expect(updateRehearsal).toHaveBeenCalledWith(1, { location: 'Studio B' }),
      { timeout: 2000 }
    )
  })

  it('when all votes are yes, promoting calls updateRehearsal with status=planned', async () => {
    getRehearsal.mockResolvedValueOnce({
      id: 1,
      proposed_date: '2099-05-10',
      start_time: null,
      end_time: null,
      location: 'Studio A',
      notes: '',
      status: 'option',
      participants: [
        { band_member_id: 10, name: 'Alice', color: '#e53935', position: 'lead', vote: 'yes' },
        { band_member_id: 11, name: 'Bob', color: '#1e88e5', position: 'lead', vote: 'yes' },
      ],
    })
    const user = userEvent.setup()
    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Studio A'))
    const planButton = screen.getByRole('button', { name: /plan this rehearsal/i })
    expect(planButton).not.toBeDisabled()
    await user.click(planButton)
    await waitFor(() =>
      expect(updateRehearsal).toHaveBeenCalledWith(1, { status: 'planned' })
    )
  })

  it('adds a participant via the add-participant select + button', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Studio A'))
    await user.click(screen.getByLabelText(/add participant/i))
    await user.click(screen.getByRole('option', { name: /Sam/ }))
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(addParticipant).toHaveBeenCalledWith(1, 12))
  })
})
