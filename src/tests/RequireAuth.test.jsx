import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TERMS_VERSION } from '../../shared/termsVersion.js'
import RequireAuth from '../components/RequireAuth.tsx'

vi.mock('../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../contexts/authContext.ts'

function setup(initialEntry) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<div>login</div>} />
        <Route path="/pending" element={<div>pending</div>} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<div>home</div>} />
          <Route path="/redeem-invite" element={<div>redeem</div>} />
          <Route path="/onboarding" element={<div>onboarding</div>} />
          <Route path="/accept-terms" element={<div>accept-terms</div>} />
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

  it('redirects approved users with no memberships to /onboarding', () => {
    useAuth.mockReturnValue({
      user: { id: 1, status: 'approved', isSuperAdmin: false, memberships: [] },
    })
    setup('/')
    expect(screen.getByText('onboarding')).toBeInTheDocument()
  })

  it('lets zero-membership users stay on /redeem-invite (invite path)', () => {
    useAuth.mockReturnValue({
      user: { id: 1, status: 'approved', isSuperAdmin: false, memberships: [] },
    })
    setup('/redeem-invite')
    expect(screen.getByText('redeem')).toBeInTheDocument()
  })

  it('redirects users with only-pending memberships to /pending', () => {
    useAuth.mockReturnValue({
      user: {
        id: 1,
        status: 'approved',
        isSuperAdmin: false,
        memberships: [{ tenantId: 1, status: 'pending', role: 'contributor' }],
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
        termsVersion: TERMS_VERSION,
        memberships: [{ tenantId: 1, status: 'approved', role: 'contributor' }],
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
        termsVersion: TERMS_VERSION,
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
        memberships: [{ tenantId: 1, status: 'pending', role: 'contributor' }],
      },
    })
    setup('/redeem-invite')
    expect(screen.getByText('redeem')).toBeInTheDocument()
  })

  describe('terms gate', () => {
    it('redirects an approved member on a stale terms version to /accept-terms', () => {
      useAuth.mockReturnValue({
        user: {
          id: 1,
          status: 'approved',
          isSuperAdmin: false,
          termsVersion: '2000-01-01',
          memberships: [{ tenantId: 1, status: 'approved', role: 'contributor' }],
        },
      })
      setup('/')
      expect(screen.getByText('accept-terms')).toBeInTheDocument()
    })

    it('redirects an approved invite user who never accepted terms', () => {
      useAuth.mockReturnValue({
        user: {
          id: 1,
          status: 'approved',
          isSuperAdmin: false,
          termsVersion: null,
          memberships: [{ tenantId: 1, status: 'approved', role: 'contributor' }],
        },
      })
      setup('/')
      expect(screen.getByText('accept-terms')).toBeInTheDocument()
    })

    it('does not require terms acceptance from a super admin', () => {
      useAuth.mockReturnValue({
        user: { id: 1, status: 'approved', isSuperAdmin: true, termsVersion: null, memberships: [] },
      })
      setup('/')
      expect(screen.getByText('home')).toBeInTheDocument()
    })

    it('lets a stale-terms user reach /accept-terms itself (no redirect loop)', () => {
      useAuth.mockReturnValue({
        user: {
          id: 1,
          status: 'approved',
          isSuperAdmin: false,
          termsVersion: null,
          memberships: [{ tenantId: 1, status: 'approved', role: 'contributor' }],
        },
      })
      setup('/accept-terms')
      expect(screen.getByText('accept-terms')).toBeInTheDocument()
    })

    it('does not force terms on the onboarding flow (it accepts them itself)', () => {
      useAuth.mockReturnValue({
        user: {
          id: 1,
          status: 'approved',
          isSuperAdmin: false,
          termsVersion: null,
          memberships: [{ tenantId: 1, status: 'approved', role: 'contributor' }],
        },
      })
      setup('/onboarding')
      expect(screen.getByText('onboarding')).toBeInTheDocument()
    })
  })

  describe('/onboarding authorization', () => {
    it('renders for zero-membership users', () => {
      useAuth.mockReturnValue({
        user: { id: 1, status: 'approved', isSuperAdmin: false, memberships: [] },
      })
      setup('/onboarding')
      expect(screen.getByText('onboarding')).toBeInTheDocument()
    })

    it('redirects pending-only users to /pending (no onboarding around approval)', () => {
      useAuth.mockReturnValue({
        user: {
          id: 1,
          status: 'approved',
          isSuperAdmin: false,
          memberships: [{ tenantId: 1, status: 'pending', role: 'contributor' }],
        },
      })
      setup('/onboarding')
      expect(screen.getByText('pending')).toBeInTheDocument()
    })

    it('renders for users with an approved membership (checkout return leg)', () => {
      useAuth.mockReturnValue({
        user: {
          id: 1,
          status: 'approved',
          isSuperAdmin: false,
          memberships: [{ tenantId: 1, status: 'approved', role: 'contributor' }],
        },
      })
      setup('/onboarding')
      expect(screen.getByText('onboarding')).toBeInTheDocument()
    })

    it('renders for super admins', () => {
      useAuth.mockReturnValue({
        user: { id: 1, status: 'approved', isSuperAdmin: true, memberships: [] },
      })
      setup('/onboarding')
      expect(screen.getByText('onboarding')).toBeInTheDocument()
    })
  })
})
