export const TAX_RATES = [21, 9, 0]

export function emptyLine(position = 0) {
  return { description: '', expense_category: '', tax_rate: 21, amount_incl_cents: 0, position }
}

export function emptyDraft() {
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

// Maps a loaded purchase row to the editable form shape.
export function purchaseToForm(data) {
  return {
    receipt_number: data.receipt_number ?? null,
    supplier_name: data.supplier_name || '',
    supplier_contact_id: data.supplier_contact_id ?? null,
    receipt_date: data.receipt_date ? String(data.receipt_date).slice(0, 10) : null,
    due_date: data.due_date ? String(data.due_date).slice(0, 10) : null,
    currency: data.currency || 'EUR',
    memo: data.memo || null,
    lines: (data.lines || []).map((l, i) => ({
      description: l.description || '',
      expense_category: l.expense_category || '',
      tax_rate: Number(l.tax_rate) || 0,
      amount_incl_cents: Number(l.amount_incl_cents) || 0,
      position: l.position ?? i,
    })),
  }
}

// Builds the API payload from the current form state. status is supplied by the
// caller (Approve vs Save as draft).
export function buildPurchasePayload(form, status) {
  const payload = {
    supplier_name: form.supplier_name?.trim() || '',
    supplier_contact_id: form.supplier_contact_id ?? null,
    receipt_date: form.receipt_date,
    due_date: form.due_date || null,
    currency: form.currency || 'EUR',
    memo: form.memo || null,
    lines: form.lines.map((l, i) => ({
      description: l.description || '',
      expense_category: l.expense_category?.trim() || null,
      tax_rate: Number(l.tax_rate) || 0,
      amount_incl_cents: Math.round(Number(l.amount_incl_cents) || 0),
      position: i,
    })),
  }
  if (status) payload.status = status
  if (form.receipt_number != null) payload.receipt_number = Number(form.receipt_number)
  return payload
}
