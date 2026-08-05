import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'

/** How the caller stands with a band found in the directory. */
export type DirectoryMembershipStatus = 'none' | 'pending' | 'approved' | 'rejected'

export interface DirectoryBand {
  id: Id
  slug: string
  displayName: string
  logoPath: string | null
  membershipStatus: DirectoryMembershipStatus
}

export interface JoinRequest {
  tenantId: Id
  slug: string
  displayName: string
  requestMessage: string | null
  createdAt: string
}

export interface JoinRequestResult {
  tenant: { id: Id; slug: string; displayName: string }
  status: 'pending'
}

// Bands that opted into being findable. A band that hasn't is invisible here
// and 404s on join — the server never says which.
export const searchBands = (q: string) =>
  request<{ items: DirectoryBand[]; meta: { limit: number } }>(
    `/api/band-directory/search?q=${encodeURIComponent(q)}`,
  )

export const listJoinRequests = () =>
  request<{ items: JoinRequest[] }>('/api/band-directory/join-requests')

/** `requestMessage` is optional; the role is fixed server-side. */
export const requestToJoinBand = (tenantId: Id, requestMessage?: string) =>
  request<JoinRequestResult>('/api/band-directory/join-requests', {
    method: 'POST',
    body: JSON.stringify({ tenantId, requestMessage }),
  })

export const withdrawJoinRequest = (tenantId: Id) =>
  request<void>(`/api/band-directory/join-requests/${tenantId}`, { method: 'DELETE' })
