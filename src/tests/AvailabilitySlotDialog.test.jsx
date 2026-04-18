import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import AvailabilitySlotDialog from '../components/AvailabilitySlotDialog.jsx'
import theme from '../theme.js'

const MEMBERS = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

function makeProps(overrides = {}) {
  return {
    open: true,
    slot: { band_member_id: null, start_date: '2026-05-01', end_date: '2026-05-01', status: 'available', reason: '' },
    members: MEMBERS,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

describe('AvailabilitySlotDialog — create', () => {
  it('renders create title', () => {
    wrap(<AvailabilitySlotDialog {...makeProps()} />)
    expect(screen.getByText(/add availability slot/i)).toBeInTheDocument()
  })

  it('rejects when end date is before start date', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const slot = { band_member_id: null, start_date: '2026-05-10', end_date: '2026-05-05', status: 'available', reason: '' }
    wrap(<AvailabilitySlotDialog {...makeProps({ slot, onSave })} />)
    await user.click(screen.getByRole('button', { name: /create/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/on or after start date/i)).toBeInTheDocument()
  })

  it('calls onSave with whole-band payload when member is Whole band', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    wrap(<AvailabilitySlotDialog {...makeProps({ onSave })} />)
    await user.click(screen.getByRole('button', { name: /create/i }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ band_member_id: null })
      )
    )
  })

  it('calls onSave with member id when member is selected', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    wrap(<AvailabilitySlotDialog {...makeProps({ onSave })} />)

    await user.click(screen.getByLabelText(/member/i))
    await user.click(screen.getByText('Alice'))
    await user.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ band_member_id: 1 })
      )
    )
  })
})

describe('AvailabilitySlotDialog — edit', () => {
  it('renders edit title and Delete button', () => {
    const slot = { id: 5, band_member_id: null, start_date: '2026-05-01', end_date: '2026-05-02', status: 'unavailable', reason: 'Holiday' }
    wrap(<AvailabilitySlotDialog {...makeProps({ slot })} />)
    expect(screen.getByText(/edit slot/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('calls onDelete with slot id when Delete is clicked', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const slot = { id: 5, band_member_id: null, start_date: '2026-05-01', end_date: '2026-05-02', status: 'unavailable', reason: '' }
    wrap(<AvailabilitySlotDialog {...makeProps({ slot, onDelete })} />)
    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith(5)
  })
})
