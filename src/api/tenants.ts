import { request } from './_client.ts'
import type { Tenant, Id } from '../types/entities.ts'

interface MembershipPayload {
  user_id?: Id
  role?: string
  status?: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/admin/tenants${path}`, options)

// ---- self-service (user-level, /api/tenants) ----

export interface CreateOwnedTenantPayload {
  band_name: string
  /** Omitted → the server generates a slug from band_name (deduped). */
  slug?: string
  /** Marks the tenant as the caller's onboarding resume pointer. */
  onboarding?: boolean
}

export const createOwnedTenant = (payload: CreateOwnedTenantPayload) =>
  request<Tenant>('/api/tenants', { method: 'POST', body: JSON.stringify(payload) })

export const listOwnedTenants = () => request<Tenant[]>('/api/tenants/owned')

export interface TenantOnboardingStatus {
  tenantOnboardingEnabled: boolean
}

export const getTenantOnboardingStatus = () =>
  request<TenantOnboardingStatus>('/api/tenants/onboarding-status')

export const updateTenantOnboardingStatus = (tenantOnboardingEnabled: boolean) =>
  request<TenantOnboardingStatus>('/api/admin/platform-settings/tenant-onboarding', {
    method: 'PATCH',
    body: JSON.stringify({ tenantOnboardingEnabled }),
  })

export const listTenants = () => api<Tenant[]>('/')
export const getTenant = (id: Id) => api<Tenant>(`/${id}`)
export const createTenant = (payload: Partial<Tenant>) =>
  api<Tenant>('/', { method: 'POST', body: JSON.stringify(payload) })
export const updateTenant = (id: Id, patch: Partial<Tenant>) =>
  api<Tenant>(`/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const assignTenantAdmin = (id: Id, userId: Id) =>
  api<void>(`/${id}/admins`, { method: 'POST', body: JSON.stringify({ userId }) })
export const demoteTenantAdmin = (id: Id, userId: Id) =>
  api<void>(`/${id}/admins/${userId}`, { method: 'DELETE' })
export const grantMembership = (id: Id, payload: MembershipPayload) =>
  api<void>(`/${id}/memberships`, { method: 'POST', body: JSON.stringify(payload) })
export const archiveTenant = (id: Id) => api<Tenant>(`/${id}/archive`, { method: 'POST' })
export const unarchiveTenant = (id: Id) => api<Tenant>(`/${id}/unarchive`, { method: 'POST' })
export const deleteTenant = (id: Id, confirmationSlug: string) =>
  api<void>(`/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmationSlug }) })
