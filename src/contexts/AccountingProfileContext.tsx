import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AccountingProfileContext } from './accountingProfileContext.ts'
import { getAccountingProfile } from '../finance/accounting-profile/accountingProfile.ts'
import { useAuth } from './authContext.ts'
import type { AccountingProfile, Id } from '../types/entities.ts'

// What was fetched, and which band it belongs to. Storing the two together lets a
// band switch invalidate the profile by derivation rather than by clearing state
// in an effect — so there is no render in which the previous band's regime is
// still on screen under the new band's name.
interface LoadedProfile {
  tenantId: Id | null
  profile: AccountingProfile | null
}

interface AccountingProfileProviderProps {
  children: ReactNode
}

export function AccountingProfileProvider({ children }: Readonly<AccountingProfileProviderProps>) {
  const { user } = useAuth()
  const activeTenantId = user?.activeTenantId ?? null
  const [loaded, setLoaded] = useState<LoadedProfile | null>(null)

  const isCurrent = loaded !== null && loaded.tenantId === activeTenantId
  const profile = isCurrent ? loaded.profile : null
  const loading = activeTenantId !== null && !isCurrent

  useEffect(() => {
    let cancelled = false
    Promise.resolve(activeTenantId ? getAccountingProfile() : null)
      .then((p) => {
        if (!cancelled) setLoaded({ tenantId: activeTenantId, profile: p })
      })
      .catch(() => {
        // Record the failure against this band so the UI leaves the loading state
        // and can show its unavailable message instead of spinning forever.
        if (!cancelled) setLoaded({ tenantId: activeTenantId, profile: null })
      })
    return () => {
      cancelled = true
    }
  }, [activeTenantId])

  // Keyed on activeTenantId rather than next.tenant_id: a write always targets the
  // active band, and reusing the same key the effect uses keeps the comparison
  // free of any id-type mismatch.
  const applyProfile = useCallback((next: AccountingProfile) => {
    setLoaded({ tenantId: activeTenantId, profile: next })
  }, [activeTenantId])

  const value = useMemo(
    () => ({ profile, loading, applyProfile }),
    [profile, loading, applyProfile],
  )

  return (
    <AccountingProfileContext.Provider value={value}>
      {children}
    </AccountingProfileContext.Provider>
  )
}
