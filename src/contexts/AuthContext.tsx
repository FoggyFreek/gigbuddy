import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from './authContext.ts'
import type { User } from './authContext.ts'
import {
  getCurrentUser,
  logout as apiLogout,
  setActiveTenant as apiSetActiveTenant,
} from '../api/auth.ts'
import { clearBannerPathCache } from '../api/profile.ts'
import type { Id } from '../types/entities.ts'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  // undefined = loading, null = unauthenticated, object = authenticated user
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const navigate = useNavigate()

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u as User)
        if ((u as User)?.status === 'approved') {
          const intended = localStorage.getItem('gigbuddy:redirectAfterLogin')
          if (intended) {
            localStorage.removeItem('gigbuddy:redirectAfterLogin')
            navigate(intended, { replace: true })
          }
        }
      })
      .catch(() => setUser(null))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleUnauthorized = useCallback(() => {
    setUser(null)
    navigate('/login', { replace: true })
  }, [navigate])

  useEffect(() => {
    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized)
  }, [handleUnauthorized])

  const logout = useCallback(async () => {
    await apiLogout()
    clearBannerPathCache()
    setUser(null)
    navigate('/login', { replace: true })
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
