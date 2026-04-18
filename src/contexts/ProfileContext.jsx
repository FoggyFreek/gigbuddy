import { useEffect, useState } from 'react'
import { ProfileContext } from './profileContext.js'
import { getProfile } from '../api/profile.js'

export function ProfileProvider({ children }) {
  const [bandName, setBandName] = useState('')

  useEffect(() => {
    getProfile()
      .then((p) => setBandName(p?.band_name || ''))
      .catch(() => {})
  }, [])

  return (
    <ProfileContext.Provider value={{ bandName, setBandName }}>
      {children}
    </ProfileContext.Provider>
  )
}
