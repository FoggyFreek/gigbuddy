import { request } from '../../api/_client.ts'
import type { BandProfile, Id } from '../../types/entities.ts'
import type { LimitedCollectionResponse } from '../../types/api.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/band-profiles${path}`, options)

export interface BandProfileInput {
  name: string
  countryCode: string
  spotifyUrl?: string | null
  websiteUrl?: string | null
  contactEmail?: string | null
}

/**
 * Two independent match inputs, because the dialog needs them at different
 * moments: the artist types a name first, and a website later in the create
 * form. A website hit comes back as an ordinary result flagged `websiteMatch`
 * — a suggestion, never an error.
 */
export interface BandProfileSearchParams {
  q?: string
  website?: string
  limit?: number
}

export const searchBandProfiles = (params: BandProfileSearchParams) => {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.website) qs.set('website', params.website)
  if (params.limit != null) qs.set('limit', String(params.limit))
  return api<LimitedCollectionResponse<BandProfile>>(`/search?${qs}`)
}

export const getBandProfile = (id: Id) => api<BandProfile>(`/${id}`)

export const updateBandProfile = (id: Id, body: Partial<BandProfileInput>) =>
  api<BandProfile>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

// There is deliberately no create call here: a profile is only ever created as
// part of adding it to My Bands (see createMyBand), in one transaction, so an
// unheld global row cannot come into existence.
