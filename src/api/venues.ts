import { request } from './_client.ts'
import type { Venue, Contact, DuplicateEntityMatch, Id } from '../types/entities.ts'
import type { LimitedCollectionResponse } from '../types/api.ts'

interface VenueCategoryImpact {
  affected_count?: number
  contacts?: Contact[]
}

interface VenueContact {
  contact_id?: Id
  is_primary?: boolean
  contact?: Contact
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/venues${path}`, options)

export const listVenues = () => api<Venue[]>('/')
export const checkVenueDuplicates = (body: {
  organization_name?: string
  street_and_number?: string
  website?: string
  email?: string
}, options: Pick<RequestInit, 'signal'> = {}) => api<LimitedCollectionResponse<DuplicateEntityMatch>>('/duplicate-check', {
  method: 'POST',
  body: JSON.stringify(body),
  signal: options.signal,
})
export const getVenue = (id: Id) => api<Venue>(`/${id}`)
export const createVenue = (body: Partial<Venue>) =>
  api<Venue>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateVenue = (id: Id, body: Partial<Venue>) =>
  api<Venue>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteVenue = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
export const importVenues = (rows: Partial<Venue>[]) =>
  api<Venue[]>('/import', { method: 'POST', body: JSON.stringify(rows) })
export const searchVenues = (q: string, category?: string) => {
  const params = new URLSearchParams({ q })
  if (category) params.set('category', category)
  return api<Venue[]>(`/search?${params}`)
}
export const getVenueCategoryImpact = (id: Id, newCategory: string) =>
  api<VenueCategoryImpact>(`/${id}/category-impact?new_category=${encodeURIComponent(newCategory)}`)

export const listVenueContacts = (id: Id) => api<VenueContact[]>(`/${id}/contacts`)
export const addVenueContact = (id: Id, contactId: Id) =>
  api<VenueContact>(`/${id}/contacts`, {
    method: 'POST',
    body: JSON.stringify({ contact_id: contactId }),
  })
export const setVenueContactPrimary = (id: Id, contactId: Id, isPrimary: boolean) =>
  api<VenueContact>(`/${id}/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_primary: isPrimary }),
  })
export const removeVenueContact = (id: Id, contactId: Id) =>
  api<void>(`/${id}/contacts/${contactId}`, { method: 'DELETE' })
