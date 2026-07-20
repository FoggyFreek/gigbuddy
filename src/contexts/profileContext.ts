import { createContext, useContext } from 'react'

export interface ProfileContextValue {
  bandName: string
  setBandName: (name: string) => void
  accentColor: string | null
  setAccentColor: (color: string | null) => void
  /** The active tenant's VAT country (ISO alpha-2, lowercase). Drives rate menus. */
  vatCountry: string
  /** The tenant's default VAT rate, snapped to a rate valid for its country. */
  defaultVatRate: number
  /** Reflect a profile edit into the context (country and/or default VAT %). */
  setVatSettings: (vatCountry: string, taxPercentage: number) => void
}

export const ProfileContext = createContext<ProfileContextValue>({
  bandName: '',
  setBandName: () => {},
  accentColor: null,
  setAccentColor: () => {},
  vatCountry: 'nl',
  defaultVatRate: 21,
  setVatSettings: () => {},
})

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext)
}
