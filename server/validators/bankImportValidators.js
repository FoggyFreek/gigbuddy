// Input parsing/validation for the bank-statement importer. Pure — no DB. This
// validates only the *shape* of a commit request; all authorization and
// eligibility checks (line ownership, exact amount, target-doc status, account
// type, tenant scope) happen in the service under row locks.
import { parsePositiveId } from './common.js'
import { isKnownVatRate } from '../../shared/vatRates.js'

function trimOrNull(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// Contra account + optional VAT split of the gross amount. Any rate real in
// *some* supported country is accepted (bands buy abroad); whether the tenant
// may deduct/charge at all (KOR) is decided in the service.
function normalizeJournalFields(raw, action) {
  const code = trimOrNull(raw.contra_account_code)
  if (!code) return { error: `${action} needs contra_account_code` }
  if (raw.vat_rate == null) return { contraAccountCode: code, vatRate: null }
  const rate = Number(raw.vat_rate)
  if (!isKnownVatRate(rate)) return { error: 'vat_rate must be a known VAT rate' }
  return { contraAccountCode: code, vatRate: rate }
}

// Outgoing lines may link or create a supplier. Exactly one, or neither.
function normalizeSupplierFields(raw) {
  const supplierContactId = raw.supplier_contact_id == null
    ? null
    : parsePositiveId(raw.supplier_contact_id)
  if (raw.supplier_contact_id != null && supplierContactId === null) {
    return { error: 'supplier_contact_id must be a positive id' }
  }
  if (raw.create_supplier == null) return { supplierContactId }
  if (supplierContactId != null) {
    return { error: 'provide supplier_contact_id or create_supplier, not both' }
  }
  const name = trimOrNull(raw.create_supplier.name)
  if (!name) return { error: 'create_supplier needs a name' }
  return {
    supplierContactId,
    createSupplier: { name, iban: trimOrNull(raw.create_supplier.iban) },
  }
}

// Each returns { error } or the extra fields to merge onto the decision. The
// key set IS the set of valid actions.
const ACTION_NORMALIZERS = {
  skip: () => ({}),
  reconcile_invoice: (raw) => {
    const invoiceId = parsePositiveId(raw.invoice_id)
    if (invoiceId === null) return { error: 'reconcile_invoice needs invoice_id' }
    return { invoiceId }
  },
  reconcile_purchase: (raw) => {
    const purchaseId = parsePositiveId(raw.purchase_id)
    if (purchaseId === null) return { error: 'reconcile_purchase needs purchase_id' }
    return { purchaseId }
  },
  journal_received: (raw) => normalizeJournalFields(raw, 'journal_received'),
  journal_paid: (raw) => {
    const journal = normalizeJournalFields(raw, 'journal_paid')
    if (journal.error) return journal
    const supplier = normalizeSupplierFields(raw)
    if (supplier.error) return supplier
    return { ...journal, ...supplier }
  },
}

export const ACTIONS = new Set(Object.keys(ACTION_NORMALIZERS))

// Validates one decision. Returns { error } or { decision } (normalized).
function normalizeDecision(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'decision must be an object' }
  const lineId = parsePositiveId(raw.line_id)
  if (lineId === null) return { error: 'decision.line_id must be a positive id' }
  const action = raw.action
  // Set-guarded so an inherited key ('constructor') can't resolve to a function.
  if (!ACTIONS.has(action)) return { error: `invalid action: ${action}` }

  const extra = ACTION_NORMALIZERS[action](raw)
  if (extra.error) return { error: extra.error }
  return { decision: { lineId, action, ...extra } }
}

// Validates the whole commit body. Returns { error } or { decisions } with no
// duplicate line ids (a line may only be decided once per request).
export function parseCommitBody(body) {
  const list = body?.decisions
  if (!Array.isArray(list) || list.length === 0) {
    return { error: 'decisions must be a non-empty array' }
  }
  if (list.length > 1000) return { error: 'too many decisions (max 1000)' }

  const decisions = []
  const seen = new Set()
  for (const raw of list) {
    const result = normalizeDecision(raw)
    if (result.error) return { error: result.error }
    if (seen.has(result.decision.lineId)) {
      return { error: `duplicate decision for line ${result.decision.lineId}` }
    }
    seen.add(result.decision.lineId)
    decisions.push(result.decision)
  }
  return { decisions }
}
