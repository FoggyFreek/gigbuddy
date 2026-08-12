import { useMemo } from 'react'
import { useTenantKind } from './useTenantKind.ts'
import { getGig, listPastGigs, listUpcomingGigs, searchGigs } from '../api/gigs.ts'
import { getRehearsal, listPastRehearsals, listUpcomingRehearsals } from '../api/rehearsals.ts'
import { getBandEvent, listPastBandEvents, listUpcomingBandEvents } from '../api/bandEvents.ts'
import { listTasks } from '../api/tasks.ts'
import {
  getMyBandEvent,
  getMyGig,
  getMyRehearsal,
  listMyPastBandEvents,
  listMyPastGigs,
  listMyPastRehearsals,
  listMyTasks,
  listMyUpcomingBandEvents,
  listMyUpcomingGigs,
  listMyUpcomingRehearsals,
  searchMyGigs,
  type MyBandEvent,
  type MyGig,
  type MyRehearsal,
  type MyTask,
} from '../api/me.ts'
import type { Id } from '../types/entities.ts'
import type { ListCollectionCursor } from '../types/api.ts'

/** Which surface a planning read goes through: the active tenant, or the hub. */
export type PlanningSourceKind = 'tenant' | 'me'

export type UpcomingFetcher<T> = (limit: number, today: string) => Promise<{ items: T[] }>

export type PastFetcher<T> = (
  limit: number,
  today: string,
  cursor?: ListCollectionCursor,
) => Promise<{ items: T[]; meta: { nextCursor: ListCollectionCursor | null } }>

interface PlanningEventApi<T> {
  upcoming: UpcomingFetcher<T>
  past: PastFetcher<T>
  detail: (id: Id, opts?: RequestInit) => Promise<T>
}

// Rows are typed in their cross-tenant flavour on both sides: a tenant-scoped
// read simply never fills the label fields in.
export interface PlanningRows {
  gigs: MyGig
  rehearsals: MyRehearsal
  bandEvents: MyBandEvent
  tasks: MyTask
}

// Written in terms of PlanningRows, so an aggregate's feeds and its row type
// cannot drift apart.
export interface PlanningApis {
  gigs: PlanningEventApi<PlanningRows['gigs']> & { search: (q: string) => Promise<PlanningRows['gigs'][]> }
  rehearsals: PlanningEventApi<PlanningRows['rehearsals']>
  bandEvents: PlanningEventApi<PlanningRows['bandEvents']>
  tasks: { list: (filters?: { limit?: number; done?: boolean }) => Promise<{ items: PlanningRows['tasks'][] }> }
}

export type PlanningAggregate = keyof PlanningApis
/** The aggregates with an Upcoming/Past feed pair (see usePagedEventTabs). */
export type PlanningEventAggregate = Exclude<PlanningAggregate, 'tasks'>

// The one table mapping a planning aggregate to its reads on either surface.
// A new aggregate — or a change in what the hub serves — is an edit here, not
// in every page that happens to read it.
//
// Each entry forwards rather than aliasing, so an endpoint is reached when the
// operation is called — naming an aggregate here doesn't bind every planning
// endpoint at import time.
const PLANNING_APIS: { [K in PlanningAggregate]: Record<PlanningSourceKind, PlanningApis[K]> } = {
  gigs: {
    tenant: {
      upcoming: (...args) => listUpcomingGigs(...args),
      past: (...args) => listPastGigs(...args),
      search: (...args) => searchGigs(...args),
      detail: (...args) => getGig(...args),
    },
    me: {
      upcoming: (...args) => listMyUpcomingGigs(...args),
      past: (...args) => listMyPastGigs(...args),
      search: (...args) => searchMyGigs(...args),
      detail: (...args) => getMyGig(...args),
    },
  },
  rehearsals: {
    tenant: {
      upcoming: (...args) => listUpcomingRehearsals(...args),
      past: (...args) => listPastRehearsals(...args),
      detail: (id) => getRehearsal(id),
    },
    me: {
      upcoming: (...args) => listMyUpcomingRehearsals(...args),
      past: (...args) => listMyPastRehearsals(...args),
      detail: (id) => getMyRehearsal(id),
    },
  },
  bandEvents: {
    tenant: {
      upcoming: (...args) => listUpcomingBandEvents(...args),
      past: (...args) => listPastBandEvents(...args),
      detail: (id) => getBandEvent(id),
    },
    me: {
      upcoming: (...args) => listMyUpcomingBandEvents(...args),
      past: (...args) => listMyPastBandEvents(...args),
      detail: (id) => getMyBandEvent(id),
    },
  },
  tasks: {
    tenant: { list: (...args) => listTasks(...args) },
    me: { list: (...args) => listMyTasks(...args) },
  },
}

export interface PlanningSource<K extends PlanningAggregate> {
  kind: PlanningSourceKind
  /**
   * Rows may carry another band's label, so ownership — and with it writability
   * — is a per-row question for `useCrossTenantRow` / `isCrossTenantRow`.
   */
  labelsTenant: boolean
  /** The active tenant's roster describes these rows; a personal workspace has none. */
  canLoadRoster: boolean
  /** Every row is the active tenant's, so tenant-scoped writes always apply. */
  canWriteOrdinaryEndpoint: boolean
  /** The aggregate's reads, already resolved to this source. */
  api: PlanningApis[K]
}

// Which surface a planning page reads, in one place.
//
// A band workspace reads its own tenant-scoped endpoints; a personal workspace
// reads the cross-tenant hub (`/api/me/*`), because a musician's gigs live in
// the bands they play in, not in their own workspace. That decision is a
// property of the tenant kind, never of the page, so pages ask for an
// aggregate and get back the right fetchers plus the traits that follow from
// the source — what may be labeled, what may be rostered, what may be written.
//
// This is UX only. The hub derives its tenant set from the caller's
// memberships, and tenant-scoped routes 404 outside `req.tenantId`.
export function usePlanningSource<K extends PlanningAggregate>(aggregate: K): PlanningSource<K> {
  const { isPersonal } = useTenantKind()

  return useMemo(() => {
    const kind: PlanningSourceKind = isPersonal ? 'me' : 'tenant'
    return {
      kind,
      labelsTenant: kind === 'me',
      canLoadRoster: kind === 'tenant',
      canWriteOrdinaryEndpoint: kind === 'tenant',
      api: PLANNING_APIS[aggregate][kind],
    }
  }, [isPersonal, aggregate])
}
