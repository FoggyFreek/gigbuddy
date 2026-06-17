import { request } from './_client.ts'
import type { Rehearsal, Id } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/rehearsals${path}`, options)

export const listRehearsals = () => api<Rehearsal[]>('/')
export const getNextRehearsal = () => api<Rehearsal | null>('/next')
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
