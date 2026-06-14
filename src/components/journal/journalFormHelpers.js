// VAT rates a journal line may carry — same domain constants as purchases.
export const VAT_RATES = [21, 9, 0]

// Stable per-line React key, independent of array position (which shifts on
// add/remove/duplicate). Whitelisted out of the API payload by buildJournalPayload.
let lineKeySeq = 0
export function nextLineKey() {
  lineKeySeq += 1
  return `jl${lineKeySeq}`
}

export function emptyLine(position = 0) {
  return {
    _key: nextLineKey(),
    description: '',
    account_code: '',
    vat_rate: 0,
    side: null,            // 'debit' | 'credit'
    amount_cents: 0,
    balancing_account_code: '',
    position,
  }
}

// Maps a loaded journal row to the editable form shape.
export function journalToForm(journal) {
  return {
    id: journal.id,
    entry_number: journal.entry_number,
    entry_date: journal.entry_date ? String(journal.entry_date).slice(0, 10) : '',
    description: journal.description || '',
    status: journal.status,
    posted_transaction_id: journal.posted_transaction_id ?? null,
    lines: (journal.lines || []).map((l, i) => ({
      _key: nextLineKey(),
      description: l.description || '',
      account_code: l.account_code || '',
      vat_rate: Number(l.vat_rate) || 0,
      side: l.side || null,
      amount_cents: Number(l.amount_cents) || 0,
      balancing_account_code: l.balancing_account_code || '',
      position: l.position ?? i,
    })),
  }
}

// Builds the PATCH payload from the current form state.
export function buildJournalPayload(form) {
  return {
    entry_date: form.entry_date,
    description: form.description?.trim() || null,
    lines: form.lines.map((l, i) => ({
      description: l.description?.trim() || null,
      account_code: l.account_code?.trim() || null,
      vat_rate: Number(l.vat_rate) || 0,
      side: l.side || null,
      amount_cents: Math.round(Number(l.amount_cents) || 0),
      balancing_account_code: l.balancing_account_code?.trim() || null,
      position: i,
    })),
  }
}
