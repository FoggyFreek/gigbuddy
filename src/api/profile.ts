import { request, requestForm } from './_client.ts'
import type { Tenant, Id } from '../types/entities.ts'

interface ProfileLink {
  id?: Id
  label?: string
  url?: string
  sort_order?: number
}

interface Profile extends Tenant {
  links?: ProfileLink[]
}

interface MollieKey {
  key_last4?: string
  has_key?: boolean
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/profile${path}`, options)

export const getProfile = () => api<Profile>('/')
export const updateProfile = (body: Partial<Profile>) =>
  api<Profile>('/', { method: 'PATCH', body: JSON.stringify(body) })

export const createLink = (body: Partial<ProfileLink>) =>
  api<ProfileLink>('/links', { method: 'POST', body: JSON.stringify(body) })
export const updateLink = (linkId: Id, body: Partial<ProfileLink>) =>
  api<ProfileLink>(`/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteLink = (linkId: Id) => api<void>(`/links/${linkId}`, { method: 'DELETE' })

export function uploadLogo(file: File) {
  const fd = new FormData()
  fd.append('logo', file)
  return requestForm<{ logo_path: string | null }>('/api/profile/logo', fd)
}

export function uploadBanner(file: File) {
  const fd = new FormData()
  fd.append('banner', file)
  return requestForm<{ banner_path: string | null }>('/api/profile/banner', fd)
}

export function uploadAvatar(file: File) {
  const fd = new FormData()
  fd.append('avatar', file)
  return requestForm<{ avatar_path: string | null }>('/api/profile/avatar', fd)
}

export function uploadLogoDark(file: File) {
  const fd = new FormData()
  fd.append('logo_dark', file)
  return requestForm<{ logo_dark_path: string | null }>('/api/profile/logo-dark', fd)
}

export const getMollieKey = () => api<MollieKey>('/mollie-key')
export const setMollieKey = (key: string) =>
  api<void>('/mollie-key', { method: 'PUT', body: JSON.stringify({ key }) })
export const clearMollieKey = () => api<void>('/mollie-key', { method: 'DELETE' })
