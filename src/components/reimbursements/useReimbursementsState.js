import { useCallback, useEffect, useState } from 'react'
import {
  listOutstanding,
  listMemberPurchases,
  createReimbursement,
  reimburseMemberFull,
} from '../../api/reimbursements.js'

// Owns the Outstanding tab: the per-member outstanding list, the lazily-loaded
// drill-down of each member's purchases, and the register/mark-reimbursed
// actions (both reload the list so settled rows drop out).
export function useReimbursementsState() {
  const [outstanding, setOutstanding] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [purchasesByMember, setPurchasesByMember] = useState({})

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setOutstanding(await listOutstanding())
    } catch (e) {
      setError(e.message)
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

  const toggleExpand = useCallback(async (memberId) => {
    setExpandedId((prev) => (prev === memberId ? null : memberId))
    if (purchasesByMember[memberId] === undefined) {
      try {
        const rows = await listMemberPurchases(memberId)
        setPurchasesByMember((prev) => ({ ...prev, [memberId]: rows }))
      } catch (e) {
        setError(e.message)
      }
    }
  }, [purchasesByMember])

  const registerReimbursement = useCallback(async (body) => {
    await createReimbursement(body)
    await reload()
  }, [reload])

  const markReimbursed = useCallback(async (memberId, body = {}) => {
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
