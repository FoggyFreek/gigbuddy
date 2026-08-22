import { request } from '../../api/_client.ts'
import type { Id, VenueGroup } from '../../types/entities.ts'
import type { LimitedCollectionResponse } from '../../types/api.ts'

interface MembershipResult {
  added_count: number
  already_present_count: number
}

interface CreateGroupResult extends MembershipResult {
  group: VenueGroup
}

interface RemoveMembershipResult {
  removed_count: number
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/venue-groups${path}`, options)

export function listVenueGroups(q = '', limit = 10, options: Pick<RequestInit, 'signal'> = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (q.trim()) params.set('q', q.trim())
  return api<LimitedCollectionResponse<VenueGroup>>(`/?${params}`, { signal: options.signal })
}

export const createVenueGroup = (name: string, venueIds: Id[]) =>
  api<CreateGroupResult>('/', {
    method: 'POST',
    body: JSON.stringify({ name, venue_ids: venueIds }),
  })

export const renameVenueGroup = (groupId: Id, name: string) =>
  api<VenueGroup>(`/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })

export const deleteVenueGroup = (groupId: Id) =>
  api<void>(`/${groupId}`, { method: 'DELETE' })

export const addVenueGroupMembers = (groupId: Id, venueIds: Id[]) =>
  api<MembershipResult>(`/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ venue_ids: venueIds }),
  })

export const removeVenueGroupMembers = (groupId: Id, venueIds: Id[]) =>
  api<RemoveMembershipResult>(`/${groupId}/members`, {
    method: 'DELETE',
    body: JSON.stringify({ venue_ids: venueIds }),
  })
