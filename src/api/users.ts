import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'

interface Membership {
  user_id?: Id
  user_name?: string
  user_email?: string
  role?: string
  status?: string
  band_member_id?: Id
  band_member_name?: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/users${path}`, options)

export const listMemberships = () => api<Membership[]>('/')
export const updateMembership = (userId: Id, patch: Partial<Membership>) =>
  api<Membership>(`/${userId}/membership`, { method: 'PATCH', body: JSON.stringify(patch) })
export const updateMembershipBandMember = (userId: Id, band_member_id: Id) =>
  api<Membership>(`/${userId}/band-member`, {
    method: 'PATCH',
    body: JSON.stringify({ band_member_id }),
  })
export const removeMembership = (userId: Id) => api<void>(`/${userId}`, { method: 'DELETE' })
