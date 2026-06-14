import { request } from './_client.ts'
import type { Member, Id } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/band-members${path}`, options)

export const listMembers = () => api<Member[]>('/')
export const createMember = (body: Partial<Member>) =>
  api<Member>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateMember = (id: Id, body: Partial<Member>) =>
  api<Member>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteMember = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
