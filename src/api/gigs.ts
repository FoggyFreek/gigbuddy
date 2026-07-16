import { request, requestForm } from './_client.ts'
import type { Gig, GigMerchSummary, GigTag, Id, Task } from '../types/entities.ts'
import type { GigMapGig, LimitedCollectionWithTotalResponse, WindowedCollectionResponse } from '../types/api.ts'

interface GigParticipant {
  band_member_id?: Id
  vote?: string
}

interface GigContact {
  contact_id?: Id
  is_primary?: boolean
}

interface GigAttachment {
  id?: Id
  original_filename?: string
  object_key?: string
  content_type?: string
  file_size?: number
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/gigs${path}`, options)

export const listGigs = () => api<Gig[]>('/')
export const listUpcomingGigs = (limit: number, today: string) =>
  api<LimitedCollectionWithTotalResponse<Gig>>(`/upcoming?${new URLSearchParams({ limit: String(limit), today })}`)
export const listGigsInRange = ({ from, to }: { from: string; to: string }) =>
  api<WindowedCollectionResponse<Gig>>(`/range?${new URLSearchParams({ from, to })}`)
export const listGigMapData = ({ from, to }: { from: string; to: string }) =>
  api<WindowedCollectionResponse<GigMapGig>>(`/map?${new URLSearchParams({ from, to })}`)
export const searchGigs = (q: string) =>
  api<Gig[]>(`/search?${new URLSearchParams({ q })}`)
export const searchGigTags = (q: string) =>
  api<GigTag[]>(`/tags?${new URLSearchParams({ q: q ?? '' })}`)
export const setGigTags = (id: Id, tags: string[]) =>
  api<GigTag[]>(`/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tags }) })
export const getGig = (id: Id, opts?: RequestInit) => api<Gig>(`/${id}`, opts)
export const getGigMerchSummary = (id: Id, opts?: RequestInit) =>
  api<GigMerchSummary>(`/${id}/merch-summary`, opts)
export const createGig = (body: Partial<Gig>) =>
  api<Gig>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateGig = (id: Id, body: Partial<Gig>) =>
  api<Gig>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteGig = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
export const importGigs = (rows: Partial<Gig>[]) =>
  api<Gig[]>('/import', { method: 'POST', body: JSON.stringify(rows) })

export const createTask = (gigId: Id, body: Partial<Task>) =>
  api<Task>(`/${gigId}/tasks`, { method: 'POST', body: JSON.stringify(body) })
export const updateTask = (gigId: Id, taskId: Id, body: Partial<Task>) =>
  api<Task>(`/${gigId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteTask = (gigId: Id, taskId: Id) =>
  api<void>(`/${gigId}/tasks/${taskId}`, { method: 'DELETE' })

export const uploadGigBanner = (gigId: Id, file: File) => {
  const fd = new FormData()
  fd.append('banner', file, 'banner.png')
  return requestForm<Gig>(`/api/gigs/${gigId}/banner`, fd)
}
export const deleteGigBanner = (gigId: Id) =>
  request<void>(`/api/gigs/${gigId}/banner`, { method: 'DELETE' })

export const uploadGigAttachment = (gigId: Id, file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return requestForm<GigAttachment>(`/api/gigs/${gigId}/attachments`, fd)
}
export const deleteGigAttachment = (gigId: Id, attachmentId: Id) =>
  request<void>(`/api/gigs/${gigId}/attachments/${attachmentId}`, { method: 'DELETE' })

export const addGigParticipant = (gigId: Id, bandMemberId: Id) =>
  api<GigParticipant>(`/${gigId}/participants`, {
    method: 'POST',
    body: JSON.stringify({ band_member_id: bandMemberId }),
  })
export const removeGigParticipant = (gigId: Id, bandMemberId: Id) =>
  api<void>(`/${gigId}/participants/${bandMemberId}`, { method: 'DELETE' })
export const setGigVote = (gigId: Id, bandMemberId: Id, vote: string) =>
  api<GigParticipant>(`/${gigId}/participants/${bandMemberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ vote }),
  })

export const listGigContacts = (gigId: Id) => api<GigContact[]>(`/${gigId}/contacts`)
export const addGigContact = (gigId: Id, contactId: Id) =>
  api<GigContact>(`/${gigId}/contacts`, {
    method: 'POST',
    body: JSON.stringify({ contact_id: contactId }),
  })
export const setGigContactPrimary = (gigId: Id, contactId: Id, isPrimary: boolean) =>
  api<GigContact>(`/${gigId}/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_primary: isPrimary }),
  })
export const removeGigContact = (gigId: Id, contactId: Id) =>
  api<void>(`/${gigId}/contacts/${contactId}`, { method: 'DELETE' })
