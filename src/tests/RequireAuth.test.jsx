import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import RequireAuth from '../components/RequireAuth.jsx'

vi.mock('../contexts/authContext.js', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../contexts/authContext.js'

function setup(initialEntry) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<div>login</div>} />
        <Route path="/pending" element={<div>pending</div>} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<div>home</div>} />
          <Route path="/redeem-invite" element={<div>redeem</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading while user is undefined', () => {
    useAuth.mockReturnValue({ user: undefined })
    setup('/')
    expect(screen.queryByText('home')).not.toBeInTheDocument()
    expect(screen.queryByText('login')).not.toBeInTheDocument()
  })

  it('redirects unauthenticated users to /login', () => {
    useAuth.mockReturnValue({ user: null })
    setup('/')
    expect(screen.getByText('login')).toBeInTheDocument()
  })

  it('redirects globally rejected users to /pending', () => {
    useAuth.mockReturnValue({
      user: { id: 1, status: 'rejected', memberships: [] },
    })
    setup('/')
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('redirects approved users with no memberships to /redeem-invite', () => {
    useAuth.mockReturnValue({
      user: { id: 1, status: 'approved', isSuperAdmin: false, memberships: [] },
    })
    setup('/')
    expect(screen.getByText('redeem')).toBeInTheDocument()
  })

  it('redirects users with only-pending memberships to /pending', () => {
    useAuth.mockReturnValue({
      user: {
        id: 1,
        status: 'approved',
        isSuperAdmin: false,
        memberships: [{ tenantId: 1, status: 'pending', role: 'member' }],
      },
    })
    setup('/')
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('renders the app for users with at least one approved membership', () => {
    useAuth.mockReturnValue({
      user: {
        id: 1,
        status: 'approved',
        isSuperAdmin: false,
        memberships: [{ tenantId: 1, status: 'approved', role: 'member' }],
      },
    })
    setup('/')
    expect(screen.getByText('home')).toBeInTheDocument()
  })

  it('always renders for super admins, even with no memberships', () => {
    useAuth.mockReturnValue({
      user: {
        id: 1,
        status: 'approved',
        isSuperAdmin: true,
        memberships: [],
      },
    })
    setup('/')
    expect(screen.getByText('home')).toBeInTheDocument()
  })

  it('lets users on /redeem-invite stay there even when they have memberships', () => {
    useAuth.mockReturnValue({
      user: {
        id: 1,
        status: 'approved',
        isSuperAdmin: false,
        memberships: [{ tenantId: 1, status: 'pending', role: 'member' }],
      },
    })
    setup('/redeem-invite')
    expect(screen.getByText('redeem')).toBeInTheDocument()
  })
})
