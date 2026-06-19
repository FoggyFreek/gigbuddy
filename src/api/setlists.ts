import { request } from './_client.ts'
import type { Setlist, SetlistSet, SetlistItem, Id } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/setlists${path}`, options)

export const listSetlists = () => api<Setlist[]>('/')
export const searchSetlists = (q: string) =>
  api<Setlist[]>(`/search?${new URLSearchParams({ q })}`)
export const getSetlist = (id: Id) => api<Setlist>(`/${id}`)
export const createSetlist = (body: Partial<Setlist>) =>
  api<Setlist>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateSetlist = (id: Id, body: Partial<Setlist>) =>
  api<Setlist>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSetlist = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })

export const addSet = (id: Id, body: Partial<SetlistSet>) =>
  api<SetlistSet>(`/${id}/sets`, { method: 'POST', body: JSON.stringify(body) })
export const updateSet = (id: Id, setId: Id, body: Partial<SetlistSet>) =>
  api<SetlistSet>(`/${id}/sets/${setId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSet = (id: Id, setId: Id) =>
  api<void>(`/${id}/sets/${setId}`, { method: 'DELETE' })
export const reorderSets = (id: Id, orderedSetIds: Id[]) =>
  api<void>(`/${id}/sets/reorder`, { method: 'PATCH', body: JSON.stringify({ orderedSetIds }) })

export const addItem = (id: Id, setId: Id, body: Partial<SetlistItem>) =>
  api<SetlistItem>(`/${id}/sets/${setId}/items`, { method: 'POST', body: JSON.stringify(body) })
export const updateItem = (id: Id, itemId: Id, body: Partial<SetlistItem>) =>
  api<SetlistItem>(`/${id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteItem = (id: Id, itemId: Id) =>
  api<void>(`/${id}/items/${itemId}`, { method: 'DELETE' })
export const saveItemNote = (id: Id, itemId: Id, note: string) =>
  api<void>(`/${id}/items/${itemId}/note`, { method: 'PUT', body: JSON.stringify({ note }) })
export const reorderItems = (id: Id, sets: unknown[]) =>
  api<void>(`/${id}/items/reorder`, { method: 'PATCH', body: JSON.stringify({ sets }) })
