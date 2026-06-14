import type { InvoiceLine } from '../../types/entities.ts'

/** The editable form shape used by useInvoiceFormState. */
export interface InvoiceForm {
  gig_id: number | null
  issue_date: string | null
  due_date: string | null
  payment_term_days: number
  customer_name: string
  customer_contact_title: string
  customer_contact_given_name: string
  customer_contact_family_name: string
  customer_address_street: string
  customer_address_postal_code: string
  customer_address_city: string
  customer_address_country: string
  customer_email: string
  customer_kvk: string
  customer_tax_id: string
  memo: string | null
  tax_inclusive: boolean
  invert_logo: boolean
  discount_type: 'pct' | 'eur'
  discount_pct: number
  discount_cents: number
  lines: InvoiceFormLine[]
}

/** One editable line inside the invoice form. */
export interface InvoiceFormLine {
  description: string
  quantity: number
  unit_price_cents: number
  tax_percentage: number
  position: number
}

export function emptyDraft(taxPct = 9): InvoiceForm {
  const issueDate = new Date().toISOString().slice(0, 10)
  return {
    gig_id: null,
    issue_date: issueDate,
    due_date: addDays(issueDate, 14),
    payment_term_days: 14,
    customer_name: '',
    customer_contact_title: '',
    customer_contact_given_name: '',
    customer_contact_family_name: '',
    customer_address_street: '',
    customer_address_postal_code: '',
    customer_address_city: '',
    customer_address_country: 'NL',
    customer_email: '',
    customer_kvk: '',
    customer_tax_id: '',
    memo: null,
    tax_inclusive: false,
    invert_logo: false,
    discount_type: 'pct',
    discount_pct: 0,
    discount_cents: 0,
    lines: [
      { description: '', quantity: 1, unit_price_cents: 0, tax_percentage: taxPct, position: 0 },
    ],
  }
}

export function parseEuroInput(value: string | number | null | undefined): number {
  if (value === '' || value == null) return 0
  const cleaned = String(value).replaceAll(/[^\d,.-]/g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100)
}

export function centsToEditableEuro(cents: number | string | null | undefined): string {
  return ((Number(cents) || 0) / 100).toFixed(2)
}

export function addDays(isoDate: string | null | undefined, days: number): string | null {
  if (!isoDate) return null
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Maps a loaded invoice row to the editable form shape. */
export function invoiceToForm(data: Record<string, unknown> & { lines?: InvoiceLine[] }): InvoiceForm {
  return {
    gig_id: (data.gig_id as number | null) ?? null,
    issue_date: data.issue_date ? String(data.issue_date).slice(0, 10) : null,
    due_date: data.due_date ? String(data.due_date).slice(0, 10) : null,
    payment_term_days: Number(data.payment_term_days) || 14,
    customer_name: String(data.customer_name || ''),
    customer_contact_title: String(data.customer_contact_title || ''),
    customer_contact_given_name: String(data.customer_contact_given_name || ''),
    customer_contact_family_name: String(data.customer_contact_family_name || ''),
    customer_address_street: String(data.customer_address_street || ''),
    customer_address_postal_code: String(data.customer_address_postal_code || ''),
    customer_address_city: String(data.customer_address_city || ''),
    customer_address_country: String(data.customer_address_country || ''),
    customer_email: String(data.customer_email || ''),
    customer_kvk: String(data.customer_kvk || ''),
    customer_tax_id: String(data.customer_tax_id || ''),
    memo: data.memo ? String(data.memo) : null,
    tax_inclusive: !!data.tax_inclusive,
    invert_logo: !!data.invert_logo,
    discount_type: data.discount_type === 'pct' ? 'pct' : 'eur',
    discount_pct: Number(data.discount_pct) || 0,
    discount_cents: Number(data.discount_cents) || 0,
    lines: (data.lines || []).map((l, i) => ({
      description: l.description || '',
      quantity: Number(l.quantity) || 1,
      unit_price_cents: Number(l.unit_price_cents) || 0,
      tax_percentage: Number(l.tax_percentage) || 0,
      position: l.position ?? i,
    })),
  }
}

/** Builds the API payload from the current form state. */
export function buildInvoicePayload(form: InvoiceForm): Record<string, unknown> {
  return {
    gig_id: form.gig_id ?? null,
    issue_date: form.issue_date,
    due_date: form.due_date,
    payment_term_days: form.payment_term_days,
    customer_name: form.customer_name?.trim() || '',
    customer_contact_title: form.customer_contact_title?.trim() || null,
    customer_contact_given_name: form.customer_contact_given_name?.trim() || null,
    customer_contact_family_name: form.customer_contact_family_name?.trim() || null,
    customer_address_street: form.customer_address_street || null,
    customer_address_postal_code: form.customer_address_postal_code || null,
    customer_address_city: form.customer_address_city || null,
    customer_address_country: form.customer_address_country || null,
    customer_email: form.customer_email || null,
    customer_kvk: form.customer_kvk || null,
    customer_tax_id: form.customer_tax_id || null,
    memo: form.memo || null,
    tax_inclusive: !!form.tax_inclusive,
    invert_logo: !!form.invert_logo,
    discount_type: form.discount_type,
    discount_pct: form.discount_type === 'pct' ? Math.max(0, Number(form.discount_pct) || 0) : 0,
    discount_cents: form.discount_type === 'eur' ? Math.max(0, Math.round(Number(form.discount_cents) || 0)) : 0,
    lines: form.lines.map((l, i) => ({
      description: l.description || '',
      quantity: Number(l.quantity) || 0,
      unit_price_cents: Math.round(Number(l.unit_price_cents) || 0),
      tax_percentage: Number(l.tax_percentage) || 0,
      position: i,
    })),
  }
}
