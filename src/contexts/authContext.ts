import { createContext, useContext } from 'react'
import type { Id } from '../types/entities.ts'
import type { TenantKind } from '../utils/businessRegistry.ts'
import type { UserEntitlements } from '../auth/entitlements.ts'

export interface UserMembership {
  tenantId?: Id
  /** Pre-rename alias of `displayName`; both are emitted until every reader moves. */
  tenantName?: string
  displayName?: string
  tenantSlug?: string
  tenantAvatarPath?: string | null
  kind?: TenantKind
  role?: string
  status?: string
  accountingCountryCode?: string | null
}

/** The authenticated user shape returned by /api/auth/me (camelCase, from buildMePayload). */
export interface User {
  id?: Id
  email?: string
  name?: string
  status?: string
  pictureUrl?: string
  isSuperAdmin?: boolean
  activeTenantId?: Id | null
  activeTenantRole?: string | null
  activeTenantKind?: TenantKind | null
  /** Permission keys for the active tenant, sent by /auth/me (see src/auth/permissions.ts). */
  permissions?: string[]
  bandMemberId?: Id | null
  /** Resolved entitlements for the active tenant; null = ownerless tenant (no enforcement). */
  entitlements?: UserEntitlements | null
  /** Which OIDC identities are linked to this account. */
  providers?: { google: boolean; microsoft: boolean }
  /** When (and which version of) the terms were accepted; null = never. */
  termsAcceptedAt?: string | null
  termsVersion?: string | null
  /** Tenant created mid-onboarding (resume pointer); null once onboarding completed. */
  onboardingTenantId?: Id | null
  /** Tutorial keys this user has dismissed (per-user, global). See src/tutorials. */
  dismissedTutorials?: string[]
  /** Active owned bands against the effective cap from the user's band subscription. */
  bandCapacity?: { used: number; limit: number | null }
  memberships?: UserMembership[]
}

export interface AuthContextValue {
  /** undefined = loading, null = unauthenticated, User = authenticated */
  user: User | null | undefined
  setUser: (user: User | null) => void
  logout: () => Promise<void>
  switchTenant: (tenantId: Id) => Promise<User | null | undefined>
  refreshUser: () => Promise<User | null | undefined>
}

export const AuthContext = createContext<AuthContextValue>({
  user: undefined,
  setUser: () => {},
  logout: async () => {},
  switchTenant: async () => undefined,
  refreshUser: async () => undefined,
})

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}
