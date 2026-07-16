import { request } from './_client.ts'
import type { Rehearsal, Id } from '../types/entities.ts'
import type { LimitedCollectionResponse, LimitedCollectionWithCursorResponse, ListCollectionCursor, WindowedCollectionResponse } from '../types/api.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/rehearsals${path}`, options)

export const listRehearsals = () => api<Rehearsal[]>('/')
export const getNextRehearsal = () => api<Rehearsal | null>('/next')
export const listUpcomingRehearsals = (limit: number, today: string) =>
  api<LimitedCollectionResponse<Rehearsal>>(`/upcoming?${new URLSearchParams({ limit: String(limit), today })}`)
export const listPastRehearsals = (limit: number, today: string, cursor?: ListCollectionCursor) => {
  const params = new URLSearchParams({ limit: String(limit), today })
  if (cursor) {
    params.set('cursorDate', cursor.date)
    params.set('cursorId', String(cursor.id))
  }
  return api<LimitedCollectionWithCursorResponse<Rehearsal>>(`/past?${params}`)
}
export const listRehearsalsInRange = ({ from, to }: { from: string; to: string }) =>
  api<WindowedCollectionResponse<Rehearsal>>(`/range?${new URLSearchParams({ from, to })}`)
export const getRehearsal = (id: Id) => api<Rehearsal>(`/${id}`)
export const createRehearsal = (body: Partial<Rehearsal>) =>
  api<Rehearsal>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateRehearsal = (id: Id, body: Partial<Rehearsal>) =>
  api<Rehearsal>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteRehearsal = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })

export const addParticipant = (id: Id, bandMemberId: Id) =>
  api<Rehearsal>(`/${id}/participants`, {
    method: 'POST',
    body: JSON.stringify({ band_member_id: bandMemberId }),
  })
export const removeParticipant = (id: Id, bandMemberId: Id) =>
  api<void>(`/${id}/participants/${bandMemberId}`, { method: 'DELETE' })
export const setVote = (id: Id, bandMemberId: Id, vote: string) =>
  api<Rehearsal>(`/${id}/participants/${bandMemberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ vote }),
  })

export const addSong = (id: Id, songId: Id) =>
  api<Rehearsal>(`/${id}/songs`, {
    method: 'POST',
    body: JSON.stringify({ song_id: songId }),
  })
export const removeSong = (id: Id, songId: Id) =>
  api<void>(`/${id}/songs/${songId}`, { method: 'DELETE' })
