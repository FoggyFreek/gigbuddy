import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AuthContext } from './authContext.ts'
import type { User } from './authContext.ts'
import {
  getCurrentUser,
  logout as apiLogout,
  setActiveTenant as apiSetActiveTenant,
} from '../api/auth.ts'
import { clearBannerPathCache } from '../api/profile.ts'
import {
  stashRedirectAfterLogin,
  takeRedirectAfterLogin,
  clearRedirectAfterLogin,
} from '../utils/redirectAfterLogin.ts'
import type { Id } from '../types/entities.ts'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: Readonly<AuthProviderProps>) {
  // undefined = loading, null = unauthenticated, object = authenticated user
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const navigate = useNavigate()
  const location = useLocation()
  // handleUnauthorized fires from a window event, so it reads the live
  // location through a ref instead of re-subscribing on every navigation.
  const locationRef = useRef(location)
  useEffect(() => {
    locationRef.current = location
  }, [location])
  // A logout-triggered 401 must not stash the page the user is walking away
  // from — the next account to log in here must not inherit that redirect.
  const loggingOutRef = useRef(false)
  const bootstrappedRef = useRef(false)

  useEffect(() => {
    // Run the bootstrap once. Under StrictMode the effect fires twice; the
    // second run's stash is already consumed, so its bare urgent setUser
    // interrupts the first run's replay transition mid-flight, rewinding the
    // location and letting RequireAuth's zero-membership redirect strip the
    // invite code from the deep link. (Also saves a duplicate /auth/me call.)
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true
    getCurrentUser()
      .then((u) => {
        const intended = (u as User)?.status === 'approved' ? takeRedirectAfterLogin() : null
        if (intended) {
          // The user state and the replay navigation must land in one commit.
          // navigate() is transition-wrapped in react-router; a bare setUser
          // would commit first, and that intermediate render lets RequireAuth
          // (e.g. its zero-membership redirect to a bare /redeem-invite)
          // issue a competing navigation that clobbers the deep link's query.
          startTransition(() => {
            setUser(u as User)
            navigate(intended, { replace: true })
          })
        } else {
          setUser(u as User)
        }
      })
      .catch(() => setUser(null))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleUnauthorized = useCallback(() => {
    // Stash where the session died (e.g. an invite link opened while logged
    // out) so the post-login replay can land there — with its query string.
    if (!loggingOutRef.current) {
      const { pathname, search } = locationRef.current
      stashRedirectAfterLogin(pathname + search)
    }
    setUser(null)
    navigate('/login', { replace: true })
  }, [navigate])

  useEffect(() => {
    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized)
  }, [handleUnauthorized])

  const logout = useCallback(async () => {
    loggingOutRef.current = true
    try {
      // The session may already be dead server-side (the POST then 401s and
      // fires auth:unauthorized) — the local sign-out below must still run.
      await apiLogout().catch(() => {})
      clearBannerPathCache()
      // Drop any stashed post-login redirect (e.g. an invite deep-link the
      // user bounced off of) so a fresh login lands on the default route, not
      // a stale target the user explicitly walked away from by logging out.
      clearRedirectAfterLogin()
      setUser(null)
      navigate('/login', { replace: true })
    } finally {
      loggingOutRef.current = false
    }
  }, [navigate])

  const switchTenant = useCallback(async (tenantId: Id) => {
    const updated = await apiSetActiveTenant(tenantId)
    // Profile (and its banner) is tenant-scoped — drop the cached path so the
    // next gig detail re-reads it for the now-active tenant.
    clearBannerPathCache()
    setUser(updated as unknown as User)
    return updated as unknown as User
  }, [])

  const refreshUser = useCallback(async () => {
    const updated = await getCurrentUser()
    setUser(updated as User)
    return updated as User
  }, [])

  const value = useMemo(
    () => ({ user, setUser, logout, switchTenant, refreshUser }),
    [user, logout, switchTenant, refreshUser],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
