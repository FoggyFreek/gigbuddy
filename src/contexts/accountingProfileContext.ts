import { createContext, useContext } from 'react'
import type { AccountingProfile } from '../types/entities.ts'

export interface AccountingProfileContextValue {
  /** The active tenant's accounting regime, or null while loading / unavailable. */
  profile: AccountingProfile | null
  loading: boolean
  /** Publishes a server-returned profile so every consumer sees one shared value. */
  applyProfile: (profile: AccountingProfile) => void
}

// Kept separate from ProfileContext (the band profile) on purpose: this record is
// the accounting regime that finance behavior will be driven from, and merging the
// two would only have to be undone later.
export const AccountingProfileContext = createContext<AccountingProfileContextValue>({
  profile: null,
  loading: true,
  applyProfile: () => {},
})

export function useAccountingProfile(): AccountingProfileContextValue {
  return useContext(AccountingProfileContext)
}
