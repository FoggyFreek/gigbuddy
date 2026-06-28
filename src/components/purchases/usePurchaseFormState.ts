import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  deletePurchase,
  deletePurchaseAttachment,
  getPurchase,
  registerPurchasePayment,
  updatePurchase,
  uploadPurchaseAttachment,
} from '../../api/purchases.ts'
import { getAccountingSettings, listAccounts } from '../../api/accounts.ts'
import { listProducts } from '../../api/merch.ts'
import { listMembers } from '../../api/bandMembers.ts'
import { computePurchaseTotals } from '../../utils/purchaseTotals.ts'
import type { Purchase, PurchaseAttachment, PurchasePaymentMethod, PurchaseStatus, Account, AccountingSettings, Member, Product, Id } from '../../types/entities.ts'
import { buildPurchasePayload, emptyLine, purchaseToForm } from './purchaseFormHelpers.ts'
import type { PurchaseForm, PurchaseFormLine } from './purchaseFormHelpers.ts'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface UsePurchaseFormStateArgs {
  purchaseId: Id
  onClose: (updated?: boolean) => void
  onPurchaseUpdate?: (id: Id, patch: Partial<Purchase>) => void
}

/** Per-line validation errors keyed by field name. */
type LineErrors = Record<string, string>
type EditablePurchaseStatus = Exclude<PurchaseStatus, 'paid'>

export interface UsePurchaseFormStateResult {
  loading: boolean
  error: string | null
  setError: (msg: string | null) => void
  saving: boolean
  form: PurchaseForm | null
  purchase: Purchase | null
  finalized: boolean
  readOnly: boolean
  isPaid: boolean
  totals: ReturnType<typeof computePurchaseTotals>
  lineAccounts: Account[]
  products: Product[]
  paymentAccount: Account | { code: string } | null
  lineErrors: LineErrors[]
  bandMembers: Member[]
  paymentDialogOpen: boolean
  paymentError: string | null
  paymentMethod: PurchasePaymentMethod
  setPaymentMethod: (method: PurchasePaymentMethod) => void
  paidOn: string
  setPaidOn: (date: string) => void
  paidByBandMemberId: Id | null
  setPaidByBandMemberId: (id: Id | null) => void
  deleteDialogOpen: boolean
  setDeleteDialogOpen: (open: boolean) => void
  patchForm: (patch: Partial<PurchaseForm>) => void
  patchLine: (index: number, patch: Partial<PurchaseFormLine>) => void
  addLine: () => void
  removeLine: (index: number) => void
  handleSave: (status: EditablePurchaseStatus) => Promise<void>
  openPaymentDialog: () => void
  closePaymentDialog: () => void
  handleRegisterPayment: () => Promise<void>
  handleDelete: () => void
  confirmDelete: () => Promise<void>
  attachments: PurchaseAttachment[]
  attachmentsBusy: boolean
  attachmentError: string | null
  handleUploadAttachments: (files: File[]) => Promise<void>
  handleDeleteAttachment: (attachmentId: Id) => Promise<void>
}

// Owns the editable purchase form: loads the purchase, derives totals, mutates
// lines/fields, and runs the save / approve / delete / register-payment
// lifecycle. Purchases are always created upfront (NewPurchaseDialog) and then
// edited here, so this hook only deals with an existing purchase.
export function usePurchaseFormState({ purchaseId, onClose, onPurchaseUpdate }: UsePurchaseFormStateArgs): UsePurchaseFormStateResult {
  const { t } = useTranslation('purchases')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [form, setForm] = useState<PurchaseForm | null>(null)
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [lineAccounts, setLineAccounts] = useState<Account[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [accountingSettings, setAccountingSettings] = useState<AccountingSettings | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [lineErrors, setLineErrors] = useState<LineErrors[]>([])
  const [bandMembers, setBandMembers] = useState<Member[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('bank')
  const [paidOn, setPaidOn] = useState(todayIso())
  const [paidByBandMemberId, setPaidByBandMemberId] = useState<Id | null>(null)
  const [attachments, setAttachments] = useState<PurchaseAttachment[]>([])
  const [attachmentsBusy, setAttachmentsBusy] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getPurchase(purchaseId)
      .then((data) => {
        if (cancelled) return
        setPurchase(data)
        setForm(purchaseToForm(data as Record<string, unknown>))
        setAttachments((data.attachments as PurchaseAttachment[]) || [])
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [purchaseId])

  // Line accounts load independently so a slow/failed fetch never blocks the
  // form (which is gated only on the purchase load above). A purchase line may
  // book to an expense/COGS account or a capitalizable asset account (owned
  // gear) — the same set the backend accepts.
  useEffect(() => {
    let cancelled = false
    listAccounts()
      .then((accts) => {
        if (cancelled) return
        setAccounts(accts || [])
        setLineAccounts(
          (accts || []).filter(
            (a) => a.is_active && (
              a.type === 'expense'
              || a.type === 'cost_of_goods_sold'
              || (a.type === 'asset' && a.is_capitalizable)
            ),
          ),
        )
      })
      .catch(() => { /* best-effort; leave lineAccounts empty */ })
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

  // Products power the optional "stock a product" link per line; best-effort.
  useEffect(() => {
    let cancelled = false
    listProducts()
      .then((rows) => { if (!cancelled) setProducts(rows || []) })
      .catch(() => { if (!cancelled) setProducts([]) })
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

  function patchForm(patch: Partial<PurchaseForm>) {
    setError(null)
    setForm((prev) => prev ? { ...prev, ...patch } : prev)
  }

  function patchLine(index: number, patch: Partial<PurchaseFormLine>) {
    setError(null)
    setLineErrors((prev) => prev.map((err, i) => {
      if (i !== index) return err
      const next = { ...err }
      for (const key of Object.keys(patch)) delete next[key]
      return next
    }))
    setForm((prev) => prev ? ({
      ...prev,
      lines: prev.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }) : prev)
  }

  function addLine() {
    setError(null)
    setForm((prev) => prev ? ({ ...prev, lines: [...prev.lines, emptyLine(prev.lines.length)] }) : prev)
  }

  function removeLine(index: number) {
    setError(null)
    setLineErrors((prev) => prev.filter((_, i) => i !== index))
    setForm((prev) => prev ? ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }) : prev)
  }

  function validateApprovalFields(): boolean {
    if (!form) return false
    const needsExplicitExpenseAccount =
      settingsLoaded && !accountingSettings?.default_expense_account_code
    const nextLineErrors: LineErrors[] = form.lines.map((line) => {
      const err: LineErrors = {}
      if (!String(line.description || '').trim()) {
        err.description = t($ => $.validation.description)
      }
      if (needsExplicitExpenseAccount && !line.account_code) {
        err.account_code = t($ => $.validation.expenseAccount)
      }
      if (Number(line.amount_incl_cents) <= 0) {
        err.amount_incl_cents = t($ => $.validation.positiveAmount)
      }
      return err
    })
    const hasLineErrors = nextLineErrors.some((err) => Object.keys(err).length > 0)
    setLineErrors(nextLineErrors)
    if (hasLineErrors) {
      setError(t($ => $.validation.approvalIncomplete))
      return false
    }
    return true
  }

  function applySaveError(e: unknown) {
    const err = e as Record<string, unknown>
    if (form && err.code === 'accounting_not_configured' && err.field === 'default_expense_account_code') {
      setLineErrors(form.lines.map((line): LineErrors => (
        line.account_code ? {} : { account_code: t($ => $.validation.expenseAccount) }
      )))
      setError(t($ => $.validation.accountingSetup))
      return
    }
    if (form && err.code === 'purchase_line_validation' && Array.isArray(err.fields)) {
      const nextLineErrors: LineErrors[] = form.lines.map(() => ({}))
      for (const fieldError of err.fields as Array<{ line?: number; field?: string; message?: string }>) {
        if (fieldError.line == null || !fieldError.field) continue
        nextLineErrors[fieldError.line] = {
          ...nextLineErrors[fieldError.line],
          [fieldError.field]: fieldError.message || t($ => $.validation.required),
        }
      }
      setLineErrors(nextLineErrors)
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    setError(e instanceof Error ? e.message : String(e))
  }

  // status is 'draft' (Save as draft) or 'approved' (Approve).
  async function handleSave(status: EditablePurchaseStatus) {
    if (!form) return
    setLineErrors([])
    if (!form.supplier_name?.trim()) {
      setError(t($ => $.validation.supplierRequired))
      return
    }
    if (status === 'approved' && !validateApprovalFields()) return
    // Once accounts are known, block a line that still references an account that
    // is no longer a valid line account — the backend would reject it.
    if (accountsLoaded) {
      const validCodes = new Set(lineAccounts.map((a) => a.code))
      const badIdx = form.lines.findIndex((l) => l.account_code && !validCodes.has(l.account_code))
      if (badIdx >= 0) {
        setError(t($ => $.validation.inactiveAccount, { number: badIdx + 1 }))
        return
      }
    }
    try {
      setSaving(true)
      setError(null)
      const updated = await updatePurchase(purchaseId, buildPurchasePayload(form, status))
      // Stay in the detail after saving (draft or approve) so the user can keep
      // working — e.g. register payment right after approving — without
      // re-finding the purchase; refresh the list row in place instead of
      // closing.
      setPurchase(updated)
      setForm(purchaseToForm(updated as Record<string, unknown>))
      onPurchaseUpdate?.(purchaseId, {
        status: updated.status,
        due_date: updated.due_date,
        receipt_number: updated.receipt_number,
        supplier_name: updated.supplier_name,
        subtotal_cents: updated.subtotal_cents,
        total_cents: updated.total_cents,
      })
    } catch (e: unknown) {
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
      setPaymentError(t($ => $.validation.bandMemberRequired))
      return
    }
    try {
      setSaving(true)
      setError(null)
      setPaymentError(null)
      const payload: Record<string, unknown> = {
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
    } catch (e: unknown) {
      setPaymentError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleUploadAttachments(files: File[]) {
    setAttachmentError(null)
    setAttachmentsBusy(true)
    try {
      for (const file of files) {
        const created = await uploadPurchaseAttachment(purchaseId, file)
        setAttachments((prev) => [...prev, created])
      }
    } catch (e: unknown) {
      setAttachmentError(e instanceof Error ? e.message : String(e))
    } finally {
      setAttachmentsBusy(false)
    }
  }

  async function handleDeleteAttachment(attachmentId: Id) {
    setAttachmentError(null)
    setAttachmentsBusy(true)
    try {
      await deletePurchaseAttachment(purchaseId, attachmentId)
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
    } catch (e: unknown) {
      setAttachmentError(e instanceof Error ? e.message : String(e))
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
    purchase,
    finalized,
    readOnly,
    isPaid,
    totals,
    lineAccounts,
    products,
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
