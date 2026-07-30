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
    { id: 1, name: 'Alice', roles: ['Lead Guitar', 'Lead Vocals'], color: '#e53935', sort_order: 0, position: 'lead' },
  ]),
  createMember: vi.fn().mockResolvedValue({ id: 2, name: 'Bob', roles: ['Drums'], color: null, sort_order: 1, position: 'lead' }),
  updateMember: vi.fn().mockResolvedValue({}),
  deleteMember: vi.fn().mockResolvedValue(null),
}))

import { createMember, deleteMember, listMembers, updateMember } from '../api/bandMembers.ts'

const memberAuth = {
  user: { id: 7, activeTenantRole: 'contributor', permissions: ['app.view', 'planning.write', 'purchase.create'] },
  setUser: () => {},
  logout: async () => {},
  switchTenant: async () => undefined,
  refreshUser: async () => undefined,
}

const adminAuth = {
  ...memberAuth,
  user: { id: 7, activeTenantRole: 'tenant_admin', permissions: ['app.view', 'planning.write', 'members.manage'] },
}

function wrap(ui, { auth = memberAuth } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/profile']}>
          <Routes>
            <Route path="/profile" element={ui} />
            <Route path="/settings/members" element={<div>Members and invites page</div>} />
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
    expect(screen.getByText('(Lead Guitar, Lead Vocals)')).toBeInTheDocument()
  })

  it('keeps the member list view-only for a reader', async () => {
    wrap(<BandMembersSection />, {
      auth: { ...memberAuth, user: { id: 7, activeTenantRole: 'reader', permissions: ['app.view'] } },
    })
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  it('adds a new member', async () => {
    const user = userEvent.setup()
    wrap(<BandMembersSection />)
    await waitFor(() => screen.getByText('Alice'))

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.click(screen.getByRole('button', { name: /add member/i }))
    expect(screen.getByRole('dialog', { name: /add band member/i })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^name$/i), 'Bob')
    await user.click(screen.getByLabelText(/^roles$/i))
    await user.click(screen.getByRole('option', { name: 'Drums' }))
    await user.click(screen.getByRole('option', { name: 'Background Vocals' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() =>
      expect(createMember).toHaveBeenCalledWith({
        name: 'Bob',
        roles: ['Drums', 'Background Vocals'],
        color: null,
        position: 'lead',
      })
    )
  })

  it('edits a member in a modal and saves the ordered roles', async () => {
    const user = userEvent.setup()
    wrap(<BandMembersSection />)
    await waitFor(() => screen.getByText('Alice'))

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.click(screen.getByTestId('EditIcon').closest('button'))
    expect(screen.getByRole('dialog', { name: /edit band member/i })).toBeInTheDocument()

    const nameInput = screen.getByLabelText(/^name$/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Alicia')
    await user.click(screen.getByRole('button', { name: /move lead vocals up/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(
      () => expect(updateMember).toHaveBeenCalledWith(1, {
        name: 'Alicia',
        roles: ['Lead Vocals', 'Lead Guitar'],
        color: '#e53935',
        position: 'lead',
      })
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
      { id: 1, name: 'Alice', roles: ['Lead Guitar'], color: '#e53935', sort_order: 0, position: 'lead', user_id: 42 },
      { id: 2, name: 'Bob', roles: ['Drums'], color: '#1e88e5', sort_order: 1, position: 'lead', user_id: null },
    ])
    wrap(<BandMembersSection />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

    const badges = screen.getAllByAltText('gigBuddy user')
    expect(badges).toHaveLength(1)
  })

  it('shows an invite button to tenant admins when a lead member is not a gigBuddy user', async () => {
    const user = userEvent.setup()
    listMembers.mockResolvedValueOnce([
      { id: 1, name: 'Alice', roles: ['Lead Guitar'], color: '#e53935', sort_order: 0, position: 'lead', user_id: 42 },
      { id: 2, name: 'Bob', roles: ['Drums'], color: '#1e88e5', sort_order: 1, position: 'lead', user_id: null },
    ])
    wrap(<BandMembersSection />, { auth: adminAuth })
    await waitFor(() => screen.getByText('Alice'))

    await user.click(screen.getByRole('button', { name: /invite to gigbuddy/i }))
    expect(screen.getByText('Members and invites page')).toBeInTheDocument()
  })

  it('hides the invite button when all lead members are gigBuddy users', async () => {
    listMembers.mockResolvedValueOnce([
      { id: 1, name: 'Alice', roles: ['Lead Guitar'], color: '#e53935', sort_order: 0, position: 'lead', user_id: 42 },
      { id: 2, name: 'Bob', roles: ['Drums'], color: '#1e88e5', sort_order: 1, position: 'sub', user_id: null },
    ])
    wrap(<BandMembersSection />, { auth: adminAuth })
    await waitFor(() => screen.getByText('Alice'))

    expect(screen.queryByRole('button', { name: /invite to gigbuddy/i })).not.toBeInTheDocument()
  })

  it('hides the invite button from non-admin members', async () => {
    listMembers.mockResolvedValueOnce([
      { id: 2, name: 'Bob', roles: ['Drums'], color: '#1e88e5', sort_order: 1, position: 'lead', user_id: null },
    ])
    wrap(<BandMembersSection />)
    await waitFor(() => screen.getByText('Bob'))

    expect(screen.queryByRole('button', { name: /invite to gigbuddy/i })).not.toBeInTheDocument()
  })

  it('clicking a color swatch saves color immediately', async () => {
    const user = userEvent.setup()
    wrap(<BandMembersSection />)
    await waitFor(() => screen.getByText('Alice'))

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.click(screen.getByTestId('EditIcon').closest('button'))
    const swatch = screen.getByLabelText('color #e91e63')
    await user.click(swatch)
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() =>
      expect(updateMember).toHaveBeenCalledWith(1, {
        name: 'Alice',
        roles: ['Lead Guitar', 'Lead Vocals'],
        color: '#e91e63',
        position: 'lead',
      })
    )
  })
})
