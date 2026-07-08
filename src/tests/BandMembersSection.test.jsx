import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BandMembersSection from '../components/BandMembersSection.tsx'
import { AuthContext } from '../contexts/authContext.ts'
import theme from '../theme.ts'

vi.mock('../api/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([
    { id: 1, name: 'Alice', role: 'Guitar', color: '#e53935', sort_order: 0, position: 'lead' },
  ]),
  createMember: vi.fn().mockResolvedValue({ id: 2, name: 'Bob', role: 'Drums', color: null, sort_order: 1, position: 'lead' }),
  updateMember: vi.fn().mockResolvedValue({}),
  deleteMember: vi.fn().mockResolvedValue(null),
}))

import { createMember, deleteMember, listMembers, updateMember } from '../api/bandMembers.ts'

const memberAuth = {
  user: { id: 7, activeTenantRole: 'member', permissions: [] },
  setUser: () => {},
  logout: async () => {},
  switchTenant: async () => undefined,
  refreshUser: async () => undefined,
}

const adminAuth = {
  ...memberAuth,
  user: { id: 7, activeTenantRole: 'tenant_admin', permissions: ['members.manage'] },
}

function wrap(ui, { auth = memberAuth } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/profile']}>
          <Routes>
            <Route path="/profile" element={ui} />
            <Route path="/settings/invites" element={<div>Invites page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </ThemeProvider>
  )
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

  it('shows a gigBuddy badge only for members linked to a user', async () => {
    listMembers.mockResolvedValueOnce([
      { id: 1, name: 'Alice', role: 'Guitar', color: '#e53935', sort_order: 0, position: 'lead', user_id: 42 },
      { id: 2, name: 'Bob', role: 'Drums', color: '#1e88e5', sort_order: 1, position: 'lead', user_id: null },
    ])
    wrap(<BandMembersSection />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    const badges = screen.getAllByAltText('gigBuddy user')
    expect(badges).toHaveLength(1)
  })

  it('shows an invite button to tenant admins when a lead member is not a gigBuddy user', async () => {
    const user = userEvent.setup()
    listMembers.mockResolvedValueOnce([
      { id: 1, name: 'Alice', role: 'Guitar', color: '#e53935', sort_order: 0, position: 'lead', user_id: 42 },
      { id: 2, name: 'Bob', role: 'Drums', color: '#1e88e5', sort_order: 1, position: 'lead', user_id: null },
    ])
    wrap(<BandMembersSection />, { auth: adminAuth })
    await waitFor(() => screen.getByText('Alice'))

    await user.click(screen.getByRole('button', { name: /invite to gigbuddy/i }))
    expect(screen.getByText('Invites page')).toBeInTheDocument()
  })

  it('hides the invite button when all lead members are gigBuddy users', async () => {
    listMembers.mockResolvedValueOnce([
      { id: 1, name: 'Alice', role: 'Guitar', color: '#e53935', sort_order: 0, position: 'lead', user_id: 42 },
      { id: 2, name: 'Bob', role: 'Drums', color: '#1e88e5', sort_order: 1, position: 'sub', user_id: null },
    ])
    wrap(<BandMembersSection />, { auth: adminAuth })
    await waitFor(() => screen.getByText('Alice'))

    expect(screen.queryByRole('button', { name: /invite to gigbuddy/i })).not.toBeInTheDocument()
  })

  it('hides the invite button from non-admin members', async () => {
    listMembers.mockResolvedValueOnce([
      { id: 2, name: 'Bob', role: 'Drums', color: '#1e88e5', sort_order: 1, position: 'lead', user_id: null },
    ])
    wrap(<BandMembersSection />)
    await waitFor(() => screen.getByText('Bob'))

    expect(screen.queryByRole('button', { name: /invite to gigbuddy/i })).not.toBeInTheDocument()
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
