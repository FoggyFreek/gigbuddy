import { request } from '../../api/_client.ts'
import type { Id } from '../../types/entities.ts'
import type { WindowedCollectionResponse } from '../../types/api.ts'

// The musician's own availability calendar. User-level: these calls carry no
// tenant, and the server resolves none.

export interface UserAvailabilitySlot {
  id: Id
  start_date: string
  end_date: string
  status: 'available' | 'unavailable'
  reason: string | null
  /** Who wrote it — set to someone else when a band maintains this calendar. */
  created_by_user_id: Id | null
  /** Which band's screen it was written from. */
  created_in_tenant_id: Id | null
}

export interface AvailabilityDelegation {
  tenantId: Id
  displayName: string
  /** This band may maintain my calendar for me. */
  managedByBand: boolean
}

export interface AvailabilitySettings {
  /** Bands may see the reason on my manual slots. */
  availabilityDetailVisible: boolean
  /** Bands may see which band, and what, I'm booked for elsewhere. */
  crossBandGigDetailVisible: boolean
  /** Required total gap between consecutive events. */
  travelMarginHours: number
  delegations: AvailabilityDelegation[]
}

export const listMyAvailability = (range: { from: string; to: string }) =>
  request<WindowedCollectionResponse<UserAvailabilitySlot>>(
    `/api/me/availability?from=${range.from}&to=${range.to}`,
  )

export const createMyAvailability = (body: Partial<UserAvailabilitySlot>) =>
  request<UserAvailabilitySlot>('/api/me/availability', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateMyAvailability = (id: Id, body: Partial<UserAvailabilitySlot>) =>
  request<UserAvailabilitySlot>(`/api/me/availability/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

export const deleteMyAvailability = (id: Id) =>
  request<void>(`/api/me/availability/${id}`, { method: 'DELETE' })

export const getAvailabilitySettings = () =>
  request<AvailabilitySettings>('/api/me/availability/settings')

/** Privacy flags use snake_case on the wire; delegations are camelCase pairs. */
export interface AvailabilitySettingsPatch {
  availability_detail_visible?: boolean
  cross_band_gig_detail_visible?: boolean
  travel_margin_hours?: number
  delegations?: { tenantId: Id; managedByBand: boolean }[]
}

export const updateAvailabilitySettings = (patch: AvailabilitySettingsPatch) =>
  request<AvailabilitySettings>('/api/me/availability/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
