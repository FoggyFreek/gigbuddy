import { request } from './_client.ts'
import type { Journal, Id } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/journal${path}`, options)

export const listJournals = () => api<Journal[]>('/')
export const getJournal = (id: Id) => api<Journal>(`/${id}`)
export const createJournal = (body: Partial<Journal>) =>
  api<Journal>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateJournal = (id: Id, body: Partial<Journal>) =>
  api<Journal>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteJournal = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })

export const approveJournal = (id: Id) =>
  api<Journal>(`/${id}/approve`, { method: 'POST' })
interface ApproveResult {
  id: Id
  ok: boolean
  message?: string
}

export const approveJournals = (ids: Id[]) =>
  api<{ results: ApproveResult[] }>('/approve', { method: 'POST', body: JSON.stringify({ ids }) })
