import { useMemo } from 'react'
import { useAuth } from '../contexts/authContext.ts'
import { DEFAULT_TENANT_KIND, type TenantKind } from '../utils/businessRegistry.ts'

export interface TenantKindApi {
  /** Kind of the active tenant. Defaults to 'band' before /auth/me resolves. */
  kind: TenantKind
  /** The active tenant is the user's own artist workspace. */
  isPersonal: boolean
  /**
   * Whether a surface restricted to `kinds` applies here. An entry without a
   * `kinds` list is kind-neutral and always applies — the default, per the
   * kind-neutral vocabulary rule.
   */
  allowsKind: (kinds?: readonly TenantKind[]) => boolean
}

// The active tenant's kind, mirroring usePermissions / useEntitlements. Reads
// what the server put on /auth/me, so no extra fetch is needed to branch.
//
// This is UX only: hiding a band-only surface in a personal workspace is a
// convenience — requireTenantKind on the router is the authoritative gate.
export function useTenantKind(): TenantKindApi {
  const { user } = useAuth()

  return useMemo(() => {
    const kind = user?.activeTenantKind ?? DEFAULT_TENANT_KIND
    return {
      kind,
      isPersonal: kind === 'personal',
      allowsKind: (kinds?: readonly TenantKind[]) => !kinds || kinds.includes(kind),
    }
  }, [user])
}
