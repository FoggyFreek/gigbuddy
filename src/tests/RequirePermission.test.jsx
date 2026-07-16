import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import RequirePermission from '../components/RequirePermission.tsx'
import { PERMISSIONS } from '../auth/permissions.ts'

// RequirePermission reads usePermissions, which derives capabilities from the
// real matrix using the active tenant role on the auth user. Mock only useAuth
// so the matrix itself is exercised.
vi.mock('../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../contexts/authContext.ts'

function setup(initialEntry, permission) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route element={<RequirePermission permission={permission} />}>
          <Route path="/members" element={<div>members</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequirePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the outlet when the active role grants the permission', () => {
    useAuth.mockReturnValue({ user: { id: 1, activeTenantRole: 'tenant_admin' } })
    setup('/members', PERMISSIONS.MEMBERS_MANAGE)
    expect(screen.getByText('members')).toBeInTheDocument()
  })

  it('renders the outlet for super admins regardless of role', () => {
    useAuth.mockReturnValue({ user: { id: 1, activeTenantRole: 'contributor', isSuperAdmin: true } })
    setup('/members', PERMISSIONS.TENANT_MANAGE)
    expect(screen.getByText('members')).toBeInTheDocument()
  })

  it('redirects to / when the active role lacks the permission', () => {
    // A financial_admin can manage finance but not memberships or tenant settings.
    useAuth.mockReturnValue({ user: { id: 1, activeTenantRole: 'financial_admin' } })
    setup('/members', PERMISSIONS.MEMBERS_MANAGE)
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(screen.queryByText('members')).not.toBeInTheDocument()
  })

  it('honours the explicit permission list from /auth/me when present', () => {
    useAuth.mockReturnValue({ user: { id: 1, activeTenantRole: 'reader', permissions: [PERMISSIONS.TENANT_MANAGE] } })
    setup('/members', PERMISSIONS.TENANT_MANAGE)
    expect(screen.getByText('members')).toBeInTheDocument()
  })
})
