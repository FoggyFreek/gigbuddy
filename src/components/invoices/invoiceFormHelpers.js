export function emptyDraft(taxPct = 9) {
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

export function parseEuroInput(value) {
  if (value === '' || value == null) return 0
  const cleaned = String(value).replaceAll(/[^\d,.-]/g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100)
}

export function centsToEditableEuro(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2)
}

export function addDays(isoDate, days) {
  if (!isoDate) return null
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// Maps a loaded invoice row to the editable form shape.
export function invoiceToForm(data) {
  return {
    gig_id: data.gig_id,
    issue_date: data.issue_date ? String(data.issue_date).slice(0, 10) : null,
    due_date: data.due_date ? String(data.due_date).slice(0, 10) : null,
    payment_term_days: data.payment_term_days || 14,
    customer_name: data.customer_name || '',
    customer_contact_title: data.customer_contact_title || '',
    customer_contact_given_name: data.customer_contact_given_name || '',
    customer_contact_family_name: data.customer_contact_family_name || '',
    customer_address_street: data.customer_address_street || '',
    customer_address_postal_code: data.customer_address_postal_code || '',
    customer_address_city: data.customer_address_city || '',
    customer_address_country: data.customer_address_country || '',
    customer_email: data.customer_email || '',
    customer_kvk: data.customer_kvk || '',
    customer_tax_id: data.customer_tax_id || '',
    memo: data.memo || null,
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

// Builds the API payload from the current form state.
export function buildInvoicePayload(form) {
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
