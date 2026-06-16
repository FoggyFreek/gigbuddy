import { useMemo } from 'react'
import { useAuth } from '../contexts/authContext.ts'
import {
  hasPermission as matrixHasPermission,
  PERMISSIONS,
  type Permission,
} from '../auth/permissions.ts'

export interface PermissionsApi {
  can: (key: Permission) => boolean
  role: string | null
  isSuperAdmin: boolean
  canWritePlanning: boolean
  canViewFinance: boolean
  canManageFinance: boolean
  canManageMembers: boolean
  canManageTenant: boolean
  canCreatePurchase: boolean
}

// Capability helper for the active tenant. Prefers the permission list the
// server put on /auth/me; falls back to the local matrix (e.g. before refresh).
export function usePermissions(): PermissionsApi {
  const { user } = useAuth()

  return useMemo(() => {
    const isSuperAdmin = !!user?.isSuperAdmin
    const role = user?.activeTenantRole ?? null
    const granted = user?.permissions

    const can = (key: Permission): boolean => {
      if (isSuperAdmin) return true
      if (granted) return granted.includes(key)
      return matrixHasPermission(role, key, { isSuperAdmin })
    }

    return {
      can,
      role,
      isSuperAdmin,
      canWritePlanning: can(PERMISSIONS.PLANNING_WRITE),
      canViewFinance: can(PERMISSIONS.FINANCE_VIEW),
      canManageFinance: can(PERMISSIONS.FINANCE_MANAGE),
      canManageMembers: can(PERMISSIONS.MEMBERS_MANAGE),
      canManageTenant: can(PERMISSIONS.TENANT_MANAGE),
      canCreatePurchase: can(PERMISSIONS.PURCHASE_CREATE),
    }
  }, [user])
}
