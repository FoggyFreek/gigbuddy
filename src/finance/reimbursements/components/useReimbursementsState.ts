import { useCallback, useEffect, useState } from 'react'
import {
  listOutstanding,
  listMemberPurchases,
  createReimbursement,
  reimburseMemberFull,
} from '../reimbursements.ts'
import type { MemberOutstanding, Purchase, Id } from '../../../types/entities.ts'

interface UseReimbursementsStateResult {
  outstanding: MemberOutstanding[]
  loading: boolean
  error: string | null
  expandedId: Id | null
  purchasesByMember: Record<string, Purchase[]>
  toggleExpand: (memberId: Id) => Promise<void>
  reload: () => Promise<void>
  registerReimbursement: (body: Record<string, unknown>) => Promise<void>
  markReimbursed: (memberId: Id, body?: Record<string, unknown>) => Promise<void>
}

// Owns the Outstanding tab: the per-member outstanding list, the lazily-loaded
// drill-down of each member's purchases, and the register/mark-reimbursed
// actions (both reload the list so settled rows drop out).
export function useReimbursementsState(): UseReimbursementsStateResult {
  const [expandedId, setExpandedId] = useState<Id | null>(null)
  const [purchasesByMember, setPurchasesByMember] = useState<Record<string, Purchase[]>>({})
  const [actionError, setActionError] = useState<string | null>(null)

  // The outstanding list is tagged with the reload it answered, so `loading` is
  // derived from whether the newest reload has landed.
  const [reloadNonce, setReloadNonce] = useState(0)
  const [outstandingState, setOutstandingState] = useState<{ key: number; outstanding: MemberOutstanding[]; error: string | null } | null>(null)
  const outstanding = outstandingState?.outstanding ?? []
  const loading = outstandingState?.key !== reloadNonce
  const loadError = outstandingState?.key === reloadNonce ? outstandingState.error : null
  const error = actionError ?? loadError

  useEffect(() => {
    let cancelled = false
    listOutstanding()
      .then((rows) => {
        if (!cancelled) setOutstandingState({ key: reloadNonce, outstanding: rows, error: null })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setOutstandingState((prev) => ({
            key: reloadNonce,
            outstanding: prev?.outstanding ?? [],
            error: e instanceof Error ? e.message : String(e),
          }))
        }
      })
    return () => { cancelled = true }
  }, [reloadNonce])

  const reload = useCallback(async () => {
    setPurchasesByMember({})
    setExpandedId(null)
    setActionError(null)
    setReloadNonce((n) => n + 1)
  }, [])

  const toggleExpand = useCallback(async (memberId: Id) => {
    setExpandedId((prev) => (prev === memberId ? null : memberId))
    if (purchasesByMember[String(memberId)] === undefined) {
      try {
        const rows = await listMemberPurchases(memberId)
        setPurchasesByMember((prev) => ({ ...prev, [String(memberId)]: rows }))
      } catch (e: unknown) {
        setActionError(e instanceof Error ? e.message : String(e))
      }
    }
  }, [purchasesByMember])

  const registerReimbursement = useCallback(async (body: Record<string, unknown>) => {
    await createReimbursement(body)
    await reload()
  }, [reload])

  const markReimbursed = useCallback(async (memberId: Id, body: Record<string, unknown> = {}) => {
    await reimburseMemberFull(memberId, body)
    await reload()
  }, [reload])

  return {
    outstanding,
    loading,
    error,
    expandedId,
    purchasesByMember,
    toggleExpand,
    reload,
    registerReimbursement,
    markReimbursed,
  }
}
