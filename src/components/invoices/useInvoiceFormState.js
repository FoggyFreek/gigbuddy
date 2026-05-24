import { useEffect, useMemo, useState } from 'react'
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  updateInvoice,
} from '../../api/invoices.js'
import { computeInvoiceTotals } from '../../utils/invoiceTotals.js'
import {
  addDays,
  buildInvoicePayload,
  emptyDraft,
  invoiceToForm,
} from './invoiceFormHelpers.js'

// Owns the editable invoice form: data loading, derived totals, line/field
// mutations, and the save/delete/status lifecycle. Logo and EML side effects
// live in their own hooks (see useInvoiceDetailsState).
export function useInvoiceFormState({ mode, draft, invoiceId, onClose }) {
  const isEdit = mode === 'edit'
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [form, setForm] = useState(() => (draft ? draft.draft : emptyDraft()))
  const [tenant, setTenant] = useState(draft?.tenant || null)
  const [invoice, setInvoice] = useState(null)
  const [memoOpen, setMemoOpen] = useState(Boolean(draft?.draft?.memo))
  const [discountOpen, setDiscountOpen] = useState(
    Boolean(draft?.draft?.discount_pct > 0 || draft?.draft?.discount_cents > 0),
  )

  // Load invoice when editing.
  useEffect(() => {
    if (!isEdit) return undefined
    let cancelled = false
    setLoading(true)
    getInvoice(invoiceId)
      .then((data) => {
        if (cancelled) return
        setInvoice(data)
        if (data.tenant) setTenant(data.tenant)
        setForm(invoiceToForm(data))
        setMemoOpen(Boolean(data.memo))
        setDiscountOpen(Number(data.discount_pct) > 0 || Number(data.discount_cents) > 0)
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isEdit, invoiceId])

  // Recompute due_date when issue_date or payment_term_days change.
  useEffect(() => {
    if (!form.issue_date) return
    const computed = addDays(form.issue_date, form.payment_term_days || 14)
    if (computed && computed !== form.due_date) {
      setForm((prev) => ({ ...prev, due_date: computed }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.issue_date, form.payment_term_days])

  const finalized = Boolean(invoice?.finalized_at)
  const readOnly = isEdit && finalized
  const appliesKor = Boolean(tenant?.applies_kor)

  const totals = useMemo(() => computeInvoiceTotals({
    lines: form.lines,
    taxInclusive: form.tax_inclusive,
    discountType: form.discount_type,
    discountPct: form.discount_pct,
    discountCents: form.discount_cents,
    appliesKor,
  }), [form.lines, form.tax_inclusive, form.discount_type, form.discount_pct, form.discount_cents, appliesKor])

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
    setForm((prev) => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          description: '',
          quantity: 1,
          unit_price_cents: 0,
          tax_percentage: appliesKor ? 0 : Number(tenant?.tax_percentage ?? 9),
          position: prev.lines.length,
        },
      ],
    }))
  }

  function removeLine(index) {
    setForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }))
  }

  async function handleSave() {
    if (!form.customer_name?.trim()) {
      setError('Customer name is required')
      return
    }
    if (!form.lines.length || !form.lines.some((l) => l.description?.trim())) {
      setError('At least one line with a description is required')
      return
    }
    try {
      setSaving(true)
      setError(null)
      if (isEdit) {
        await updateInvoice(invoiceId, buildInvoicePayload(form))
      } else {
        await createInvoice(buildInvoicePayload(form))
      }
      onClose(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(newStatus) {
    if (!isEdit) return
    try {
      setSaving(true)
      setError(null)
      const updated = await updateInvoice(invoiceId, { status: newStatus })
      setInvoice(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    if (!isEdit) return
    setDeleteDialogOpen(true)
  }

  async function confirmDelete() {
    setDeleteDialogOpen(false)
    try {
      await deleteInvoice(invoiceId)
      onClose(true)
    } catch (e) {
      setError(e.message)
    }
  }

  return {
    isEdit,
    loading,
    error,
    setError,
    saving,
    form,
    tenant,
    invoice,
    setInvoice,
    finalized,
    readOnly,
    appliesKor,
    totals,
    memoOpen,
    setMemoOpen,
    discountOpen,
    setDiscountOpen,
    deleteDialogOpen,
    setDeleteDialogOpen,
    patchForm,
    patchLine,
    addLine,
    removeLine,
    handleSave,
    handleStatusChange,
    handleDelete,
    confirmDelete,
  }
}
