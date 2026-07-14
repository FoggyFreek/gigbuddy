import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/authContext.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { useEntitlements } from '../hooks/useEntitlements.ts'
import { dismissTutorial as dismissTutorialApi } from '../api/tutorials.ts'
import { TUTORIALS } from './registry.tsx'
import type { TutorialContext, TutorialDef } from './types.ts'

interface ActiveTutorial {
  active: TutorialDef | null
  dismiss: (key: string) => void
}

// Resolves which tutorial (if any) to show now: the first registered tutorial
// that is eligible, not yet dismissed, and whose async condition passes.
// Dismissing hides it instantly (optimistic local set) and persists via the API.
export function useActiveTutorial(): ActiveTutorial {
  const { user, refreshUser } = useAuth()
  const { can, isSuperAdmin } = usePermissions()
  const { has, financeReadOnly } = useEntitlements()
  const { pathname } = useLocation()

  // Locally-dismissed keys so the overlay closes before /auth/me refreshes.
  const [locallyDismissed, setLocallyDismissed] = useState<Set<string>>(new Set())
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const dismissedSet = useMemo(() => {
    const set = new Set(user?.dismissedTutorials ?? [])
    for (const key of locallyDismissed) set.add(key)
    return set
  }, [user?.dismissedTutorials, locallyDismissed])

  const ctx: TutorialContext = useMemo(
    () => ({ can, isSuperAdmin, hasFeature: has, financeReadOnly, pathname }),
    [can, isSuperAdmin, has, financeReadOnly, pathname],
  )

  // Ordered, synchronously-eligible, not-yet-dismissed tutorials.
  const candidates = useMemo(
    () => TUTORIALS.filter((t) => !dismissedSet.has(t.key) && (t.eligible?.(ctx) ?? true)),
    [dismissedSet, ctx],
  )

  // Resolve the first candidate whose async condition passes. Re-runs when the
  // candidate set or active tenant changes. Cheap in practice: a tutorial modal
  // is blocking, so a candidate is dismissed on first interaction and drops out.
  const activeTenantId = user?.activeTenantId ?? null
  const userLoaded = user !== undefined && user !== null
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!userLoaded) { if (!cancelled) setActiveKey(null); return }
      for (const tutorial of candidates) {
        const ok = tutorial.condition ? await tutorial.condition().catch(() => false) : true
        if (cancelled) return
        if (ok) { setActiveKey(tutorial.key); return }
      }
      if (!cancelled) setActiveKey(null)
    })()
    return () => { cancelled = true }
  }, [candidates, userLoaded, activeTenantId])

  const active = useMemo(
    () => candidates.find((t) => t.key === activeKey) ?? null,
    [candidates, activeKey],
  )

  const dismiss = useCallback((key: string) => {
    setLocallyDismissed((prev) => new Set(prev).add(key))
    setActiveKey(null)
    dismissTutorialApi(key).then(() => refreshUser()).catch(() => { /* stays locally dismissed */ })
  }, [refreshUser])

  return { active, dismiss }
}
