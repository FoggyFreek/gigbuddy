// Input parsing/validation for the bank-statement importer. Pure — no DB. This
// validates only the *shape* of a commit request; all authorization and
// eligibility checks (line ownership, exact amount, target-doc status, account
// type, tenant scope) happen in the service under row locks.
import { parsePositiveId } from './common.js'

export const ACTIONS = new Set([
  'skip',
  'reconcile_invoice',
  'reconcile_purchase',
  'journal_paid',
  'journal_received',
])

function trimOrNull(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// Validates one decision. Returns { error } or { decision } (normalized).
function normalizeDecision(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'decision must be an object' }
  const lineId = parsePositiveId(raw.line_id)
  if (lineId === null) return { error: 'decision.line_id must be a positive id' }
  const action = raw.action
  if (!ACTIONS.has(action)) return { error: `invalid action: ${action}` }

  const decision = { lineId, action }

  if (action === 'reconcile_invoice') {
    const invoiceId = parsePositiveId(raw.invoice_id)
    if (invoiceId === null) return { error: 'reconcile_invoice needs invoice_id' }
    decision.invoiceId = invoiceId
  } else if (action === 'reconcile_purchase') {
    const purchaseId = parsePositiveId(raw.purchase_id)
    if (purchaseId === null) return { error: 'reconcile_purchase needs purchase_id' }
    decision.purchaseId = purchaseId
  } else if (action === 'journal_paid' || action === 'journal_received') {
    const code = trimOrNull(raw.contra_account_code)
    if (!code) return { error: `${action} needs contra_account_code` }
    decision.contraAccountCode = code
    // Outgoing lines may link or create a supplier. Exactly one, or neither.
    if (action === 'journal_paid') {
      const supplierContactId = raw.supplier_contact_id == null
        ? null
        : parsePositiveId(raw.supplier_contact_id)
      if (raw.supplier_contact_id != null && supplierContactId === null) {
        return { error: 'supplier_contact_id must be a positive id' }
      }
      decision.supplierContactId = supplierContactId
      if (raw.create_supplier != null) {
        if (supplierContactId != null) {
          return { error: 'provide supplier_contact_id or create_supplier, not both' }
        }
        const name = trimOrNull(raw.create_supplier.name)
        if (!name) return { error: 'create_supplier needs a name' }
        decision.createSupplier = { name, iban: trimOrNull(raw.create_supplier.iban) }
      }
    }
  }
  return { decision }
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
