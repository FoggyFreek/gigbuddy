import { request } from './_client.ts'
import type { Contact, Venue, Id } from '../types/entities.ts'

interface ContactFilters {
  category?: string
  excludeCategory?: string
}

interface ContactNote {
  id?: Id
  note?: string
  created_at?: string
  created_by?: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/contacts${path}`, options)

export const listContacts = (filters: ContactFilters = {}) => {
  const params = new URLSearchParams()
  if (filters.category) params.set('category', filters.category)
  if (filters.excludeCategory) params.set('excludeCategory', filters.excludeCategory)
  const query = params.toString()
  return api<Contact[]>(query ? `/?${query}` : '/')
}
export const searchContacts = (
  q: string,
  opts: { category?: string; excludeCategory?: string } = {},
) => {
  const params = new URLSearchParams({ q })
  if (opts.category) params.set('category', opts.category)
  if (opts.excludeCategory) params.set('excludeCategory', opts.excludeCategory)
  return api<Contact[]>(`/search?${params}`)
}
export const getContact = (id: Id) => api<Contact>(`/${id}`)
export const createContact = (body: Partial<Contact>) =>
  api<Contact>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateContact = (id: Id, body: Partial<Contact>) =>
  api<Contact>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteContact = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
export const importContacts = (rows: Partial<Contact>[]) =>
  api<Contact[]>('/import', { method: 'POST', body: JSON.stringify(rows) })
export const addContactNote = (id: Id, note: string) =>
  api<ContactNote>(`/${id}/notes`, { method: 'POST', body: JSON.stringify({ note }) })
export const deleteContactNote = (id: Id, noteId: Id) =>
  api<void>(`/${id}/notes/${noteId}`, { method: 'DELETE' })

export const listContactVenues = (id: Id) => api<Venue[]>(`/${id}/venues`)
export const addContactVenue = (id: Id, venueId: Id) =>
  api<void>(`/${id}/venues`, { method: 'POST', body: JSON.stringify({ venue_id: venueId }) })
export const removeContactVenue = (id: Id, venueId: Id) =>
  api<void>(`/${id}/venues/${venueId}`, { method: 'DELETE' })
