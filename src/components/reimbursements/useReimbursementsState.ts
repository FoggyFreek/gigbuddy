import { useCallback, useEffect, useState } from 'react'
import {
  listOutstanding,
  listMemberPurchases,
  createReimbursement,
  reimburseMemberFull,
} from '../../api/reimbursements.ts'
import type { MemberOutstanding, Purchase, Id } from '../../types/entities.ts'

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
  const [outstanding, setOutstanding] = useState<MemberOutstanding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<Id | null>(null)
  const [purchasesByMember, setPurchasesByMember] = useState<Record<string, Purchase[]>>({})

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setOutstanding(await listOutstanding())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const reload = useCallback(async () => {
    setPurchasesByMember({})
    setExpandedId(null)
    await load()
  }, [load])

  const toggleExpand = useCallback(async (memberId: Id) => {
    setExpandedId((prev) => (prev === memberId ? null : memberId))
    if (purchasesByMember[String(memberId)] === undefined) {
      try {
        const rows = await listMemberPurchases(memberId)
        setPurchasesByMember((prev) => ({ ...prev, [String(memberId)]: rows }))
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
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
