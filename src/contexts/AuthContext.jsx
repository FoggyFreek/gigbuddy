import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from './authContext.js'
import { getCurrentUser, logout as apiLogout } from '../api/auth.js'

export function AuthProvider({ children }) {
  // undefined = loading, null = unauthenticated, object = authenticated user
  const [user, setUser] = useState(undefined)
  const navigate = useNavigate()

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u)
        if (u?.status === 'approved') {
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
    setUser(null)
    navigate('/login', { replace: true })
  }, [navigate])

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
