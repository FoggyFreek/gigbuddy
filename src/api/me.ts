import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'
import type { TenantKind } from '../utils/businessRegistry.ts'
import type {
  LimitedCollectionWithCursorResponse,
  ListCollectionCursor,
  WindowedCollectionResponse,
} from '../types/api.ts'

// The cross-tenant hub. Read-only by design, and the tenant set is always
// derived server-side from approved memberships — none of these calls names a
// tenant, and sending one changes nothing.

/** Where a "band" in the hub comes from: a real tenant, or (phase 4) a contact. */
export type MyBandSource = 'tenant' | 'contact'

export interface MyBand {
  source: MyBandSource
  tenantId: Id
  displayName: string
  slug: string
  kind: TenantKind
  role: string
  logoPath: string | null
}

export type AgendaItemType = 'gig' | 'rehearsal' | 'band_event'

export interface AgendaItem {
  type: AgendaItemType
  id: Id
  date: string
  title: string | null
  status: string | null
  tenantId: Id
  tenantName: string | null
  kind: TenantKind | null
}

export interface EarningsRow {
  tenantId: Id
  tenantName: string | null
  kind: TenantKind | null
  revenueCents: number
  expenseCents: number
  /** This band's own result. Deliberately never summed across bands. */
  resultCents: number
}

export const listMyBands = () => request<{ items: MyBand[] }>('/api/me/bands')

export const listMyAgenda = (range: { from: string; to: string }) =>
  request<WindowedCollectionResponse<AgendaItem>>(
    `/api/me/agenda?from=${range.from}&to=${range.to}`,
  )

export const listMyPastAgenda = (
  params: { today: string; limit?: number; cursor?: ListCollectionCursor | null },
) => {
  const q = new URLSearchParams({ today: params.today })
  if (params.limit !== undefined) q.set('limit', String(params.limit))
  if (params.cursor) {
    q.set('cursorDate', params.cursor.date)
    q.set('cursorId', String(params.cursor.id))
  }
  return request<LimitedCollectionWithCursorResponse<AgendaItem>>(`/api/me/agenda/past?${q}`)
}

export const listMyEarnings = (range: { from: string; to: string }) =>
  request<WindowedCollectionResponse<EarningsRow>>(
    `/api/me/earnings?from=${range.from}&to=${range.to}`,
  )
