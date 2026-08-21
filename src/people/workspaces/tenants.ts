import { request } from '../../api/_client.ts'
import type { Tenant, Id } from '../../types/entities.ts'

interface MembershipPayload {
  userId?: Id
  role?: string
  status?: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/admin/tenants${path}`, options)

// ---- self-service (user-level, /api/tenants) ----

export interface CreateOwnedTenantPayload {
  band_name: string
  /**
   * Accounting country (ISO alpha-2, lowercase). Required — the server never
   * defaults it, and it is immutable once the band exists.
   */
  country_code: string
  /** Omitted → the server generates a slug from band_name (deduped). */
  slug?: string
  /** Marks the tenant as the caller's onboarding resume pointer. */
  onboarding?: boolean
}

export const createOwnedTenant = (payload: CreateOwnedTenantPayload) =>
  request<Tenant>('/api/tenants', { method: 'POST', body: JSON.stringify(payload) })

export interface CreatePersonalTenantPayload {
  /** Accounting country (ISO alpha-2, lowercase). Required, never defaulted. */
  country_code: string
  /** Omitted → named after the caller's own display name. */
  display_name?: string
  /** Marks the workspace as the caller's onboarding resume pointer. */
  onboarding?: boolean
}

/**
 * The caller's own artist workspace. Idempotent server-side: calling it again
 * returns the existing workspace rather than creating a second.
 */
export const createPersonalTenant = (payload: CreatePersonalTenantPayload) =>
  request<Tenant>('/api/tenants/personal', { method: 'POST', body: JSON.stringify(payload) })

export const listOwnedTenants = () => request<Tenant[]>('/api/tenants/owned')

export interface DeleteManagedTenantPayload {
  confirmationName: string
  acknowledged: true
}

export const deleteManagedTenant = (id: Id, payload: DeleteManagedTenantPayload) =>
  request<void>(`/api/tenants/${id}`, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  })

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

export interface TenantSlugResponse {
  slug: string
  linkpageSync?: 'synced' | 'pending'
}

export const updateActiveTenantSlug = (slug: string) =>
  request<TenantSlugResponse>('/api/tenant/slug', {
    method: 'PATCH',
    body: JSON.stringify({ slug }),
  })

export type InvoiceMode = 'combined' | 'specified'

export interface TenantInvoiceModeResponse {
  preferred_invoice_mode: InvoiceMode
}

export const getTenantInvoiceMode = () =>
  request<TenantInvoiceModeResponse>('/api/tenant/invoice-mode')

export const updateTenantInvoiceMode = (preferredInvoiceMode: InvoiceMode) =>
  request<TenantInvoiceModeResponse>('/api/tenant/invoice-mode', {
    method: 'PATCH',
    body: JSON.stringify({ preferred_invoice_mode: preferredInvoiceMode }),
  })

export const listTenants = () => api<Tenant[]>('/')
export const getTenant = (id: Id) => api<Tenant>(`/${id}`)
export interface CreateTenantPayload extends Partial<Tenant> {
  /** Accounting country. Required on this path too — no silent default. */
  country_code: string
}

export const createTenant = (payload: CreateTenantPayload) =>
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
