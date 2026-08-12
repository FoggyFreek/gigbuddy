import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../hooks/useTenantKind.ts', () => ({ useTenantKind: vi.fn() }))

// The endpoints are stubbed: what is under test is which of them a workspace
// kind resolves to, not what they return.
vi.mock('../../../planning/gigs/gigs.ts', () => ({
  listUpcomingGigs: vi.fn(), listPastGigs: vi.fn(), searchGigs: vi.fn(), getGig: vi.fn(),
}))
vi.mock('../../../planning/rehearsals/rehearsals.ts', () => ({
  listUpcomingRehearsals: vi.fn(), listPastRehearsals: vi.fn(), getRehearsal: vi.fn(),
}))
vi.mock('../../../planning/events/bandEvents.ts', () => ({
  listUpcomingBandEvents: vi.fn(), listPastBandEvents: vi.fn(), getBandEvent: vi.fn(),
}))
vi.mock('../../../planning/tasks/tasks.ts', () => ({ listTasks: vi.fn() }))
vi.mock('../../../planning/availability/me.ts', () => ({
  listMyUpcomingGigs: vi.fn(), listMyPastGigs: vi.fn(), searchMyGigs: vi.fn(), getMyGig: vi.fn(),
  listMyUpcomingRehearsals: vi.fn(), listMyPastRehearsals: vi.fn(), getMyRehearsal: vi.fn(),
  listMyUpcomingBandEvents: vi.fn(), listMyPastBandEvents: vi.fn(), getMyBandEvent: vi.fn(),
  listMyTasks: vi.fn(),
}))

import { useTenantKind } from '../../../hooks/useTenantKind.ts'
import { usePlanningSource } from '../../../planning/shared/usePlanningSource.ts'
import * as gigsApi from '../../../planning/gigs/gigs.ts'
import * as rehearsalsApi from '../../../planning/rehearsals/rehearsals.ts'
import * as bandEventsApi from '../../../planning/events/bandEvents.ts'
import * as tasksApi from '../../../planning/tasks/tasks.ts'
import * as meApi from '../../../planning/availability/me.ts'

const TODAY = '2026-08-12'
const CURSOR = { date: '2026-01-01', id: 4 }

function asKind(kind) {
  useTenantKind.mockReturnValue({ isPersonal: kind === 'personal' })
}

beforeEach(() => {
  vi.clearAllMocks()
  asKind('band')
})

describe('usePlanningSource', () => {
  it('reads the active tenant in a band workspace', () => {
    const { result } = renderHook(() => usePlanningSource('gigs'))
    const { api } = result.current

    expect(result.current.kind).toBe('tenant')
    api.upcoming(10, TODAY)
    api.past(10, TODAY, CURSOR)
    api.search('jazz')
    api.detail(3)
    expect(gigsApi.listUpcomingGigs).toHaveBeenCalledWith(10, TODAY)
    expect(gigsApi.listPastGigs).toHaveBeenCalledWith(10, TODAY, CURSOR)
    expect(gigsApi.searchGigs).toHaveBeenCalledWith('jazz')
    expect(gigsApi.getGig).toHaveBeenCalledWith(3)
    expect(meApi.listMyUpcomingGigs).not.toHaveBeenCalled()
  })

  // The whole point: a musician's gigs live in the bands they play in, so a
  // personal workspace reads the cross-tenant hub.
  it('reads the cross-tenant hub in a personal workspace', () => {
    asKind('personal')
    const { result } = renderHook(() => usePlanningSource('gigs'))
    const { api } = result.current

    expect(result.current.kind).toBe('me')
    api.upcoming(10, TODAY)
    api.search('jazz')
    api.detail(3)
    expect(meApi.listMyUpcomingGigs).toHaveBeenCalledWith(10, TODAY)
    expect(meApi.searchMyGigs).toHaveBeenCalledWith('jazz')
    expect(meApi.getMyGig).toHaveBeenCalledWith(3)
    expect(gigsApi.listUpcomingGigs).not.toHaveBeenCalled()
    expect(gigsApi.getGig).not.toHaveBeenCalled()
  })

  it('resolves the rehearsal feeds for both sources', () => {
    const band = renderHook(() => usePlanningSource('rehearsals'))
    band.result.current.api.detail(3)
    band.result.current.api.upcoming(10, TODAY)
    expect(rehearsalsApi.getRehearsal).toHaveBeenCalledWith(3)
    expect(rehearsalsApi.listUpcomingRehearsals).toHaveBeenCalledWith(10, TODAY)

    asKind('personal')
    const personal = renderHook(() => usePlanningSource('rehearsals'))
    personal.result.current.api.detail(3)
    personal.result.current.api.upcoming(10, TODAY)
    expect(meApi.getMyRehearsal).toHaveBeenCalledWith(3)
    expect(meApi.listMyUpcomingRehearsals).toHaveBeenCalledWith(10, TODAY)
  })

  it('resolves the band-event feeds for both sources', () => {
    const band = renderHook(() => usePlanningSource('bandEvents'))
    band.result.current.api.detail(3)
    band.result.current.api.past(10, TODAY)
    expect(bandEventsApi.getBandEvent).toHaveBeenCalledWith(3)
    expect(bandEventsApi.listPastBandEvents).toHaveBeenCalledWith(10, TODAY)

    asKind('personal')
    const personal = renderHook(() => usePlanningSource('bandEvents'))
    personal.result.current.api.detail(3)
    personal.result.current.api.past(10, TODAY)
    expect(meApi.getMyBandEvent).toHaveBeenCalledWith(3)
    expect(meApi.listMyPastBandEvents).toHaveBeenCalledWith(10, TODAY)
  })

  it('resolves the task list for both sources', () => {
    const band = renderHook(() => usePlanningSource('tasks'))
    band.result.current.api.list({ limit: 50 })
    expect(tasksApi.listTasks).toHaveBeenCalledWith({ limit: 50 })

    asKind('personal')
    const personal = renderHook(() => usePlanningSource('tasks'))
    personal.result.current.api.list({ limit: 50 })
    expect(meApi.listMyTasks).toHaveBeenCalledWith({ limit: 50 })
    expect(tasksApi.listTasks).toHaveBeenCalledTimes(1)
  })

  // Traits, not kind comparisons: what a page may assume about its rows follows
  // from the source it read them from.
  it('reports a band workspace as unlabeled, rostered and writable', () => {
    const { result } = renderHook(() => usePlanningSource('gigs'))

    expect(result.current.labelsTenant).toBe(false)
    expect(result.current.canLoadRoster).toBe(true)
    expect(result.current.canWriteOrdinaryEndpoint).toBe(true)
  })

  it('reports hub rows as labeled, rosterless and not writable through tenant routes', () => {
    asKind('personal')
    const { result } = renderHook(() => usePlanningSource('gigs'))

    expect(result.current.labelsTenant).toBe(true)
    expect(result.current.canLoadRoster).toBe(false)
    expect(result.current.canWriteOrdinaryEndpoint).toBe(false)
  })

  // Consumers put the resolved source in effect dependency lists.
  it('keeps a stable identity while the workspace does not change', () => {
    const { result, rerender } = renderHook(() => usePlanningSource('gigs'))
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })

  it('swaps the whole source when the workspace kind changes', () => {
    const { result, rerender } = renderHook(() => usePlanningSource('gigs'))
    expect(result.current.kind).toBe('tenant')

    asKind('personal')
    rerender()

    expect(result.current.kind).toBe('me')
  })
})
