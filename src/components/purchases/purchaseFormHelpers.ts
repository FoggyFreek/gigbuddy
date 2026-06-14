import type { PurchaseLine, Id } from '../../types/entities.ts'

export const TAX_RATES: number[] = [21, 9, 0]

/** One editable line inside the purchase form (includes React key and merch fields). */
export interface PurchaseFormLine extends Omit<PurchaseLine, 'id' | 'expense_category'> {
  _key: string
  description: string
  account_code: string
  tax_rate: number
  amount_incl_cents: number
  position: number
  product_id: Id | null
  quantity: number | null
}

/** The editable purchase form shape used by usePurchaseFormState. */
export interface PurchaseForm {
  receipt_number?: number | null
  supplier_name: string
  supplier_contact_id: Id | null
  receipt_date: string | null
  due_date: string | null
  currency: string
  memo: string | null
  lines: PurchaseFormLine[]
}

// Stable per-line React key, independent of array position (which shifts on
// add/remove). Whitelisted out of the API payload by buildPurchasePayload.
let lineKeySeq = 0
export function nextLineKey(): string {
  lineKeySeq += 1
  return `pl${lineKeySeq}`
}

export function emptyLine(position = 0): PurchaseFormLine {
  return { _key: nextLineKey(), description: '', account_code: '', tax_rate: 21, amount_incl_cents: 0, position, product_id: null, quantity: null }
}

export function emptyDraft(): PurchaseForm {
  const receiptDate = new Date().toISOString().slice(0, 10)
  return {
    supplier_name: '',
    supplier_contact_id: null,
    receipt_date: receiptDate,
    due_date: null,
    currency: 'EUR',
    memo: null,
    lines: [emptyLine(0)],
  }
}

/** Maps a loaded purchase row to the editable form shape. */
export function purchaseToForm(data: Record<string, unknown> & { lines?: PurchaseLine[] }): PurchaseForm {
  return {
    receipt_number: (data.receipt_number as number | null) ?? null,
    supplier_name: String(data.supplier_name || ''),
    supplier_contact_id: (data.supplier_contact_id as Id | null) ?? null,
    receipt_date: data.receipt_date ? String(data.receipt_date).slice(0, 10) : null,
    due_date: data.due_date ? String(data.due_date).slice(0, 10) : null,
    currency: String(data.currency || 'EUR'),
    memo: data.memo ? String(data.memo) : null,
    lines: (data.lines || []).map((l, i) => ({
      _key: nextLineKey(),
      description: l.description || '',
      account_code: l.account_code || '',
      tax_rate: Number(l.tax_rate) || 0,
      amount_incl_cents: Number(l.amount_incl_cents) || 0,
      position: l.position ?? i,
      product_id: (l as Record<string, unknown>).product_id as Id | null ?? null,
      quantity: (l as Record<string, unknown>).quantity as number | null ?? null,
    })),
  }
}

/** Builds the API payload from the current form state. */
export function buildPurchasePayload(form: PurchaseForm, status?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    supplier_name: form.supplier_name?.trim() || '',
    supplier_contact_id: form.supplier_contact_id ?? null,
    receipt_date: form.receipt_date,
    due_date: form.due_date || null,
    currency: form.currency || 'EUR',
    memo: form.memo || null,
    lines: form.lines.map((l, i) => ({
      description: l.description || '',
      account_code: l.account_code?.trim() || null,
      tax_rate: Number(l.tax_rate) || 0,
      amount_incl_cents: Math.round(Number(l.amount_incl_cents) || 0),
      position: i,
      product_id: l.product_id ?? null,
      quantity: l.product_id ? (Number(l.quantity) || null) : null,
    })),
  }
  if (status) payload.status = status
  if (form.receipt_number != null) payload.receipt_number = Number(form.receipt_number)
  return payload
}
