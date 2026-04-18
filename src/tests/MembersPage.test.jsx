import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.js'
import MembersPage from '../pages/MembersPage.jsx'

vi.mock('../api/users.js', () => ({
  listUsers: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}))

vi.mock('../api/bandMembers.js', () => ({
  listMembers: vi.fn(),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
}))

vi.mock('../contexts/authContext.js', () => ({
  useAuth: vi.fn(),
  AuthContext: { Provider: ({ children }) => children },
}))


import { listUsers, updateUser, deleteUser } from '../api/users.js'
import { listMembers } from '../api/bandMembers.js'
import { useAuth } from '../contexts/authContext.js'

const ADMIN_USER = { id: 99, email: 'admin@example.com', name: 'Admin', isAdmin: true }

const USERS = [
  { id: 1, name: 'Pending User', email: 'pending@example.com', status: 'pending', picture_url: null, band_member_id: null },
  { id: 2, name: 'Approved User', email: 'approved@example.com', status: 'approved', picture_url: null, band_member_id: null },
  { id: 99, name: 'Admin', email: 'admin@example.com', status: 'approved', picture_url: null, band_member_id: null },
]

const BAND_MEMBERS = [
  { id: 10, name: 'Alice', role: 'Guitar', user_id: null },
  { id: 11, name: 'Bob', role: 'Drums', user_id: null },
]

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>{ui}</MemoryRouter>
    </ThemeProvider>,
  )
}

describe('MembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({ user: ADMIN_USER, logout: vi.fn() })
    listUsers.mockResolvedValue(USERS)
    listMembers.mockResolvedValue([])
  })

  it('renders user rows', async () => {
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    expect(screen.getByText('Approved User')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('renders status chips', async () => {
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getAllByText('pending').length).toBeGreaterThan(0))
    expect(screen.getAllByText('approved').length).toBeGreaterThan(0)
  })

  it('calls updateUser with approved when Approve is clicked', async () => {
    const updated = { ...USERS[0], status: 'approved', band_member_id: null }
    updateUser.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    const approveButtons = screen.getAllByText('Approve')
    await user.click(approveButtons[0])
    expect(updateUser).toHaveBeenCalledWith(1, { status: 'approved' })
  })

  it('calls updateUser with rejected when Reject is clicked', async () => {
    const updated = { ...USERS[0], status: 'rejected', band_member_id: null }
    updateUser.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    const rejectButtons = screen.getAllByText('Reject')
    await user.click(rejectButtons[0])
    expect(updateUser).toHaveBeenCalledWith(1, { status: 'rejected' })
  })

  it('calls deleteUser and removes user from list', async () => {
    deleteUser.mockResolvedValue(null)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    const deleteButtons = screen.getAllByRole('button', { name: /delete user/i })
    await user.click(deleteButtons[0])
    expect(deleteUser).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.queryByText('Pending User')).not.toBeInTheDocument())
  })

  it('band member dropdown is enabled for all users including admin', async () => {
    listMembers.mockResolvedValue(BAND_MEMBERS)
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    const combos = screen.getAllByRole('combobox')
    combos.forEach((combo) => expect(combo).not.toBeDisabled())
  })

  it('calls updateUser with band_member_id when a member is linked to a non-admin user', async () => {
    listMembers.mockResolvedValue(BAND_MEMBERS)
    const updated = { ...USERS[0], band_member_id: 10 }
    updateUser.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    const combos = screen.getAllByRole('combobox')
    await user.click(combos[0])
    await user.click(screen.getByRole('option', { name: 'Alice' }))
    expect(updateUser).toHaveBeenCalledWith(1, { band_member_id: 10 })
  })

  it('calls updateUser with band_member_id when admin is linked to a band member', async () => {
    listMembers.mockResolvedValue(BAND_MEMBERS)
    const updated = { ...USERS[2], band_member_id: 11 }
    updateUser.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument())
    const combos = screen.getAllByRole('combobox')
    // Admin is the 3rd row (index 2)
    await user.click(combos[2])
    await user.click(screen.getByRole('option', { name: 'Bob' }))
    expect(updateUser).toHaveBeenCalledWith(99, { band_member_id: 11 })
  })
})
