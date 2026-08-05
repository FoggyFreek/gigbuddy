import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'
import type { TenantKind } from '../utils/businessRegistry.ts'
import type { WindowedCollectionResponse } from '../types/api.ts'

// The server derives the cross-tenant calendar from approved memberships;
// callers never select which tenants are included.
export type AgendaItemType = 'gig' | 'rehearsal' | 'band_event'

export interface AgendaItem {
  type: AgendaItemType
  id: Id
  date: string
  endDate: string
  startTime: string | null
  endTime: string | null
  title: string | null
  description: string | null
  location: string | null
  status: string | null
  tenantId: Id
  tenantName: string | null
  kind: TenantKind | null
}

export const listMyAgenda = (range: { from: string; to: string }) =>
  request<WindowedCollectionResponse<AgendaItem>>(
    `/api/me/agenda?from=${range.from}&to=${range.to}`,
  )
