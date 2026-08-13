import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RehearsalFormModal from '../components/RehearsalFormModal.tsx'
import theme from '../../../theme.ts'

vi.mock('../../../people/memberships/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([
    { id: 10, name: 'Alice', color: '#e53935', position: 'lead' },
    { id: 11, name: 'Bob', color: '#1e88e5', position: 'lead' },
    { id: 12, name: 'Sam', color: '#43a047', position: 'sub' },
  ]),
}))

vi.mock('../rehearsals.ts', () => ({
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

vi.mock('../../availability/availability.ts', () => ({
  evaluateEventAvailability: vi.fn().mockResolvedValue({ members: [], bandWide: null }),
}))

vi.mock('../../../people/my-bands/myBands.ts', () => ({
  listMyBands: vi.fn().mockResolvedValue({ items: [] }),
}))

import {
  addParticipant,
  createRehearsal,
  getRehearsal,
  removeParticipant,
  setVote,
  updateRehearsal,
} from '../rehearsals.ts'
import { evaluateEventAvailability } from '../../availability/availability.ts'
import { AuthContext } from '../../../contexts/authContext.ts'

const AUTH_VALUE = {
  user: { id: 1, permissions: ['app.view', 'planning.write'], activeTenantRole: 'contributor' },
  setUser: () => {},
  logout: async () => {},
  switchTenant: async () => undefined,
  refreshUser: async () => undefined,
}

function wrap(ui, tenantKind = 'band') {
  return render(
    <AuthContext.Provider value={{ ...AUTH_VALUE, user: { ...AUTH_VALUE.user, activeTenantKind: tenantKind } }}>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
      </ThemeProvider>
    </AuthContext.Provider>
  )
}

describe('RehearsalFormModal — create mode', () => {
  beforeEach(() => {
    createRehearsal.mockClear()
    evaluateEventAvailability.mockClear()
    evaluateEventAvailability.mockResolvedValue({ members: [], bandWide: null })
  })

  it('renders the propose rehearsal dialog', async () => {
    await act(async () => { wrap(<RehearsalFormModal mode="create" onClose={() => {}} />) })
    expect(screen.getByText('Propose rehearsal')).toBeInTheDocument()
  })

  it('shows Cancel and Propose buttons', async () => {
    await act(async () => { wrap(<RehearsalFormModal mode="create" onClose={() => {}} />) })
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

    const dateInput = screen.getByLabelText(/^date\s*\*?$/i)
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

  it('sends the next date for a 22:00 to 02:00 rehearsal', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalFormModal mode="create" onClose={() => {}} />)
    await waitFor(() => screen.getByText(/Sam/))

    await user.type(screen.getByLabelText(/^date\s*\*?$/i), '2026-08-13')
    const [startHours, startMinutes] = within(screen.getByRole('group', { name: /start time/i }))
      .getAllByRole('spinbutton')
    await user.click(startHours)
    await user.keyboard('22')
    await user.click(startMinutes)
    await user.keyboard('00')
    const [endHours, endMinutes] = within(screen.getByRole('group', { name: /end time/i }))
      .getAllByRole('spinbutton')
    await user.click(endHours)
    await user.keyboard('02')
    await user.click(endMinutes)
    await user.keyboard('00')
    await user.click(screen.getByRole('button', { name: /propose/i }))

    await waitFor(() => expect(createRehearsal).toHaveBeenCalledWith(expect.objectContaining({
      proposed_date: '2026-08-13',
      end_date: '2026-08-14',
      start_time: '22:00',
      end_time: '02:00',
    })))
  })

  // Regression: my_band_id is personal-workspace-only. The server 403s if the
  // field is present at all outside one, so a band workspace must omit it —
  // sending it as null used to trip that gate on every rehearsal creation.
  it('omits my_band_id when creating from a band workspace', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalFormModal mode="create" onClose={() => {}} />, 'band')

    await waitFor(() => screen.getByText(/Sam/))
    const dateInput = screen.getByLabelText(/^date\s*\*?$/i)
    await user.type(dateInput, '2099-08-01')
    await user.click(screen.getByRole('button', { name: /propose/i }))

    await waitFor(() => expect(createRehearsal).toHaveBeenCalled())
    expect(createRehearsal.mock.calls[0][0]).not.toHaveProperty('my_band_id')
  })

  it('includes my_band_id when creating from a personal workspace', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalFormModal mode="create" onClose={() => {}} />, 'personal')

    await waitFor(() => screen.getByText(/Sam/))
    const dateInput = screen.getByLabelText(/^date\s*\*?$/i)
    await user.type(dateInput, '2099-08-01')
    await user.click(screen.getByRole('button', { name: /propose/i }))

    await waitFor(() => expect(createRehearsal).toHaveBeenCalled())
    expect(createRehearsal.mock.calls[0][0]).toHaveProperty('my_band_id', null)
  })

  it('warns when a selected member is unavailable and proposes anyway after confirm', async () => {
    evaluateEventAvailability.mockResolvedValue({
      members: [
        { member_id: 10, name: 'Alice', position: 'lead', status: 'unavailable', reason: 'On holiday' },
        { member_id: 11, name: 'Bob', position: 'lead', status: 'available' },
      ],
      bandWide: null,
    })
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<RehearsalFormModal mode="create" onClose={onClose} />)

    await waitFor(() => screen.getByText(/Sam/))

    const dateInput = screen.getByLabelText(/^date\s*\*?$/i)
    await user.type(dateInput, '2099-08-01')

    // The unavailability panel surfaces the unavailable lead.
    await waitFor(() => screen.getByText('Alice'))
    expect(screen.queryByText('On holiday')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^propose$/i }))

    // A confirmation dialog blocks the create instead of proposing immediately.
    await waitFor(() => screen.getByText(/marked unavailable on this date/i))
    expect(createRehearsal).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /propose anyway/i }))
    await waitFor(() => expect(createRehearsal).toHaveBeenCalled())
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
    evaluateEventAvailability.mockReset()
    evaluateEventAvailability.mockResolvedValue({ members: [], bandWide: null })
  })

  it('loads rehearsal and renders participants', async () => {
    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)
    await waitFor(() => expect(getRehearsal).toHaveBeenCalledWith(1))
    await waitFor(() => screen.getByDisplayValue('Studio A'))
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('renders availability inside the matching participant row', async () => {
    evaluateEventAvailability.mockResolvedValueOnce({
      bandWide: null,
      members: [
        { member_id: 10, name: 'Alice', position: 'lead', status: 'available', reason: null },
        { member_id: 11, name: 'Bob', position: 'lead', status: 'unavailable', reason: 'Holiday' },
      ],
    })

    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Studio A'))

    expect(await screen.findByText('Available')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /member availability/i })).not.toBeInTheDocument()
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

  it('shows planned rehearsal participants without required participant controls', async () => {
    getRehearsal.mockResolvedValueOnce({
      id: 1,
      proposed_date: '2099-05-10',
      start_time: null,
      end_time: null,
      location: 'Studio A',
      notes: '',
      status: 'planned',
      participants: [
        { band_member_id: 10, name: 'Alice', color: '#e53935', position: 'lead', vote: 'yes' },
        { band_member_id: 11, name: 'Bob', color: '#1e88e5', position: 'lead', vote: 'yes' },
      ],
    })
    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)

    await waitFor(() => screen.getByDisplayValue('Studio A'))

    expect(screen.queryByText('Required participants')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/add participant/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove alice/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^yes$/i })).not.toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('adds a participant as soon as one is picked in the add-participant autocomplete', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalFormModal mode="edit" rehearsalId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Studio A'))
    await user.click(screen.getByLabelText(/add participant/i))
    await user.click(screen.getByRole('option', { name: /Sam/ }))
    await waitFor(() => expect(addParticipant).toHaveBeenCalledWith(1, 12))
  })
})
