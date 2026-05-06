import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import RequireTenantAdmin from '../components/RequireTenantAdmin.jsx'

vi.mock('../contexts/authContext.js', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../contexts/authContext.js'

function setup(initialEntry) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route element={<RequireTenantAdmin />}>
          <Route path="/members" element={<div>members</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireTenantAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the outlet for tenant admins', () => {
    useAuth.mockReturnValue({
      user: { id: 1, activeTenantRole: 'tenant_admin', isSuperAdmin: false },
    })
    setup('/members')
    expect(screen.getByText('members')).toBeInTheDocument()
  })

  it('renders the outlet for super admins', () => {
    useAuth.mockReturnValue({
      user: { id: 1, activeTenantRole: 'member', isSuperAdmin: true },
    })
    setup('/members')
    expect(screen.getByText('members')).toBeInTheDocument()
  })

  it('redirects regular members to /', () => {
    useAuth.mockReturnValue({
      user: { id: 1, activeTenantRole: 'member', isSuperAdmin: false },
    })
    setup('/members')
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(screen.queryByText('members')).not.toBeInTheDocument()
  })
})
