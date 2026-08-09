import { request } from '../_client.ts'
import type { BandProfileClaim, ClaimStatus, Id } from '../../types/entities.ts'
import type { TenantKind } from '../../utils/businessRegistry.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/admin/band-profile-claims${path}`, options)

export interface AdminClaimTenant {
  id: Id
  slug: string
  displayName: string
  kind: TenantKind | null
  archived: boolean
}

export interface AdminClaimProfile {
  id: Id
  name: string
  countryCode: string
  spotifyUrl: string | null
  websiteUrl: string | null
  contactEmail: string | null
}

export interface AdminBandProfileClaim extends BandProfileClaim {
  tenant: AdminClaimTenant
  requestedBy: { email: string; name: string | null } | null
  /** Null once the profile has been deleted; the claim outlives it. */
  bandProfile: AdminClaimProfile | null
}

/**
 * Keyed on (created_at, id), so the cursor is an opaque token rather than a
 * date: several claims land on one calendar day, and a day-granular cursor
 * would skip or repeat them at every page boundary.
 */
export const listClaimQueue = (params: { status?: ClaimStatus; limit?: number; cursor?: string | null } = {}) => {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.cursor) qs.set('cursor', params.cursor)
  return api<{ items: AdminBandProfileClaim[]; meta: { limit: number; returned: number; nextCursor: string | null } }>(`/?${qs}`)
}

export const approveClaim = (id: Id) =>
  api<{ claim: BandProfileClaim; profileDeleted: boolean }>(`/${id}/approve`, { method: 'POST', body: '{}' })

/** A reason is required: a rejection without one is unactionable for the band. */
export const rejectClaim = (id: Id, reason: string) =>
  api<{ claim: BandProfileClaim }>(`/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
