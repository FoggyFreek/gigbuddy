import { request } from './_client.ts'
import type { Slot, Id } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/availability${path}`, options)

export const listAvailability = ({ from, to }: { from: string; to: string }) =>
  api<Slot[]>(`/?from=${from}&to=${to}`)
export const createSlot = (body: Partial<Slot>) =>
  api<Slot>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateSlot = (id: Id, body: Partial<Slot>) =>
  api<Slot>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSlot = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
export const getAvailabilityOn = (dateStr: string) => api<Slot[]>(`/on/${dateStr}`)
