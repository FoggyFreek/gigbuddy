import { request } from './_client.ts'
import type { Tenant, Id } from '../types/entities.ts'

interface MembershipPayload {
  user_id?: Id
  role?: string
  status?: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/admin/tenants${path}`, options)

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
