import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.js'
import MembersPage from '../pages/MembersPage.jsx'

vi.mock('../api/users.js', () => ({
  listMemberships: vi.fn(),
  updateMembership: vi.fn(),
  updateMembershipBandMember: vi.fn(),
  removeMembership: vi.fn(),
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

import {
  listMemberships,
  updateMembership,
  updateMembershipBandMember,
  removeMembership,
} from '../api/users.js'
import { listMembers } from '../api/bandMembers.js'
import { useAuth } from '../contexts/authContext.js'

const ADMIN_USER = {
  id: 99,
  email: 'admin@example.com',
  name: 'Admin',
  isSuperAdmin: false,
  activeTenantRole: 'tenant_admin',
}
const SUPER_ADMIN_USER = { ...ADMIN_USER, isSuperAdmin: true }

const ROWS = [
  {
    user_id: 1,
    name: 'Pending User',
    email: 'pending@example.com',
    status: 'pending',
    role: 'member',
    picture_url: null,
    band_member_id: null,
    is_super_admin: false,
  },
  {
    user_id: 2,
    name: 'Approved User',
    email: 'approved@example.com',
    status: 'approved',
    role: 'member',
    picture_url: null,
    band_member_id: null,
    is_super_admin: false,
  },
  {
    user_id: 99,
    name: 'Admin',
    email: 'admin@example.com',
    status: 'approved',
    role: 'tenant_admin',
    picture_url: null,
    band_member_id: null,
    is_super_admin: false,
  },
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
    listMemberships.mockResolvedValue(ROWS)
    listMembers.mockResolvedValue([])
  })

  it('renders membership rows', async () => {
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

  it('approves a pending membership', async () => {
    const updated = { ...ROWS[0], status: 'approved' }
    updateMembership.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    await user.click(screen.getByText('Approve'))
    expect(updateMembership).toHaveBeenCalledWith(1, { status: 'approved' })
  })

  it('rejects a pending membership', async () => {
    const updated = { ...ROWS[0], status: 'rejected' }
    updateMembership.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    const rejectButtons = screen.getAllByText('Reject')
    await user.click(rejectButtons[0])
    expect(updateMembership).toHaveBeenCalledWith(1, { status: 'rejected' })
  })

  it('removes a membership and drops the row', async () => {
    removeMembership.mockResolvedValue(null)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    const deleteButtons = screen.getAllByRole('button', { name: /remove member/i })
    await user.click(deleteButtons[0])
    expect(removeMembership).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.queryByText('Pending User')).not.toBeInTheDocument())
  })

  it('links a band member to a user', async () => {
    listMembers.mockResolvedValue(BAND_MEMBERS)
    const updated = { ...ROWS[0], band_member_id: 10 }
    updateMembershipBandMember.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    const allCombos = screen.getAllByRole('combobox')
    // Each row contributes 2 selects (role, band_member). Band member is index 1.
    await user.click(allCombos[1])
    await user.click(screen.getByRole('option', { name: 'Alice' }))
    expect(updateMembershipBandMember).toHaveBeenCalledWith(1, 10)
  })

  it('non-super admin cannot promote a member to tenant_admin', async () => {
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Pending User')).toBeInTheDocument())
    // Role select for first row is the first combobox; should be disabled for member rows.
    const allCombos = screen.getAllByRole('combobox')
    expect(allCombos[0]).toHaveAttribute('aria-disabled', 'true')
  })

  it('super admin can promote a member to tenant_admin', async () => {
    useAuth.mockReturnValue({ user: SUPER_ADMIN_USER, logout: vi.fn() })
    const updated = { ...ROWS[1], role: 'tenant_admin' }
    updateMembership.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getByText('Approved User')).toBeInTheDocument())
    const allCombos = screen.getAllByRole('combobox')
    // Approved User (row index 1) — role combobox at index 2 (row 0 has 2 selects).
    await user.click(allCombos[2])
    await user.click(screen.getByRole('option', { name: 'tenant_admin' }))
    expect(updateMembership).toHaveBeenCalledWith(2, { role: 'tenant_admin' })
  })
})
