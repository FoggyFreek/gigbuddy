import { request } from './_client.ts'
import type { BandEvent, Id } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/band-events${path}`, options)

export const listBandEvents = () => api<BandEvent[]>('/')
export const getBandEvent = (id: Id) => api<BandEvent>(`/${id}`)
export const createBandEvent = (body: Partial<BandEvent>) =>
  api<BandEvent>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateBandEvent = (id: Id, body: Partial<BandEvent>) =>
  api<BandEvent>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteBandEvent = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
