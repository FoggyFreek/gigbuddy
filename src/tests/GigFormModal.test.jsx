import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GigFormModal from '../components/GigFormModal.jsx'
import theme from '../theme.js'

vi.mock('../api/availability.js', () => ({
  getAvailabilityOn: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))

// Mock API
vi.mock('../api/gigs.js', () => ({
  createGig: vi.fn().mockResolvedValue({ id: 99 }),
  getGig: vi.fn().mockResolvedValue({
    id: 1,
    event_date: '2026-06-15',
    event_description: 'Jazz Night',
    venue: 'Bimhuis',
    city: 'Amsterdam',
    start_time: '20:00:00',
    end_time: '23:00:00',
    status: 'confirmed',
    booking_fee_cents: 15000,
    notes: 'Bring own PA',
    has_pa_system: false,
    has_drumkit: false,
    tasks: [],
  }),
  updateGig: vi.fn().mockResolvedValue({}),
}))

import { createGig, getGig, updateGig } from '../api/gigs.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('GigFormModal — create mode', () => {
  it('renders the new gig dialog title', () => {
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByText('New gig')).toBeInTheDocument()
  })

  it('shows Cancel and Create buttons', () => {
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
  })

  it('shows validation errors when required fields are empty', async () => {
    const user = userEvent.setup()
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: /create/i }))
    const errors = screen.getAllByText('Required')
    expect(errors.length).toBeGreaterThanOrEqual(1)
  })

  it('calls createGig and onClose when form is valid', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<GigFormModal mode="create" onClose={onClose} />)

    await user.type(screen.getByLabelText(/event description/i), 'Rock Show')
    const dateInput = screen.getByLabelText(/^date$/i)
    await user.type(dateInput, '2026-08-01')

    await user.click(screen.getByRole('button', { name: /create/i }))
    await waitFor(() => expect(createGig).toHaveBeenCalled())
    expect(createGig).toHaveBeenCalledWith(
      expect.objectContaining({ has_pa_system: false, has_drumkit: false })
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<GigFormModal mode="create" onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('hides the notes field in create mode', () => {
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    expect(screen.queryByLabelText(/notes/i)).not.toBeInTheDocument()
  })

  it('renders member availability section in create mode', () => {
    wrap(<GigFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByText(/member availability/i)).toBeInTheDocument()
  })
})

describe('GigFormModal — edit mode', () => {
  beforeEach(() => {
    getGig.mockClear()
  })

  it('loads and renders gig data', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => expect(getGig).toHaveBeenCalledWith(1))
    await waitFor(() => {
      expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument()
    })
  })

  it('shows Close button (not Create) in edit mode', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByRole('button', { name: /close/i }))
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument()
  })

  it('renders band fee field in edit mode', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByLabelText(/band fee/i))
    expect(screen.getByLabelText(/band fee/i)).toBeInTheDocument()
  })

  it('renders notes field', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Bring own PA'))
    expect(screen.getByDisplayValue('Bring own PA')).toBeInTheDocument()
  })

  it('renders availability panel section heading', async () => {
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Jazz Night'))
    expect(screen.getByText(/member availability/i)).toBeInTheDocument()
  })

  it('auto-saves when PA system toggle is flipped', async () => {
    updateGig.mockClear()
    wrap(<GigFormModal mode="edit" gigId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue('Jazz Night'))

    const user = userEvent.setup()
    await user.click(screen.getByLabelText('PA system'))

    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { has_pa_system: true }),
      { timeout: 2000 }
    )
  })
})
