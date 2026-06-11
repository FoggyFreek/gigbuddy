import { useEffect, useMemo, useState } from 'react'
import {
  deletePurchase,
  deletePurchaseAttachment,
  getPurchase,
  registerPurchasePayment,
  updatePurchase,
  uploadPurchaseAttachment,
} from '../../api/purchases.js'
import { getAccountingSettings, listAccounts } from '../../api/accounts.js'
import { listMembers } from '../../api/bandMembers.js'
import { computePurchaseTotals } from '../../utils/purchaseTotals.js'
import { buildPurchasePayload, emptyLine, purchaseToForm } from './purchaseFormHelpers.js'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

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
  const [accounts, setAccounts] = useState([])
  const [expenseAccounts, setExpenseAccounts] = useState([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [accountingSettings, setAccountingSettings] = useState(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [lineErrors, setLineErrors] = useState([])
  const [bandMembers, setBandMembers] = useState([])
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentError, setPaymentError] = useState(null)
  const [paymentMethod, setPaymentMethod] = useState('bank')
  const [paidOn, setPaidOn] = useState(todayIso())
  const [paidByBandMemberId, setPaidByBandMemberId] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [attachmentsBusy, setAttachmentsBusy] = useState(false)
  const [attachmentError, setAttachmentError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getPurchase(purchaseId)
      .then((data) => {
        if (cancelled) return
        setPurchase(data)
        setForm(purchaseToForm(data))
        setAttachments(data.attachments || [])
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [purchaseId])

  // Expense accounts load independently so a slow/failed fetch never blocks the
  // form (which is gated only on the purchase load above).
  useEffect(() => {
    let cancelled = false
    listAccounts()
      .then((accounts) => {
        if (cancelled) return
        setAccounts(accounts || [])
        setExpenseAccounts(
          (accounts || []).filter(
            (a) => a.is_active && (a.type === 'expense' || a.type === 'cost_of_goods_sold'),
          ),
        )
      })
      .catch(() => { /* best-effort; leave expenseAccounts empty */ })
      .finally(() => { if (!cancelled) setAccountsLoaded(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    getAccountingSettings()
      .then((settings) => {
        if (!cancelled) setAccountingSettings(settings || null)
      })
      .catch(() => { if (!cancelled) setAccountingSettings(null) })
      .finally(() => { if (!cancelled) setSettingsLoaded(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    listMembers()
      .then((members) => {
        if (!cancelled) setBandMembers(members || [])
      })
      .catch(() => { if (!cancelled) setBandMembers([]) })
    return () => { cancelled = true }
  }, [])

  const finalized = Boolean(purchase?.finalized_at)
  const readOnly = finalized
  const isPaid = purchase?.status === 'paid'

  const totals = useMemo(
    () => computePurchaseTotals({ lines: form?.lines || [] }),
    [form?.lines],
  )
  const paymentAccount = useMemo(() => {
    const code = accountingSettings?.primary_checking_account_code
    if (!code) return null
    return accounts.find((account) => account.code === code) || { code }
  }, [accountingSettings?.primary_checking_account_code, accounts])

  function patchForm(patch) {
    setError(null)
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function patchLine(index, patch) {
    setError(null)
    setLineErrors((prev) => prev.map((err, i) => {
      if (i !== index) return err
      const next = { ...err }
      for (const key of Object.keys(patch)) delete next[key]
      return next
    }))
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }))
  }

  function addLine() {
    setError(null)
    setForm((prev) => ({ ...prev, lines: [...prev.lines, emptyLine(prev.lines.length)] }))
  }

  function removeLine(index) {
    setError(null)
    setLineErrors((prev) => prev.filter((_, i) => i !== index))
    setForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }))
  }

  function validateApprovalFields() {
    const needsExplicitExpenseAccount =
      settingsLoaded && !accountingSettings?.default_expense_account_code
    const nextLineErrors = form.lines.map((line) => {
      const err = {}
      if (!String(line.description || '').trim()) {
        err.description = 'Enter a description'
      }
      if (needsExplicitExpenseAccount && !line.account_code) {
        err.account_code = 'Choose an expense account'
      }
      if (Number(line.amount_incl_cents) <= 0) {
        err.amount_incl_cents = 'Enter an amount greater than zero'
      }
      return err
    })
    const hasLineErrors = nextLineErrors.some((err) => Object.keys(err).length > 0)
    setLineErrors(nextLineErrors)
    if (hasLineErrors) {
      setError('Complete the highlighted purchase line fields before approving.')
      return false
    }
    return true
  }

  function applySaveError(e) {
    if (e.code === 'accounting_not_configured' && e.field === 'default_expense_account_code') {
      setLineErrors(form.lines.map((line) => (
        line.account_code ? {} : { account_code: 'Choose an expense account' }
      )))
      setError('Choose an expense account for each line, or configure a default expense account in Accounting Settings.')
      return
    }
    if (e.code === 'purchase_line_validation' && Array.isArray(e.fields)) {
      const nextLineErrors = form.lines.map(() => ({}))
      for (const fieldError of e.fields) {
        if (fieldError.line == null || !fieldError.field) continue
        nextLineErrors[fieldError.line] = {
          ...nextLineErrors[fieldError.line],
          [fieldError.field]: fieldError.message || 'Required',
        }
      }
      setLineErrors(nextLineErrors)
      setError(e.message)
      return
    }
    setError(e.message)
  }

  // status is 'draft' (Save as draft) or 'approved' (Approve).
  async function handleSave(status) {
    setLineErrors([])
    if (!form.supplier_name?.trim()) {
      setError('Supplier is required')
      return
    }
    if (status === 'approved' && !validateApprovalFields()) return
    // Once accounts are known, block a line that still references an account that
    // is no longer an active expense account — the backend would reject it.
    if (accountsLoaded) {
      const validCodes = new Set(expenseAccounts.map((a) => a.code))
      const badIdx = form.lines.findIndex((l) => l.account_code && !validCodes.has(l.account_code))
      if (badIdx >= 0) {
        setError(`Replace the inactive expense account on line ${badIdx + 1}`)
        return
      }
    }
    try {
      setSaving(true)
      setError(null)
      await updatePurchase(purchaseId, buildPurchasePayload(form, status))
      onClose(true)
    } catch (e) {
      applySaveError(e)
    } finally {
      setSaving(false)
    }
  }

  function openPaymentDialog() {
    setPaymentError(null)
    setPaymentMethod('bank')
    setPaidOn(todayIso())
    setPaidByBandMemberId(null)
    setPaymentDialogOpen(true)
  }

  function closePaymentDialog() {
    if (!saving) setPaymentDialogOpen(false)
  }

  async function handleRegisterPayment() {
    if (paymentMethod === 'member' && !paidByBandMemberId) {
      setPaymentError('Choose the band member who paid for this purchase')
      return
    }
    try {
      setSaving(true)
      setError(null)
      setPaymentError(null)
      const payload = {
        method: paymentMethod,
        paid_on: paidOn || todayIso(),
      }
      if (paymentMethod === 'member') payload.paid_by_band_member_id = paidByBandMemberId
      const updated = await registerPurchasePayment(purchaseId, payload)
      setPurchase(updated)
      setPaymentDialogOpen(false)
      onPurchaseUpdate?.(purchaseId, {
        status: updated.status,
        payment_method: updated.payment_method,
        paid_by_band_member_id: updated.paid_by_band_member_id,
        paid_at: updated.paid_at,
      })
    } catch (e) {
      setPaymentError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleUploadAttachments(files) {
    setAttachmentError(null)
    setAttachmentsBusy(true)
    try {
      for (const file of files) {
        const created = await uploadPurchaseAttachment(purchaseId, file)
        setAttachments((prev) => [...prev, created])
      }
    } catch (e) {
      setAttachmentError(e.message)
    } finally {
      setAttachmentsBusy(false)
    }
  }

  async function handleDeleteAttachment(attachmentId) {
    setAttachmentError(null)
    setAttachmentsBusy(true)
    try {
      await deletePurchaseAttachment(purchaseId, attachmentId)
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
    } catch (e) {
      setAttachmentError(e.message)
    } finally {
      setAttachmentsBusy(false)
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
    expenseAccounts,
    paymentAccount,
    lineErrors,
    bandMembers,
    paymentDialogOpen,
    paymentError,
    paymentMethod,
    setPaymentMethod,
    paidOn,
    setPaidOn,
    paidByBandMemberId,
    setPaidByBandMemberId,
    deleteDialogOpen,
    setDeleteDialogOpen,
    patchForm,
    patchLine,
    addLine,
    removeLine,
    handleSave,
    openPaymentDialog,
    closePaymentDialog,
    handleRegisterPayment,
    handleDelete,
    confirmDelete,
    attachments,
    attachmentsBusy,
    attachmentError,
    handleUploadAttachments,
    handleDeleteAttachment,
  }
}
