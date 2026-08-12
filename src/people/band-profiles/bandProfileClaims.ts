import { request } from '../../api/_client.ts'
import type { BandProfileClaim, Id } from '../../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/band-profile-claims${path}`, options)

/** A band sees only its own claim — never the queue, never who else wants the profile. */
export const getOwnClaim = () => api<{ claim: BandProfileClaim | null }>('/')

export const requestClaim = (bandProfileId: Id, message?: string) =>
  api<BandProfileClaim>('/', {
    method: 'POST',
    body: JSON.stringify({ bandProfileId, message: message || null }),
  })

export const withdrawClaim = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
