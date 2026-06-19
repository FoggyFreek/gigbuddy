import { useCallback, useEffect, useState } from 'react'
import type { Id } from '../types/entities.ts'

const KEY_PREFIX = 'gigbuddy:search-categories:'
const keyFor = (tenantId: Id | null) => `${KEY_PREFIX}${tenantId ?? 'none'}`

function read(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((k) => typeof k === 'string')
      ? (parsed as string[])
      : fallback
  } catch {
    return fallback
  }
}

function write(key: string, keys: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(keys))
  } catch {
    // Quota exceeded or storage unavailable (e.g. private mode) — degrade to
    // in-memory only; the state still updates for this session.
  }
}

// Per-tenant chosen search categories backed by localStorage, so the set of
// active categories persists across the browser session. Scoped by tenant like
// the recent searches. `defaultKeys` is the seed for a tenant that hasn't picked
// any categories yet.
export function useSearchCategories(tenantId: Id | null, defaultKeys: string[]) {
  const [activeKeys, setActiveKeys] = useState<string[]>(() => read(keyFor(tenantId), defaultKeys))

  // Re-read when the active tenant changes.
  useEffect(() => { setActiveKeys(read(keyFor(tenantId), defaultKeys)) }, [tenantId, defaultKeys])

  // Persist on every change. localStorage is the durable copy; `activeKeys` is
  // the render state. Unlike recent searches, category edits don't navigate away
  // mid-event, so an effect-based write is safe here.
  useEffect(() => { write(keyFor(tenantId), activeKeys) }, [tenantId, activeKeys])

  const addCategory = useCallback((key: string) => {
    setActiveKeys((keys) => (keys.includes(key) ? keys : [...keys, key]))
  }, [])

  const removeCategory = useCallback((key: string) => {
    setActiveKeys((keys) => keys.filter((k) => k !== key))
  }, [])

  return { activeKeys, addCategory, removeCategory }
}
