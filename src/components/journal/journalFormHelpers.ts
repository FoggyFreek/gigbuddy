import type { Journal, JournalLine, Id } from '../../types/entities.ts'

// VAT rates a journal line may carry — same domain constants as purchases.
export const VAT_RATES: number[] = [21, 9, 0]

/** The editable form shape for a single journal line (includes React key). */
export interface JournalFormLine extends Omit<JournalLine, 'id'> {
  _key: string
  description: string
  account_code: string
  vat_rate: number
  side: 'debit' | 'credit' | null
  amount_cents: number
  balancing_account_code: string
  position: number
}

/** The editable form shape used by useJournalListState. */
export interface JournalForm {
  id?: Id
  entry_number?: number
  entry_date: string
  description: string
  status?: 'draft' | 'approved'
  posted_transaction_id?: Id | null
  lines: JournalFormLine[]
}

// Stable per-line React key, independent of array position (which shifts on
// add/remove/duplicate). Whitelisted out of the API payload by buildJournalPayload.
let lineKeySeq = 0
export function nextLineKey(): string {
  lineKeySeq += 1
  return `jl${lineKeySeq}`
}

export function emptyLine(position = 0): JournalFormLine {
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

/** Maps a loaded journal row to the editable form shape. */
export function journalToForm(journal: Journal): JournalForm {
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

/** Builds the PATCH payload from the current form state. */
export function buildJournalPayload(form: JournalForm): Partial<Journal> {
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
