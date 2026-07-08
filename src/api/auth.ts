import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'

interface CurrentUser {
  id?: Id
  name?: string
  email?: string
  is_super_admin?: boolean
  active_tenant_id?: Id
  memberships?: Array<{
    tenant_id?: Id
    band_name?: string
    role?: string
    status?: string
  }>
}

export type AuthProvider = 'google' | 'microsoft'

export const getCurrentUser = () => request<CurrentUser>('/api/auth/me')
export const unlinkProvider = (provider: AuthProvider) =>
  request<void>(`/api/auth/link/${provider}/unlink`, { method: 'POST' })
export const logout = () => request<void>('/api/auth/logout', { method: 'POST' })
export const setActiveTenant = (tenantId: Id) =>
  request<void>('/api/auth/active-tenant', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  })
export const acceptTerms = (version: string) =>
  request<{ termsAcceptedAt: string; termsVersion: string }>('/api/auth/accept-terms', {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
export const onboardingComplete = () =>
  request<void>('/api/auth/onboarding-complete', { method: 'POST' })
