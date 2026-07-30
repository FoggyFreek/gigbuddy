import { createContext, useContext, useMemo } from 'react'
import { DEFAULT_VAT_COUNTRY, getStandardVatRate } from '../../shared/vatRates.js'
import type { AccountingProfile } from '../types/entities.ts'

export interface AccountingProfileState {
  /** The active tenant's accounting regime, or null while loading / unavailable. */
  profile: AccountingProfile | null
  loading: boolean
  /** Publishes a server-returned profile so every consumer sees one shared value. */
  applyProfile: (profile: AccountingProfile) => void
}

export interface AccountingProfileContextValue extends AccountingProfileState {
  /** Accounting country (ISO alpha-2, lowercase). Drives the VAT rate menus. */
  accountingCountry: string
  /** Default VAT rate for new invoice and purchase lines. */
  defaultVatRate: number
}

// Kept separate from ProfileContext (the band profile) on purpose: this record is
// the accounting regime finance behavior is driven from.
export const AccountingProfileContext = createContext<AccountingProfileState>({
  profile: null,
  loading: true,
  applyProfile: () => {},
})

// The two derived values live here rather than in the provider so there is one
// owner of the derivation, and so the app default is only reached while the
// profile is loading or unavailable.
export function useAccountingProfile(): AccountingProfileContextValue {
  const state = useContext(AccountingProfileContext)
  const country = state.profile?.country_code ?? DEFAULT_VAT_COUNTRY
  const rate = state.profile?.default_vat_rate ?? getStandardVatRate(country)
  return useMemo(
    () => ({ ...state, accountingCountry: country, defaultVatRate: rate }),
    [state, country, rate],
  )
}
