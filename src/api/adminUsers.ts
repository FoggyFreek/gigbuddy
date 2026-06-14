import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'

interface AdminUser {
  id?: Id
  name?: string
  email?: string
  is_super_admin?: boolean
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/admin/users${path}`, options)

export const listAllUsers = () => api<AdminUser[]>('/')
export const deleteUserGlobal = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
