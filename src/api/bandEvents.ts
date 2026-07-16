import { request } from './_client.ts'
import type { BandEvent, Id } from '../types/entities.ts'
import type { LimitedCollectionResponse, LimitedCollectionWithCursorResponse, ListCollectionCursor, WindowedCollectionResponse } from '../types/api.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/band-events${path}`, options)

export const listBandEvents = () => api<BandEvent[]>('/')
export const listUpcomingBandEvents = (limit: number, today: string) =>
  api<LimitedCollectionResponse<BandEvent>>(`/upcoming?${new URLSearchParams({ limit: String(limit), today })}`)
export const listPastBandEvents = (limit: number, today: string, cursor?: ListCollectionCursor) => {
  const params = new URLSearchParams({ limit: String(limit), today })
  if (cursor) {
    params.set('cursorDate', cursor.date)
    params.set('cursorId', String(cursor.id))
  }
  return api<LimitedCollectionWithCursorResponse<BandEvent>>(`/past?${params}`)
}
export const listBandEventsInRange = ({ from, to }: { from: string; to: string }) =>
  api<WindowedCollectionResponse<BandEvent>>(`/range?${new URLSearchParams({ from, to })}`)
export const getBandEvent = (id: Id) => api<BandEvent>(`/${id}`)
export const createBandEvent = (body: Partial<BandEvent>) =>
  api<BandEvent>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateBandEvent = (id: Id, body: Partial<BandEvent>) =>
  api<BandEvent>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteBandEvent = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
