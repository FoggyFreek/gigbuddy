import { useMemo } from 'react'
import { useAuth } from '../contexts/authContext.ts'
import type { Feature, LimitKey, LimitValue, UserEntitlements } from '../auth/entitlements.ts'

export interface EntitlementsApi {
  /** Resolved entitlements for the active tenant, or null when the tenant has no owner. */
  entitlements: UserEntitlements | null
  /** True when the tenant has no owner: enforcement is fully skipped (legacy). */
  unenforced: boolean
  /** Whether a feature is enabled. Unenforced tenants allow everything. */
  has: (feature: Feature) => boolean
  /** The numeric limit for a key (null = unlimited), or null when unenforced. */
  limit: (key: LimitKey) => LimitValue
  /** The owner has no usable subscription right now (fallback-locked). */
  locked: boolean
  /** Finance is present but write-locked (downgrade read-only mode). */
  financeReadOnly: boolean
  planSlug: string | null
}

// Entitlement helper for the active tenant, mirroring usePermissions. Reads the
// resolved entitlements the server put on /auth/me. A null payload means the
// tenant is ownerless — enforcement is skipped, so everything is allowed.
export function useEntitlements(): EntitlementsApi {
  const { user } = useAuth()

  return useMemo(() => {
    const entitlements = user?.entitlements ?? null
    const unenforced = entitlements === null

    return {
      entitlements,
      unenforced,
      has: (feature: Feature) => (unenforced ? true : Boolean(entitlements?.flags[feature])),
      limit: (key: LimitKey) => (unenforced ? null : entitlements?.limits[key] ?? null),
      locked: Boolean(entitlements?.locked),
      financeReadOnly: Boolean(entitlements?.financeReadOnly),
      planSlug: entitlements?.planSlug ?? null,
    }
  }, [user])
}
