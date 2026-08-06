import { request } from './_client.ts'
import type { BandEvent, Gig, Id, Rehearsal, Task } from '../types/entities.ts'
import type {
  CrossTenantRef,
  GigMapGig,
  LimitedCollectionResponse,
  LimitedCollectionWithTotalResponse,
  MaybeCrossTenant,
  WindowedCollectionResponse,
} from '../types/api.ts'

// The server derives every one of these reads from the caller's approved
// memberships; callers never select which tenants are included, and sending a
// tenant id changes nothing. Each feed mirrors the shape of its tenant-scoped
// counterpart so the artist dashboard can swap one call for the other.
export type AgendaItemType = 'gig' | 'rehearsal' | 'band_event'

export interface AgendaItem extends CrossTenantRef {
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
}

export type MyGig = MaybeCrossTenant<Gig>
export type MyRehearsal = MaybeCrossTenant<Rehearsal>
export type MyBandEvent = MaybeCrossTenant<BandEvent>
export type MyTask = MaybeCrossTenant<Task>
export type MyGigMapGig = MaybeCrossTenant<GigMapGig>

export const listMyAgenda = (range: { from: string; to: string }) =>
  request<WindowedCollectionResponse<AgendaItem>>(
    `/api/me/agenda?from=${range.from}&to=${range.to}`,
  )

export const listMyUpcomingGigs = (limit: number, today: string) =>
  request<LimitedCollectionWithTotalResponse<MyGig>>(
    `/api/me/gigs/upcoming?${new URLSearchParams({ limit: String(limit), today })}`,
  )

export const listMyGigMapData = ({ from, to }: { from: string; to: string }) =>
  request<WindowedCollectionResponse<MyGigMapGig>>(
    `/api/me/gigs/map?${new URLSearchParams({ from, to })}`,
  )

export const getMyNextRehearsal = () => request<MyRehearsal | null>('/api/me/rehearsals/next')

export const listMyUpcomingBandEvents = (limit: number, today: string) =>
  request<LimitedCollectionResponse<MyBandEvent>>(
    `/api/me/band-events/upcoming?${new URLSearchParams({ limit: String(limit), today })}`,
  )

// No `assignee` — on the hub "mine" is the only scope, so the server never
// offers one.
export const listMyTasks = ({ limit, done }: { limit?: number; done?: boolean } = {}) => {
  const params = new URLSearchParams()
  if (limit !== undefined) params.set('limit', String(limit))
  if (done !== undefined) params.set('done', String(done))
  return request<LimitedCollectionWithTotalResponse<MyTask>>(`/api/me/tasks?${params}`)
}
