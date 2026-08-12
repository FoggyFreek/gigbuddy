import { request } from './_client.ts'
import type { BandEvent, Gig, Id, MyBandRef, Rehearsal, Task } from '../types/entities.ts'
import type {
  CrossTenantRef,
  GigMapGig,
  LimitedCollectionResponse,
  LimitedCollectionWithCursorResponse,
  LimitedCollectionWithTotalResponse,
  ListCollectionCursor,
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
  /**
   * The band a personal-workspace row was tagged with. camelCase here because
   * the agenda payload is assembled field by field server-side rather than
   * projected from a row — see agendaItem in server/services/meService.js.
   */
  myBand: MyBandRef | null
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

export const listMyPastGigs = (limit: number, today: string, cursor?: ListCollectionCursor) => {
  const params = new URLSearchParams({ limit: String(limit), today })
  if (cursor) {
    params.set('cursorDate', cursor.date)
    params.set('cursorId', String(cursor.id))
  }
  return request<LimitedCollectionWithCursorResponse<MyGig>>(`/api/me/gigs/past?${params}`)
}

export const searchMyGigs = (q: string) =>
  request<MyGig[]>(`/api/me/gigs/search?${new URLSearchParams({ q })}`)

export const getMyGig = (id: Id, opts?: RequestInit) =>
  request<MyGig>(`/api/me/gigs/${id}`, opts)

export const listMyGigMapData = ({ from, to }: { from: string; to: string }) =>
  request<WindowedCollectionResponse<MyGigMapGig>>(
    `/api/me/gigs/map?${new URLSearchParams({ from, to })}`,
  )

export const getMyNextRehearsal = () => request<MyRehearsal | null>('/api/me/rehearsals/next')

export const listMyUpcomingRehearsals = (limit: number, today: string) =>
  request<LimitedCollectionResponse<MyRehearsal>>(
    `/api/me/rehearsals/upcoming?${new URLSearchParams({ limit: String(limit), today })}`,
  )

export const listMyPastRehearsals = (limit: number, today: string, cursor?: ListCollectionCursor) => {
  const params = new URLSearchParams({ limit: String(limit), today })
  if (cursor) {
    params.set('cursorDate', cursor.date)
    params.set('cursorId', String(cursor.id))
  }
  return request<LimitedCollectionWithCursorResponse<MyRehearsal>>(`/api/me/rehearsals/past?${params}`)
}

export const getMyRehearsal = (id: Id) => request<MyRehearsal>(`/api/me/rehearsals/${id}`)
export const setMyRehearsalVote = (id: Id, vote: string | null) =>
  request<MyRehearsal>(`/api/me/rehearsals/${id}/vote`, {
    method: 'PATCH', body: JSON.stringify({ vote }),
  })

export const listMyUpcomingBandEvents = (limit: number, today: string) =>
  request<LimitedCollectionResponse<MyBandEvent>>(
    `/api/me/band-events/upcoming?${new URLSearchParams({ limit: String(limit), today })}`,
  )

export const listMyPastBandEvents = (limit: number, today: string, cursor?: ListCollectionCursor) => {
  const params = new URLSearchParams({ limit: String(limit), today })
  if (cursor) {
    params.set('cursorDate', cursor.date)
    params.set('cursorId', String(cursor.id))
  }
  return request<LimitedCollectionWithCursorResponse<MyBandEvent>>(`/api/me/band-events/past?${params}`)
}

export const getMyBandEvent = (id: Id) => request<MyBandEvent>(`/api/me/band-events/${id}`)

// No `assignee` — on the hub "mine" is the only scope, so the server never
// offers one.
export const listMyTasks = ({ limit, done }: { limit?: number; done?: boolean } = {}) => {
  const params = new URLSearchParams()
  if (limit !== undefined) params.set('limit', String(limit))
  if (done !== undefined) params.set('done', String(done))
  return request<LimitedCollectionWithTotalResponse<MyTask>>(`/api/me/tasks?${params}`)
}

export const setMyTaskDone = (id: Id, done: boolean) =>
  request<MyTask>(`/api/me/tasks/${id}/done`, {
    method: 'PATCH', body: JSON.stringify({ done }),
  })

/**
 * Leave a band. User-level, so it works from a personal workspace with no band
 * selected — which is the only place an ordinary member can reach it. Every
 * miss is a 404: a band the caller is not in must be indistinguishable from one
 * that does not exist. 409 `last_tenant_admin` when the caller is the band's
 * only admin.
 */
export const leaveTenant = (tenantId: Id) =>
  request<void>(`/api/me/memberships/${tenantId}`, { method: 'DELETE' })
