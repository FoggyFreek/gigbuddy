import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../contexts/authContext.ts'
import type { Id } from '../types/entities.ts'

/**
 * Opens a row that may belong to another band. The cross-tenant reads under
 * `/api/me` span every band the caller plays in, but every *detail* page is
 * tenant-scoped — so reaching one means switching the active tenant first.
 *
 * Returns `(tenantId, path) => Promise<void>`. A target already in the active
 * tenant navigates straight there; a failed switch navigates nowhere, leaving
 * the user where they were rather than on a page that would 404.
 */
export function useCrossTenantNavigate() {
  const { user, switchTenant } = useAuth()
  const navigate = useNavigate()
  const activeTenantId = user?.activeTenantId

  return useCallback(async (tenantId: Id | null | undefined, path: string) => {
    if (tenantId != null && activeTenantId !== tenantId) {
      try {
        await switchTenant(tenantId)
      } catch {
        return
      }
    }
    navigate(path)
  }, [activeTenantId, switchTenant, navigate])
}
