import { useCallback, useEffect, useState } from 'react'
import type { Id } from '../types/entities.ts'

// A recently navigated-to search result. We store the item the user clicked —
// not the query text — so "recent" reflects destinations, not what was typed.
export interface RecentItem {
  category: string
  id: string
  label: string
  to: string
  at: number
}

const CAP = 8
const KEY_PREFIX = 'gigbuddy:recent-searches:'
const keyFor = (tenantId: Id | null) => `${KEY_PREFIX}${tenantId ?? 'none'}`

function read(key: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RecentItem[]) : []
  } catch {
    return []
  }
}

function write(key: string, items: RecentItem[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch {
    // Quota exceeded or storage unavailable (e.g. private mode) — degrade to
    // in-memory only; the state still updates for this session.
  }
}

// Per-tenant recent-search list backed by localStorage. Scoping by tenant keeps
// one band's destinations from showing under another on a shared device.
export function useRecentSearches(tenantId: Id | null) {
  const [recents, setRecents] = useState<RecentItem[]>(() => read(keyFor(tenantId)))

  // Re-read when the active tenant changes.
  useEffect(() => { setRecents(read(keyFor(tenantId))) }, [tenantId])

  // localStorage is the source of truth; `recents` is just a render cache. Each
  // mutation reads the current stored value, persists the next value, then
  // updates state. The write happens *synchronously in the event* — selecting a
  // result navigates away and unmounts the panel in the same click, so a write
  // deferred inside a setState updater would be dropped (React discards pending
  // updates for an unmounting component) and nothing would be stored.
  const commit = useCallback((next: RecentItem[]) => {
    write(keyFor(tenantId), next)
    setRecents(next)
  }, [tenantId])

  const addRecent = useCallback((item: Omit<RecentItem, 'at'>) => {
    commit([
      { ...item, at: Date.now() },
      ...read(keyFor(tenantId)).filter((r) => !(r.category === item.category && r.id === item.id)),
    ].slice(0, CAP))
  }, [commit, tenantId])

  const removeRecent = useCallback((category: string, id: string) => {
    commit(read(keyFor(tenantId)).filter((r) => !(r.category === category && r.id === id)))
  }, [commit, tenantId])

  const clearRecents = useCallback(() => commit([]), [commit])

  return { recents, addRecent, removeRecent, clearRecents }
}
