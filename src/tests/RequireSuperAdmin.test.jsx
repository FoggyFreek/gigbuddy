import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import RequireSuperAdmin from '../components/RequireSuperAdmin.jsx'

vi.mock('../contexts/authContext.js', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../contexts/authContext.js'

function setup(initialEntry) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route element={<RequireSuperAdmin />}>
          <Route path="/admin/tenants" element={<div>tenants</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the outlet for super admins', () => {
    useAuth.mockReturnValue({ user: { id: 1, isSuperAdmin: true } })
    setup('/admin/tenants')
    expect(screen.getByText('tenants')).toBeInTheDocument()
  })

  it('redirects tenant admins (non-super) to /', () => {
    useAuth.mockReturnValue({
      user: { id: 1, isSuperAdmin: false, activeTenantRole: 'tenant_admin' },
    })
    setup('/admin/tenants')
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(screen.queryByText('tenants')).not.toBeInTheDocument()
  })
})
