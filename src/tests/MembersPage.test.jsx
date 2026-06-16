import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import MembersPage from '../pages/MembersPage.tsx'

vi.mock('../api/users.ts', () => ({
  listMemberships: vi.fn(),
  updateMembership: vi.fn(),
  updateMembershipBandMember: vi.fn(),
  removeMembership: vi.fn(),
}))

vi.mock('../api/bandMembers.ts', () => ({
  listMembers: vi.fn(),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
}))

vi.mock('../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
  AuthContext: { Provider: ({ children }) => children },
}))

import {
  listMemberships,
  updateMembership,
  updateMembershipBandMember,
  removeMembership,
} from '../api/users.ts'
import { listMembers } from '../api/bandMembers.ts'
import { useAuth } from '../contexts/authContext.ts'

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
    await waitFor(() => expect(screen.getAllByText('Pending User').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Approved User').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0)
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
    await waitFor(() => expect(screen.getAllByText('Pending User').length).toBeGreaterThan(0))
    await user.click(screen.getAllByText('Approve')[0])
    expect(updateMembership).toHaveBeenCalledWith(1, { status: 'approved' })
  })

  it('rejects a pending membership', async () => {
    const updated = { ...ROWS[0], status: 'rejected' }
    updateMembership.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getAllByText('Pending User').length).toBeGreaterThan(0))
    const rejectButtons = screen.getAllByText('Reject')
    await user.click(rejectButtons[0])
    expect(updateMembership).toHaveBeenCalledWith(1, { status: 'rejected' })
  })

  it('removes a membership and drops the row', async () => {
    removeMembership.mockResolvedValue(null)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getAllByText('Pending User').length).toBeGreaterThan(0))
    const deleteButtons = screen.getAllByRole('button', { name: /remove member/i })
    await user.click(deleteButtons[0])
    expect(removeMembership).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.queryAllByText('Pending User')).toHaveLength(0))
  })

  it('links a band member to a user', async () => {
    listMembers.mockResolvedValue(BAND_MEMBERS)
    const updated = { ...ROWS[0], band_member_id: 10 }
    updateMembershipBandMember.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getAllByText('Pending User').length).toBeGreaterThan(0))
    const allCombos = screen.getAllByRole('combobox')
    // Each row contributes 2 selects (role, band_member). Band member is index 1 (desktop table comes first).
    await user.click(allCombos[1])
    await user.click(screen.getByRole('option', { name: 'Alice' }))
    expect(updateMembershipBandMember).toHaveBeenCalledWith(1, 10)
  })

  it('non-super admin can assign the new roles but not tenant_admin', async () => {
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getAllByText('Pending User').length).toBeGreaterThan(0))
    // The role select itself is now enabled (tenant admins may assign the new
    // roles); only the tenant_admin option stays disabled for non-super callers.
    const allCombos = screen.getAllByRole('combobox')
    expect(allCombos[0]).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(allCombos[0])
    expect(screen.getByRole('option', { name: 'financial_admin' })).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: 'tenant_admin' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('super admin can promote a member to tenant_admin', async () => {
    useAuth.mockReturnValue({ user: SUPER_ADMIN_USER, logout: vi.fn() })
    const updated = { ...ROWS[1], role: 'tenant_admin' }
    updateMembership.mockResolvedValue(updated)
    const user = userEvent.setup()
    wrap(<MembersPage />)
    await waitFor(() => expect(screen.getAllByText('Approved User').length).toBeGreaterThan(0))
    const allCombos = screen.getAllByRole('combobox')
    // Approved User (row index 1) — role combobox at index 2 (row 0 has 2 selects in desktop table).
    await user.click(allCombos[2])
    await user.click(screen.getByRole('option', { name: 'tenant_admin' }))
    expect(updateMembership).toHaveBeenCalledWith(2, { role: 'tenant_admin' })
  })
})
