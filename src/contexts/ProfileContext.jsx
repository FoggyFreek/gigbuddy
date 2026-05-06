import { useEffect, useState } from 'react'
import { ProfileContext } from './profileContext.js'
import { getProfile } from '../api/profile.js'
import { useAuth } from './authContext.js'

export function ProfileProvider({ children }) {
  const { user } = useAuth()
  const activeTenantId = user?.activeTenantId ?? null
  const [bandName, setBandName] = useState('')
  const [accentColor, setAccentColor] = useState(null)

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

  return (
    <ProfileContext.Provider value={{ bandName, setBandName, accentColor, setAccentColor }}>
      {children}
    </ProfileContext.Provider>
  )
}
