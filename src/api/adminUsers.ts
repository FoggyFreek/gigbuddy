import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'

export interface AdminUserMembership {
  tenant_id?: Id
  tenant_slug?: string
  role?: string
  status?: string
}

export interface AdminUser {
  id?: Id
  name?: string
  email?: string
  is_super_admin?: boolean
  memberships?: AdminUserMembership[]
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/admin/users${path}`, options)

export const listAllUsers = () => api<AdminUser[]>('/')
export const deleteUserGlobal = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
