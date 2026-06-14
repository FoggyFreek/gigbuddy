import { createContext, useContext } from 'react'

export interface ProfileContextValue {
  bandName: string
  setBandName: (name: string) => void
  accentColor: string | null
  setAccentColor: (color: string | null) => void
}

export const ProfileContext = createContext<ProfileContextValue>({
  bandName: '',
  setBandName: () => {},
  accentColor: null,
  setAccentColor: () => {},
})

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext)
}
