import { createContext, useContext } from 'react'

export const ProfileContext = createContext({ bandName: '', setBandName: () => {}, accentColor: null, setAccentColor: () => {} })

export function useProfile() {
  return useContext(ProfileContext)
}
