import { createContext, useContext } from 'react'
import type { Id } from '../types/entities.ts'

export interface UserMembership {
  tenantId?: Id
  tenantName?: string
  tenantSlug?: string
  role?: string
  status?: string
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
  bandMemberId?: Id | null
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
