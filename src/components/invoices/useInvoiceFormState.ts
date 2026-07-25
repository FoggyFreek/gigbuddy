import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  deleteInvoice,
  getInvoice,
  updateInvoice,
} from '../../api/invoices.ts'
import { computeInvoiceTotals } from '../../utils/invoiceTotals.ts'
import { korApplies } from '../../utils/vatRates.ts'
import { checkInvoiceReadyForIssue, isInvoiceIssueErrorCode } from '../../utils/invoiceReadiness.ts'
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
  /** Why this invoice cannot be issued yet (advisory preview), or null. */
  issueBlocker: { code: string, message: string } | null
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
  sentDialogOpen: boolean
  setSentDialogOpen: (open: boolean) => void
  confirmSent: () => Promise<void>
  paidDialogOpen: boolean
  setPaidDialogOpen: (open: boolean) => void
  confirmPaid: () => Promise<void>
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
  const [sentDialogOpen, setSentDialogOpen] = useState(false)
  const [paidDialogOpen, setPaidDialogOpen] = useState(false)
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
  // KOR is a Dutch-only exemption; it never zeroes VAT for a non-NL supplier.
  const appliesKor = Boolean(tenant?.applies_kor) && korApplies(tenant?.vat_country)

  // Server error codes ({ error, code }) are turned into a friendly, localized
  // sentence; anything else falls back to the message the API gave us.
  function describeError(e: unknown): string {
    const code = (e as { code?: unknown } | null)?.code
    if (isInvoiceIssueErrorCode(code)) return t($ => $.issueErrors[code])
    return e instanceof Error ? e.message : String(e)
  }

  const totals = useMemo(() => computeInvoiceTotals({
    lines: form.lines,
    taxInclusive: form.tax_inclusive,
    discountType: form.discount_type,
    discountPct: form.discount_pct,
    discountCents: form.discount_cents,
    appliesKor,
    reverseCharge: form.reverse_charge,
  }), [form.lines, form.tax_inclusive, form.discount_type, form.discount_pct, form.discount_cents, appliesKor, form.reverse_charge])

  // Live preview of the server's issuance-readiness invariant, so the send/paid
  // confirmations can name what is missing instead of letting the user hit a 422.
  // Advisory only — the backend re-checks the persisted state authoritatively.
  const issueBlocker = useMemo(() => {
    if (finalized) return null // already issued; the guard no longer applies
    const code = checkInvoiceReadyForIssue(
      {
        customer_name: form.customer_name,
        customer_address_street: form.customer_address_street,
        customer_address_city: form.customer_address_city,
        customer_address_country: form.customer_address_country,
        customer_tax_id: form.customer_tax_id,
        issue_date: form.issue_date,
        reverse_charge: form.reverse_charge,
        tax_cents: totals.taxCents,
        // The form holds the intent; the server holds the timestamp. A ticked box
        // stands in for an attestation covering the number now in the form.
        vies_checked_at: form.vies_checked ? (invoice?.vies_checked_at ?? 'pending') : null,
        vies_checked_vat_number: form.vies_checked ? form.customer_tax_id : null,
      },
      form.lines,
      tenant,
    )
    return code ? { code, message: t($ => $.issueErrors[code]) } : null
  }, [finalized, form, totals.taxCents, tenant, invoice?.vies_checked_at, t])

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
      // Changing the customer VAT number invalidates a prior VIES confirmation:
      // the issuer must re-check the new number before issuing.
      if ('customer_tax_id' in patch && !('vies_checked' in patch)) {
        next.vies_checked = false
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
      setError(describeError(e))
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
      setError(describeError(e))
    } finally {
      setSaving(false)
    }
  }

  // Every forward status change is confirmed first: each spells out its
  // consequences (finalization, ledger postings) before anything is PATCHed.
  function handleStatusChange(newStatus: InvoiceStatus) {
    if (newStatus === 'void' && invoice?.status !== 'void') {
      setVoidDialogOpen(true)
      return
    }
    if (newStatus === 'sent' && invoice?.status !== 'sent') {
      setSentDialogOpen(true)
      return
    }
    if (newStatus === 'paid' && invoice?.status !== 'paid') {
      setPaidDialogOpen(true)
      return
    }
    return applyStatusChange(newStatus)
  }

  async function confirmVoid() {
    setVoidDialogOpen(false)
    await applyStatusChange('void')
  }

  async function confirmSent() {
    setSentDialogOpen(false)
    await applyStatusChange('sent')
  }

  async function confirmPaid() {
    setPaidDialogOpen(false)
    await applyStatusChange('paid')
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
      setError(describeError(e))
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
    issueBlocker,
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
    sentDialogOpen,
    setSentDialogOpen,
    confirmSent,
    paidDialogOpen,
    setPaidDialogOpen,
    confirmPaid,
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
