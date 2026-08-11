import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The hook names an aggregate; which surface that resolves to (active tenant vs
// the /api/me hub) is usePlanningSource's job and is tested there.
vi.mock('../hooks/usePlanningSource.ts', () => ({ usePlanningSource: vi.fn() }))

import { usePlanningSource } from '../hooks/usePlanningSource.ts'
import { usePagedEventTabs } from '../hooks/usePagedEventTabs.ts'

const UPCOMING = [{ id: 1, date: '2099-01-01' }]
const PAST = [{ id: 2, date: '2020-01-01' }]
const CURSOR = { date: '2020-01-01', id: 2 }

function upcomingPage(items = UPCOMING) {
  return { items, meta: { limit: 100, returned: items.length } }
}

function pastPage(items = PAST, nextCursor = null) {
  return { items, meta: { limit: 100, returned: items.length, nextCursor } }
}

function makeFetchers() {
  return {
    upcoming: vi.fn().mockResolvedValue(upcomingPage()),
    past: vi.fn().mockResolvedValue(pastPage()),
  }
}

// The resolved source is stable across renders (usePlanningSource memoizes it),
// which is what keeps the hook's load effect from re-firing.
function asSource(api) {
  usePlanningSource.mockReturnValue({
    kind: 'tenant',
    labelsTenant: false,
    canLoadRoster: true,
    canWriteOrdinaryEndpoint: true,
    api,
  })
}

function setup({ fetchers: overrides, ...optionOverrides } = {}) {
  const fetchers = { ...makeFetchers(), ...overrides }
  asSource(fetchers)
  const options = { aggregate: 'gigs', dateOf: (item) => item.date, ...optionOverrides }
  // A fresh options object every render, as a page component would pass it —
  // the hook must not re-fetch just because that identity changed.
  const rendered = renderHook(() => usePagedEventTabs({ ...options }))
  return { ...rendered, fetchers }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('usePagedEventTabs', () => {
  it('loads the upcoming tab on mount from the resolved feed', async () => {
    const { result, fetchers } = setup()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchers.upcoming).toHaveBeenCalledWith(100, expect.any(String))
    expect(fetchers.past).not.toHaveBeenCalled()
    expect(result.current.items).toEqual(UPCOMING)
    expect(result.current.hasMore).toBe(false)
  })

  // The point of naming an aggregate: the page never picks a fetcher, so it
  // can't read the wrong surface. Whatever usePlanningSource resolved is what
  // gets paged — here the cross-tenant hub's feeds.
  it('pages whichever feeds the resolved source provides', async () => {
    const hub = {
      upcoming: vi.fn().mockResolvedValue(upcomingPage([{ id: 11, date: '2099-02-02' }])),
      past: vi.fn().mockResolvedValue(pastPage([{ id: 12, date: '2020-02-02' }])),
    }
    const { result } = setup({ fetchers: hub })

    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(hub.upcoming).toHaveBeenCalled()
    expect(result.current.items[0].id).toBe(11)
  })

  it('does not re-fetch when only the options object identity changes', async () => {
    const { result, rerender, fetchers } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    rerender()
    rerender()

    expect(fetchers.upcoming).toHaveBeenCalledTimes(1)
  })

  it('fetches the past feed and exposes its cursor only after switching tab', async () => {
    const { result, fetchers } = setup()
    fetchers.past.mockResolvedValue(pastPage(PAST, CURSOR))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.setActiveTab('past'))

    await waitFor(() => expect(result.current.items).toEqual(PAST))
    expect(result.current.hasMore).toBe(true)
    expect(fetchers.past).toHaveBeenCalledWith(100, expect.any(String))
  })

  it('appends the next keyset page and carries the cursor forward', async () => {
    const { result, fetchers } = setup()
    fetchers.past.mockResolvedValueOnce(pastPage(PAST, CURSOR))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.setActiveTab('past'))
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    const older = [{ id: 3, date: '2019-01-01' }]
    fetchers.past.mockResolvedValueOnce(pastPage(older, null))
    await act(() => result.current.loadMore())

    expect(fetchers.past).toHaveBeenLastCalledWith(100, expect.any(String), CURSOR)
    expect(result.current.items).toEqual([...PAST, ...older])
    expect(result.current.hasMore).toBe(false)
  })

  it('ignores loadMore without a cursor', async () => {
    const { result, fetchers } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.loadMore())

    expect(fetchers.past).not.toHaveBeenCalled()
  })

  // Fast tab switching: a slow first response must not overwrite the newer one.
  it('commits only the most recent request', async () => {
    const { result, fetchers } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    let releaseSlow
    fetchers.past.mockReturnValueOnce(new Promise((resolve) => { releaseSlow = () => resolve(pastPage()) }))

    act(() => result.current.setActiveTab('past'))
    act(() => result.current.setActiveTab('upcoming'))
    await waitFor(() => expect(fetchers.upcoming).toHaveBeenCalledTimes(2))
    await act(async () => { releaseSlow() })

    expect(result.current.items).toEqual(UPCOMING)
    expect(result.current.loading).toBe(false)
  })

  it('surfaces a failed load as an error message', async () => {
    const { result } = setup({ fetchers: { upcoming: vi.fn().mockRejectedValue(new Error('boom')) } })

    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.loading).toBe(false)
  })

  describe('deep link (deferInitialLoad)', () => {
    it('waits for the detail pane to resolve which tab the row belongs to', async () => {
      const { result, fetchers } = setup({ deferInitialLoad: true })

      await waitFor(() => expect(fetchers.upcoming).not.toHaveBeenCalled())

      act(() => result.current.onDetailLoaded({ id: 2, date: '2020-01-01' }))

      await waitFor(() => expect(result.current.activeTab).toBe('past'))
      expect(fetchers.past).toHaveBeenCalledTimes(1)
      expect(fetchers.upcoming).not.toHaveBeenCalled()
    })

    // The resolved tab is already the default one, so setActiveTab wouldn't
    // change state and the load effect would never fire.
    it('fires the deferred load when the row belongs to the default tab', async () => {
      const { result, fetchers } = setup({ deferInitialLoad: true })

      act(() => result.current.onDetailLoaded({ id: 1, date: '2099-01-01' }))

      await waitFor(() => expect(fetchers.upcoming).toHaveBeenCalledTimes(1))
      expect(result.current.activeTab).toBe('upcoming')
    })

    it('falls back to the default tab when the deep-linked row fails to load', async () => {
      const { result, fetchers } = setup({ deferInitialLoad: true })

      act(() => result.current.onDetailLoadError())

      await waitFor(() => expect(fetchers.upcoming).toHaveBeenCalledTimes(1))
    })

    it('does not re-load on a later detail load once the tab is resolved', async () => {
      const { result, fetchers } = setup({ deferInitialLoad: true })
      act(() => result.current.onDetailLoaded({ id: 1, date: '2099-01-01' }))
      await waitFor(() => expect(fetchers.upcoming).toHaveBeenCalledTimes(1))

      act(() => result.current.onDetailLoaded({ id: 4, date: '2099-03-03' }))
      act(() => result.current.onDetailLoadError())

      await waitFor(() => expect(fetchers.upcoming).toHaveBeenCalledTimes(1))
    })
  })

  it('reloads the current tab on demand', async () => {
    const { result, fetchers } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.reload())

    expect(fetchers.upcoming).toHaveBeenCalledTimes(2)
  })

  it('lets the caller patch a row in place without a refetch', async () => {
    const { result, fetchers } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.setItems((rows) => rows.map((row) => ({ ...row, title: 'renamed' }))))

    expect(result.current.items[0].title).toBe('renamed')
    expect(fetchers.upcoming).toHaveBeenCalledTimes(1)
  })
})
