import { useMemo } from 'react'
import { useAuth } from '../contexts/authContext.ts'
import { DEFAULT_TENANT_KIND, type TenantKind } from '../utils/businessRegistry.ts'
import { tenantKindSupports, type TenantCapability } from '../auth/tenantCapabilities.ts'

export interface TenantKindApi {
  /** Kind of the active tenant. Defaults to 'band' before /auth/me resolves. */
  kind: TenantKind
  /** The active tenant is the user's own artist workspace. */
  isPersonal: boolean
  /**
   * Content-level helper for tutorials that intentionally target a kind.
   * Functional applicability should use `supports`.
   */
  allowsKind: (kinds?: readonly TenantKind[]) => boolean
  /** Whether the active tenant supports a genuinely kind-specific capability. */
  supports: (capability: TenantCapability) => boolean
}

// The active tenant's kind, mirroring usePermissions / useEntitlements. Reads
// what the server put on /auth/me, so no extra fetch is needed to branch.
//
// This is UX only. requireTenantCapability on the backend is authoritative.
export function useTenantKind(): TenantKindApi {
  const { user } = useAuth()

  return useMemo(() => {
    const kind = user?.activeTenantKind ?? DEFAULT_TENANT_KIND
    return {
      kind,
      isPersonal: kind === 'personal',
      allowsKind: (kinds?: readonly TenantKind[]) => !kinds || kinds.includes(kind),
      supports: (capability: TenantCapability) => tenantKindSupports(kind, capability),
    }
  }, [user])
}
