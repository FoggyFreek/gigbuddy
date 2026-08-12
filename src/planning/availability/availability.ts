import { request } from '../../api/_client.ts'
import type { AvailabilitySummary, Slot, Id } from '../../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/availability${path}`, options)

export const listAvailability = ({ from, to }: { from: string; to: string }) =>
  api<Slot[]>(`/?from=${from}&to=${to}`)
export const createSlot = (body: Partial<Slot>) =>
  api<Slot>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateSlot = (id: Id, body: Partial<Slot>) =>
  api<Slot>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSlot = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
export const getAvailabilityOn = (dateStr: string) => api<AvailabilitySummary>(`/on/${dateStr}`)
export const getAvailabilitySpan = (from: string, to: string) =>
  api<AvailabilitySummary>(`/span?${new URLSearchParams({ from, to })}`)

export interface EventAvailabilityRequest {
  event_type: 'gig' | 'rehearsal' | 'band_event'
  event_id?: Id
  start_date: string
  end_date?: string | null
  start_time?: string | null
  end_time?: string | null
  participant_ids?: Id[]
}

export const evaluateEventAvailability = (body: EventAvailabilityRequest) =>
  api<AvailabilitySummary>('/evaluate', { method: 'POST', body: JSON.stringify(body) })
