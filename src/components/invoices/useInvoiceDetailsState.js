import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createInvoice,
  deleteInvoice,
  downloadInvoiceEml,
  getInvoice,
  getInvoiceEmlDefaults,
  removeInvoiceLogo,
  updateInvoice,
  uploadInvoiceLogo,
} from '../../api/invoices.js'
import { computeInvoiceTotals } from '../../utils/invoiceTotals.js'
import {
  addDays,
  buildInvoicePayload,
  emptyDraft,
  invoiceToForm,
} from './invoiceFormHelpers.js'

// Owns all editing state, data loading, derived totals, and action handlers for
// the invoice detail view. The component is left to render from these values.
export function useInvoiceDetailsState({ mode, draft, invoiceId, onClose }) {
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
  const [logoBusy, setLogoBusy] = useState(false)
  const logoInputRef = useRef(null)
  const [emlDialogOpen, setEmlDialogOpen] = useState(false)
  const [emlMessage, setEmlMessage] = useState('')
  const [emlLoading, setEmlLoading] = useState(false)
  const [emlBusy, setEmlBusy] = useState(false)
  const [emlError, setEmlError] = useState(null)

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

  async function openEmlDialog() {
    setEmlDialogOpen(true)
    setEmlError(null)
    setEmlMessage('')
    setEmlLoading(true)
    try {
      const defaults = await getInvoiceEmlDefaults(invoiceId)
      setEmlMessage(defaults.personalMessage)
    } catch (err) {
      setEmlError(err.message)
    } finally {
      setEmlLoading(false)
    }
  }

  async function handleEmlDownload() {
    setEmlBusy(true)
    setEmlError(null)
    try {
      const blob = await downloadInvoiceEml(invoiceId, emlMessage)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeNumber = (invoice?.invoice_number || 'concept').replaceAll(/[^a-zA-Z0-9-]/g, '-')
      a.download = `factuur-${safeNumber}.eml`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setEmlDialogOpen(false)
    } catch (err) {
      setEmlError(err.message)
    } finally {
      setEmlBusy(false)
    }
  }

  async function handleLogoFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!isEdit) {
      setError('Save the invoice first, then upload a custom logo.')
      return
    }
    try {
      setLogoBusy(true)
      setError(null)
      await uploadInvoiceLogo(invoiceId, file)
      const refreshed = await getInvoice(invoiceId)
      setInvoice(refreshed)
    } catch (err) {
      setError(err.message)
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleLogoRemove() {
    if (!isEdit) return
    try {
      setLogoBusy(true)
      await removeInvoiceLogo(invoiceId)
      const refreshed = await getInvoice(invoiceId)
      setInvoice(refreshed)
    } catch (err) {
      setError(err.message)
    } finally {
      setLogoBusy(false)
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
    logoBusy,
    logoInputRef,
    deleteDialogOpen,
    setDeleteDialogOpen,
    emlDialogOpen,
    setEmlDialogOpen,
    emlMessage,
    setEmlMessage,
    emlLoading,
    emlBusy,
    emlError,
    patchForm,
    patchLine,
    addLine,
    removeLine,
    handleSave,
    handleStatusChange,
    handleDelete,
    confirmDelete,
    openEmlDialog,
    handleEmlDownload,
    handleLogoFile,
    handleLogoRemove,
  }
}
