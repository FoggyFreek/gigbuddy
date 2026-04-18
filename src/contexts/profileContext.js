import { createContext, useContext } from 'react'

export const ProfileContext = createContext({ bandName: '', setBandName: () => {} })

export function useProfile() {
  return useContext(ProfileContext)
}
