import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useTenantKind } from './useTenantKind.ts'
import { isPastDate, localDateString } from '../utils/dateFormat.ts'
import type { ListCollectionCursor } from '../types/api.ts'

// Bounded page size for the Upcoming/Past tabs — matches the server's
// MAX_LIST_LIMIT. Past rows paginate further via a keyset cursor ("load more").
const TAB_PAGE_SIZE = 100

export type EventTab = 'upcoming' | 'past'

type UpcomingFetcher<T> = (limit: number, today: string) => Promise<{ items: T[] }>

type PastFetcher<T> = (
  limit: number,
  today: string,
  cursor?: ListCollectionCursor,
) => Promise<{ items: T[]; meta: { nextCursor: ListCollectionCursor | null } }>

export interface PagedEventTabsOptions<T> {
  /** Active-tenant feeds. */
  upcoming: UpcomingFetcher<T>
  past: PastFetcher<T>
  /** Cross-tenant (`/api/me/*`) feeds, used when the workspace is personal. */
  upcomingMine: UpcomingFetcher<T>
  pastMine: PastFetcher<T>
  /** The row's date, which decides its tab when a deep link is resolved. */
  dateOf: (item: T) => string | Date | null | undefined
  /** The page mounted on a deep link, so the row's tab isn't known yet. Read once. */
  deferInitialLoad?: boolean
  pageSize?: number
}

export interface PagedEventTabsApi<T> {
  activeTab: EventTab
  setActiveTab: Dispatch<SetStateAction<EventTab>>
  items: T[]
  /** For in-place row patches (detail edits, deletes) that need no refetch. */
  setItems: Dispatch<SetStateAction<T[]>>
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string | null
  setError: Dispatch<SetStateAction<string | null>>
  /** Re-fetch the tab that is open — after a create, or a date change that may move a row. */
  reload: () => void
  loadMore: () => Promise<void>
  /** Feed the detail pane's own fetch back in, so a deep link opens on the right tab. */
  onDetailLoaded: (item: T) => void
  onDetailLoadError: () => void
}

// The Upcoming/Past tab pair behind the gigs, rehearsals and band-events lists:
// bounded first page, keyset "load more" on Past, and the active-tenant vs
// cross-tenant feed split that a personal workspace needs. Owning the split
// here is the point — a new feed can't quietly ship without it.
//
// A deep-linked row (/gigs/:id landed on directly) has an unknown date, and so
// an unknown tab. With `deferInitialLoad` the first fetch waits for
// `onDetailLoaded`, so a past-row link doesn't fire a throwaway upcoming
// request; `onDetailLoadError` releases it if that row never arrives.
export function usePagedEventTabs<T>(options: PagedEventTabsOptions<T>): PagedEventTabsApi<T> {
  const { isPersonal } = useTenantKind()
  const pageSize = options.pageSize ?? TAB_PAGE_SIZE

  // Callers pass a fresh options literal every render; read them through a ref
  // so loadTab stays stable and the load effect doesn't re-run on identity.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const [activeTab, setActiveTab] = useState<EventTab>('upcoming')
  // Read by the reload/detail callbacks without being a dependency, so they
  // stay stable across ordinary tab switches (page outlet contexts memo on them).
  const activeTabRef = useRef(activeTab)
  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pastCursor, setPastCursor] = useState<ListCollectionCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const deferInitialLoadRef = useRef(options.deferInitialLoad ?? false)
  // Guards against out-of-order responses (fast tab switching, or the deep-link
  // resolution flipping tabs mid-flight) — only the newest request may commit.
  const requestIdRef = useRef(0)

  const loadTab = useCallback(async (tab: EventTab) => {
    const requestId = ++requestIdRef.current
    const { upcoming, past, upcomingMine, pastMine } = optionsRef.current
    try {
      setLoading(true)
      setError(null)
      const today = localDateString()
      if (tab === 'upcoming') {
        const result = await (isPersonal ? upcomingMine : upcoming)(pageSize, today)
        if (requestIdRef.current !== requestId) return
        setItems(result.items)
        setPastCursor(null)
        setHasMore(false)
      } else {
        const result = await (isPersonal ? pastMine : past)(pageSize, today)
        if (requestIdRef.current !== requestId) return
        setItems(result.items)
        setPastCursor(result.meta.nextCursor)
        setHasMore(result.meta.nextCursor !== null)
      }
    } catch (e: unknown) {
      if (requestIdRef.current === requestId) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [isPersonal, pageSize])

  useEffect(() => {
    if (deferInitialLoadRef.current) return
    loadTab(activeTab)
  }, [activeTab, loadTab])

  const reload = useCallback(() => {
    loadTab(activeTabRef.current)
  }, [loadTab])

  const loadMore = useCallback(async () => {
    if (!pastCursor || loadingMore) return
    const requestId = requestIdRef.current
    const { past, pastMine } = optionsRef.current
    try {
      setLoadingMore(true)
      const result = await (isPersonal ? pastMine : past)(pageSize, localDateString(), pastCursor)
      if (requestIdRef.current !== requestId || activeTabRef.current !== 'past') return
      setItems((previous) => [...previous, ...result.items])
      setPastCursor(result.meta.nextCursor)
      setHasMore(result.meta.nextCursor !== null)
    } catch (e: unknown) {
      if (requestIdRef.current === requestId) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }, [isPersonal, pageSize, pastCursor, loadingMore])

  const onDetailLoaded = useCallback((item: T) => {
    const wasDeferred = deferInitialLoadRef.current
    deferInitialLoadRef.current = false
    const tab: EventTab = isPastDate(optionsRef.current.dateOf(item)) ? 'past' : 'upcoming'
    if (tab !== activeTabRef.current) setActiveTab(tab)
    // Already the open tab, so setActiveTab wouldn't change state and wouldn't
    // re-trigger the load effect — fire the deferred load explicitly.
    else if (wasDeferred) loadTab(tab)
  }, [loadTab])

  const onDetailLoadError = useCallback(() => {
    if (!deferInitialLoadRef.current) return
    deferInitialLoadRef.current = false
    loadTab(activeTabRef.current)
  }, [loadTab])

  return {
    activeTab,
    setActiveTab,
    items,
    setItems,
    loading,
    loadingMore,
    hasMore,
    error,
    setError,
    reload,
    loadMore,
    onDetailLoaded,
    onDetailLoadError,
  }
}
