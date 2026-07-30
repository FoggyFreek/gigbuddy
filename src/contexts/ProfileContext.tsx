import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ProfileContext } from './profileContext.ts'
import { getProfile } from '../api/profile.ts'
import { useAuth } from './authContext.ts'

interface ProfileProviderProps {
  children: ReactNode
}

export function ProfileProvider({ children }: Readonly<ProfileProviderProps>) {
  const { user } = useAuth()
  const activeTenantId = user?.activeTenantId ?? null
  const [bandName, setBandName] = useState('')
  const [accentColor, setAccentColor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.resolve(activeTenantId ? getProfile() : null)
      .then((p) => {
        if (cancelled) return
        setBandName(p?.band_name || '')
        setAccentColor(p?.accent_color || null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeTenantId])

  const value = useMemo(
    () => ({ bandName, setBandName, accentColor, setAccentColor }),
    [bandName, accentColor],
  )

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  )
}
