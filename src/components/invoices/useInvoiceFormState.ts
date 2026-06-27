import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  deleteInvoice,
  getInvoice,
  updateInvoice,
} from '../../api/invoices.ts'
import { computeInvoiceTotals } from '../../utils/invoiceTotals.ts'
import type { Invoice, InvoiceStatus, Tenant, Id } from '../../types/entities.ts'
import {
  addDays,
  buildInvoicePayload,
  emptyDraft,
  invoiceToForm,
} from './invoiceFormHelpers.ts'
import type { InvoiceForm, InvoiceFormLine } from './invoiceFormHelpers.ts'

interface UseInvoiceFormStateArgs {
  invoiceId: Id
  onClose: (updated?: boolean) => void
  onInvoiceUpdate?: (id: Id, patch: Partial<Invoice>) => void
}

export interface UseInvoiceFormStateResult {
  loading: boolean
  error: string | null
  setError: (msg: string | null) => void
  saving: boolean
  form: InvoiceForm
  tenant: Tenant | null
  invoice: Invoice | null
  setInvoice: (invoice: Invoice) => void
  finalized: boolean
  readOnly: boolean
  appliesKor: boolean
  totals: ReturnType<typeof computeInvoiceTotals>
  memoOpen: boolean
  setMemoOpen: (open: boolean) => void
  discountOpen: boolean
  setDiscountOpen: (open: boolean) => void
  deleteDialogOpen: boolean
  setDeleteDialogOpen: (open: boolean) => void
  voidDialogOpen: boolean
  setVoidDialogOpen: (open: boolean) => void
  confirmVoid: () => Promise<void>
  patchForm: (patch: Partial<InvoiceForm>) => void
  patchLine: (index: number, patch: Partial<InvoiceFormLine>) => void
  addLine: () => void
  removeLine: (index: number) => void
  handleSave: () => Promise<void>
  handleStatusChange: (newStatus: InvoiceStatus) => void | Promise<void>
  handleDelete: () => void
  confirmDelete: () => Promise<void>
}

// Owns the editable invoice form: data loading, derived totals, line/field
// mutations, and the save/delete/status lifecycle. Logo and EML side effects
// live in their own hooks (see useInvoiceDetailsState).
export function useInvoiceFormState({ invoiceId, onClose, onInvoiceUpdate }: UseInvoiceFormStateArgs): UseInvoiceFormStateResult {
  const { t } = useTranslation('invoices')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [voidDialogOpen, setVoidDialogOpen] = useState(false)
  const [form, setForm] = useState<InvoiceForm>(() => emptyDraft())
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [memoOpen, setMemoOpen] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getInvoice(invoiceId)
      .then((data) => {
        if (cancelled) return
        setInvoice(data)
        if (data.tenant) setTenant(data.tenant)
        setForm(invoiceToForm(data as Record<string, unknown>))
        const raw = data as Record<string, unknown>
        setMemoOpen(Boolean(raw.memo))
        setDiscountOpen(Number(raw.discount_pct) > 0 || Number(raw.discount_cents) > 0)
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [invoiceId])

  const finalized = Boolean(invoice?.finalized_at)
  const readOnly = finalized
  const appliesKor = Boolean(tenant?.applies_kor)

  const totals = useMemo(() => computeInvoiceTotals({
    lines: form.lines,
    taxInclusive: form.tax_inclusive,
    discountType: form.discount_type,
    discountPct: form.discount_pct,
    discountCents: form.discount_cents,
    appliesKor,
  }), [form.lines, form.tax_inclusive, form.discount_type, form.discount_pct, form.discount_cents, appliesKor])

  // due_date is derived from issue_date + payment_term_days. Recompute it in the
  // same transition that changes either input, rather than in a post-render
  // effect, so the derived update is explicit and synchronous.
  function patchForm(patch: Partial<InvoiceForm>) {
    setForm((prev) => {
      const next = { ...prev, ...patch }
      if ('issue_date' in patch || 'payment_term_days' in patch) {
        const computed = addDays(next.issue_date, next.payment_term_days || 14)
        if (computed) next.due_date = computed
      }
      return next
    })
  }

  function patchLine(index: number, patch: Partial<InvoiceFormLine>) {
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
          _key: crypto.randomUUID(),
          description: '',
          quantity: 1,
          unit_price_cents: 0,
          tax_percentage: appliesKor ? 0 : Number(tenant?.tax_percentage ?? 9),
          position: prev.lines.length,
        },
      ],
    }))
  }

  function removeLine(index: number) {
    setForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }))
  }

  async function handleSave() {
    if (!form.customer_name?.trim()) {
      setError(t($ => $.validation.customerRequired))
      return
    }
    if (!form.lines.length || !form.lines.some((l) => l.description?.trim())) {
      setError(t($ => $.validation.lineRequired))
      return
    }
    try {
      setSaving(true)
      setError(null)
      await updateInvoice(invoiceId, buildInvoicePayload(form))
      onClose(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function applyStatusChange(newStatus: InvoiceStatus) {
    try {
      setSaving(true)
      setError(null)
      const updated = await updateInvoice(invoiceId, { status: newStatus })
      setInvoice(updated)
      onInvoiceUpdate?.(invoiceId, { status: updated.status })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // Voiding is irreversible and has side effects (ledger reversal, payment-link
  // removal), so it goes through a confirmation dialog first.
  function handleStatusChange(newStatus: InvoiceStatus) {
    if (newStatus === 'void' && invoice?.status !== 'void') {
      setVoidDialogOpen(true)
      return
    }
    return applyStatusChange(newStatus)
  }

  async function confirmVoid() {
    setVoidDialogOpen(false)
    await applyStatusChange('void')
  }

  function handleDelete() {
    setDeleteDialogOpen(true)
  }

  async function confirmDelete() {
    setDeleteDialogOpen(false)
    try {
      await deleteInvoice(invoiceId)
      onClose(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return {
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
    voidDialogOpen,
    setVoidDialogOpen,
    confirmVoid,
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
