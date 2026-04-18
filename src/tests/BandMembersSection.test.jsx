import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BandMembersSection from '../components/BandMembersSection.jsx'
import theme from '../theme.js'

vi.mock('../api/bandMembers.js', () => ({
  listMembers: vi.fn().mockResolvedValue([
    { id: 1, name: 'Alice', role: 'Guitar', color: '#e53935', sort_order: 0, position: 'lead' },
  ]),
  createMember: vi.fn().mockResolvedValue({ id: 2, name: 'Bob', role: 'Drums', color: null, sort_order: 1, position: 'lead' }),
  updateMember: vi.fn().mockResolvedValue({}),
  deleteMember: vi.fn().mockResolvedValue(null),
}))

import { createMember, deleteMember, listMembers, updateMember } from '../api/bandMembers.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('BandMembersSection', () => {
  beforeEach(() => {
    listMembers.mockClear()
    createMember.mockClear()
    updateMember.mockClear()
    deleteMember.mockClear()
  })

  it('renders existing members', async () => {
    wrap(<BandMembersSection />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.getByText('(Guitar)')).toBeInTheDocument()
  })

  it('adds a new member', async () => {
    const user = userEvent.setup()
    wrap(<BandMembersSection />)
    await waitFor(() => screen.getByText('Alice'))

    // The add form is only shown in section editing mode
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.type(screen.getByLabelText(/^name$/i), 'Bob')
    await user.type(screen.getByLabelText(/^role$/i), 'Drums')
    await user.click(screen.getByRole('button', { name: /add member/i }))

    await waitFor(() =>
      expect(createMember).toHaveBeenCalledWith({ name: 'Bob', role: 'Drums', position: 'lead' })
    )
  })

  it('switches to edit mode and debounce-saves name change', async () => {
    const user = userEvent.setup()
    wrap(<BandMembersSection />)
    await waitFor(() => screen.getByText('Alice'))

    // Enable section editing to reveal per-member edit buttons, then click Alice's edit button
    // (section button switches to CheckIcon/Done, so EditIcon belongs uniquely to Alice's row)
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.click(screen.getByTestId('EditIcon').closest('button'))
    const nameInput = screen.getAllByLabelText(/^name$/i)[0]
    await user.clear(nameInput)
    await user.type(nameInput, 'Alicia')

    await waitFor(
      () => expect(updateMember).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Alicia' })),
      { timeout: 2000 }
    )
  })

  it('deletes a member', async () => {
    const user = userEvent.setup()
    wrap(<BandMembersSection />)
    await waitFor(() => screen.getByText('Alice'))

    // Enable section editing to reveal per-member delete button
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.click(screen.getByTestId('DeleteIcon').closest('button'))
    await waitFor(() => expect(deleteMember).toHaveBeenCalledWith(1))
  })

  it('clicking a color swatch saves color immediately', async () => {
    const user = userEvent.setup()
    wrap(<BandMembersSection />)
    await waitFor(() => screen.getByText('Alice'))

    // Enable section editing, then enter per-member edit mode to reveal color swatches
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.click(screen.getByTestId('EditIcon').closest('button'))
    const swatch = screen.getByLabelText('color #e91e63')
    await user.click(swatch)

    await waitFor(() =>
      expect(updateMember).toHaveBeenCalledWith(1, { color: '#e91e63' })
    )
  })
})
