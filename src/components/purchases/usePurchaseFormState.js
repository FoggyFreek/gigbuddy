import { useEffect, useMemo, useState } from 'react'
import {
  deletePurchase,
  getPurchase,
  registerPurchasePayment,
  updatePurchase,
} from '../../api/purchases.js'
import { computePurchaseTotals } from '../../utils/purchaseTotals.js'
import { buildPurchasePayload, emptyLine, purchaseToForm } from './purchaseFormHelpers.js'

// Owns the editable purchase form: loads the purchase, derives totals, mutates
// lines/fields, and runs the save / approve / delete / register-payment
// lifecycle. Purchases are always created upfront (NewPurchaseDialog) and then
// edited here, so this hook only deals with an existing purchase.
export function usePurchaseFormState({ purchaseId, onClose, onPurchaseUpdate }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [form, setForm] = useState(null)
  const [purchase, setPurchase] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getPurchase(purchaseId)
      .then((data) => {
        if (cancelled) return
        setPurchase(data)
        setForm(purchaseToForm(data))
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [purchaseId])

  const finalized = Boolean(purchase?.finalized_at)
  const readOnly = finalized
  const isPaid = purchase?.status === 'paid'

  const totals = useMemo(
    () => computePurchaseTotals({ lines: form?.lines || [] }),
    [form?.lines],
  )

  function patchForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function patchLine(index, patch) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }))
  }

  function addLine() {
    setForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine(prev.lines.length)] }))
  }

  function removeLine(index) {
    setForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }))
  }

  // status is 'draft' (Save as draft) or 'approved' (Approve).
  async function handleSave(status) {
    if (!form.supplier_name?.trim()) {
      setError('Supplier is required')
      return
    }
    try {
      setSaving(true)
      setError(null)
      await updatePurchase(purchaseId, buildPurchasePayload(form, status))
      onClose(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRegisterPayment() {
    try {
      setSaving(true)
      setError(null)
      const updated = await registerPurchasePayment(purchaseId, {})
      setPurchase(updated)
      onPurchaseUpdate?.(purchaseId, { status: updated.status })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    setDeleteDialogOpen(true)
  }

  async function confirmDelete() {
    setDeleteDialogOpen(false)
    try {
      await deletePurchase(purchaseId)
      onClose(true)
    } catch (e) {
      setError(e.message)
    }
  }

  return {
    loading,
    error,
    setError,
    saving,
    form,
    purchase,
    finalized,
    readOnly,
    isPaid,
    totals,
    deleteDialogOpen,
    setDeleteDialogOpen,
    patchForm,
    patchLine,
    addLine,
    removeLine,
    handleSave,
    handleRegisterPayment,
    handleDelete,
    confirmDelete,
  }
}
