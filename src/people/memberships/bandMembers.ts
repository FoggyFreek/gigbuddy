import { request } from '../../api/_client.ts'
import type { BandMemberInput, Member, Id } from '../../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/band-members${path}`, options)

export const listMembers = () => api<Member[]>('/')
export const createMember = (body: BandMemberInput) =>
  api<Member>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateMember = (id: Id, body: Partial<BandMemberInput>) =>
  api<Member>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteMember = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
