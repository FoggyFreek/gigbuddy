import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'

interface Invite {
  id?: Id
  code?: string
  email?: string
  role?: string
  created_at?: string
  expires_at?: string
  redeemed_at?: string
}

interface InvitePayload {
  email?: string
  role?: string
}

export const listInvites = () => request<Invite[]>('/api/invites')
export const createInvite = (payload: InvitePayload) =>
  request<Invite>('/api/invites', { method: 'POST', body: JSON.stringify(payload) })
export const revokeInvite = (id: Id) =>
  request<void>(`/api/invites/${id}`, { method: 'DELETE' })
export const redeemInvite = (code: string) =>
  request<{ tenant_id?: Id }>('/api/invites/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
