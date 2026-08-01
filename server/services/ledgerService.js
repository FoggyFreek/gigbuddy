// Double-entry ledger posting engine — the only module that writes to the ledger.
//
// Every money-related transition in invoicing/purchasing posts a balanced journal
// here. All functions take an in-transaction `client` (a pg client mid-BEGIN) so
// the journal is written atomically with the business state change that triggered
// it. Posting is idempotent: the UNIQUE(tenant_id, source_type, source_id,
// source_event) key means re-driving the same transition is a no-op.
//
// Core invariant: Assets & Expenses increase with Debits; Liabilities, Equity &
// Revenue increase with Credits. Every journal balances (Σ debits == Σ credits).
import {
  computePurchaseLineAccountingAmounts,
  computePurchaseLineTotals,
} from '../../shared/purchaseTotals.js'
import { computeLineTotals } from '../../shared/invoiceTotals.js'
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { classify, describe, receiptFor } from './ledgerEntryTypes.js'
import { parseSearchLimit } from '../validators/ledgerValidators.js'
import {
  listTransactions,
  searchTransactions,
  listEntriesByAccounts,
  getTransaction,
  getTransactionBySource,
  listLines,
  listEntryDates,
  getTenantDisplayName,
  monthlyResultTotals,
  annualResultTotals,
  vatTotals,
  checkingAccountBalance,
  merchTotals,
  merchInventoryValue,
  updateTransactionNote,
  lockTransactionRow,
  insertLedgerTransaction,
  insertLedgerEntries,
  markTransactionVoided,
  markTransactionReversed,
  markTransactionVoidedAt,
} from '../repositories/ledgerRepository.js'
import {
  ACCOUNTING_SETTINGS_LOCK_NAMESPACE,
  acquireAccountingSettingsLock,
  getSettings,
  getBooksClosedThrough,
} from '../repositories/accountRepository.js'
import { hasReclassifiedLines } from '../repositories/journalRepository.js'
import { badRequest, notFound } from './serviceErrors.js'
import { fetchLines as fetchInvoiceLines, openInvoiceBuckets } from '../repositories/invoiceRepository.js'
import { upcomingBandFeesByStatus } from '../repositories/gigRepository.js'
import { loadAccountingBehavior } from './accountingProfileService.js'
import { currentFiscalYear, fiscalYearRange } from '../../shared/fiscalYear.js'
import {
  insertLedgerTaxFacts,
  listTransactionTaxFacts,
} from '../repositories/taxFactRepository.js'
import { purchaseTaxFact, reverseTaxFacts, saleTaxFact } from './taxFactService.js'
import { resolveLiveTreatment } from './vatTreatmentService.js'

// Thrown when a journal needs a tenant default account that isn't configured.
// The HTTP layer maps this to 409 accounting_not_configured and rolls back, so
// no money state changes without its journal.
export class AccountingNotConfiguredError extends Error {
  constructor(field) {
    super(`Accounting setting not configured: ${field}`)
    this.name = 'AccountingNotConfiguredError'
    this.code = 'accounting_not_configured'
    this.field = field
    this.status = 409
  }
}

// Thrown when a user-initiated posting is dated inside a closed period
// (entry_date <= tenant_accounting_settings.books_closed_through). The HTTP
// layer maps this to 409 period_closed and rolls back. System postings (Mollie
// webhook cash receipts) clamp to the first open day instead — see postJournal.
export class PeriodClosedError extends Error {
  constructor(entryDate, closedThrough) {
    super(`Books are closed through ${closedThrough}; cannot post on ${entryDate}`)
    this.name = 'PeriodClosedError'
    this.code = 'period_closed'
    this.status = 409
    this.entryDate = entryDate
    this.closedThrough = closedThrough
  }
}

// Thrown when a workflow tries to cancel/compensate a transaction whose line(s)
// carry an ACTIVE reclassification posting: the compensation would cancel the
// original while the reclassification keeps moving that amount, double-counting
// it in reports. The reclassification must be voided/reversed first.
export class ReclassifiedLinesError extends Error {
  constructor() {
    super('This ledger entry has reclassified lines; void or reverse the reclassification first')
    this.name = 'ReclassifiedLinesError'
    this.code = 'has_reclassified_lines'
    this.status = 409
  }
}

export class VatControlReconciliationError extends Error {
  constructor({ outputFacts, outputLedger, inputFacts, inputLedger }) {
    super('VAT control account movements do not reconcile to tax facts')
    this.name = 'VatControlReconciliationError'
    this.code = 'vat_control_reconciliation_failed'
    this.status = 409
    this.outputFacts = outputFacts
    this.outputLedger = outputLedger
    this.inputFacts = inputFacts
    this.inputLedger = inputLedger
  }
}

// Maps the ledger guard errors to a discriminated { error } result for the HTTP
// layer, or null when the error is not a ledger guard and should propagate.
export function ledgerErrorResult(err) {
  if (err instanceof AccountingNotConfiguredError) {
    return { error: { status: err.status, body: { error: err.message, code: err.code, field: err.field } } }
  }
  if (err instanceof PeriodClosedError) {
    return { error: { status: err.status, body: { error: err.message, code: err.code, closed_through: err.closedThrough } } }
  }
  if (err instanceof ReclassifiedLinesError) {
    return { error: { status: err.status, body: { error: err.message, code: err.code } } }
  }
  if (err instanceof VatControlReconciliationError) {
    return {
      error: {
        status: err.status,
        body: {
          error: err.message,
          code: err.code,
          output_difference_cents: err.outputFacts - err.outputLedger,
          input_difference_cents: err.inputFacts - err.inputLedger,
        },
      },
    }
  }
  return null
}

// The one guard every workflow that cancels or compensates a posted transaction
// must run inside its DB transaction, BEFORE posting the compensating journal:
// takes the same row lock as the reclassify flow (so the check can't race a
// concurrent reclassification) and throws when a line still has an active
// reclassification. A null/undefined id (nothing was posted) is a no-op.
export async function assertNoActiveReclassifications(client, tenantId, transactionId) {
  if (transactionId == null) return
  await lockTransactionRow(client, tenantId, transactionId)
  if (await hasReclassifiedLines(client, tenantId, transactionId)) {
    throw new ReclassifiedLinesError()
  }
}

// Per-tenant advisory lock serializing ledger postings against accounting
// settings changes. Posting transactions take it via loadAccountingSettings
// (their first settings read); the settings PATCH takes it before its
// open-balance checks, so a posting in flight to the old account codes commits
// (and is seen by the balance check) before the codes can change, and vice
// versa. Transaction-scoped: released automatically at COMMIT/ROLLBACK.
export { ACCOUNTING_SETTINGS_LOCK_NAMESPACE }

// The system Opening Balance Equity account seeded for every tenant
// (defaultChartOfAccounts.js / migration 064). It is is_system (undeletable), so
// a constant is safe — no per-tenant setting is needed.
export const OPENING_BALANCE_EQUITY_CODE = '39000'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function toDateString(value) {
  if (!value) return today()
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

export async function loadAccountingSettings(client, tenantId) {
  // Serialize against settings changes (see ACCOUNTING_SETTINGS_LOCK_NAMESPACE).
  // Outside an explicit transaction the xact lock releases at statement end,
  // which is harmless for read-only callers.
  await acquireAccountingSettingsLock(client, tenantId)
  return getSettings(client, tenantId)
}

function requireCode(settings, field) {
  const code = settings?.[field]
  if (!code) throw new AccountingNotConfiguredError(field)
  return code
}

// Inserts one balanced journal. Drops zero lines, asserts ≥2 lines and balance,
// then writes the transaction + entries. Idempotent on (source_type, source_id,
// source_event): returns { posted: false } if that journal already exists.
// Returns 'YYYY-MM-DD' of the day after the given ISO date string.
function nextDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export async function fetchBooksClosedThrough(executor, tenantId) {
  return getBooksClosedThrough(executor, tenantId)
}

// The given date when its period is still open, else the first day after
// books_closed_through. Used by postings that prefer an original date but must
// land in the open period (e.g. reclassification drafts).
export async function firstOpenDate(executor, tenantId, isoDate) {
  const closedThrough = await fetchBooksClosedThrough(executor, tenantId)
  return closedThrough && isoDate <= closedThrough ? nextDay(closedThrough) : isoDate
}

// Throws PeriodClosedError when entryDate falls in the closed period.
export async function assertPeriodOpen(executor, tenantId, entryDate) {
  const closedThrough = await fetchBooksClosedThrough(executor, tenantId)
  if (closedThrough && entryDate <= closedThrough) {
    throw new PeriodClosedError(entryDate, closedThrough)
  }
}

// Pre-flight for voiding a sent invoice: verifies the reversal journal *can*
// post (accounts configured, period open for today's reversal date) without
// writing anything. Callers run this BEFORE external side effects like Mollie
// payment-link removal, so a doomed void never half-executes.
export async function assertInvoiceVoidPostable(executor, tenantId, invoice) {
  const settings = await loadAccountingSettings(executor, tenantId)
  requireCode(settings, 'receivable_account_code')
  requireCode(settings, 'default_revenue_account_code')
  if (invoice.tax_cents > 0) requireCode(settings, 'output_vat_account_code')
  await assertPeriodOpen(executor, tenantId, today())
  const original = await getTransactionBySource(executor, tenantId, 'invoice', invoice.id, 'sent')
  await assertNoActiveReclassifications(executor, tenantId, original?.id)
}

export async function postJournal(client, tenantId, {
  entryDate, description, sourceType, sourceId, sourceEvent, lines,
  taxFacts = [], actorUserId = null, clampToOpenPeriod = false,
}) {
  // Period close: user postings into a closed period are rejected; system
  // postings (clampToOpenPeriod, e.g. webhook cash receipts) move to the first
  // open day so external money is never silently dropped.
  const closedThrough = await fetchBooksClosedThrough(client, tenantId)
  let effectiveDate = entryDate
  let effectiveDescription = description ?? null
  if (closedThrough && entryDate <= closedThrough) {
    if (!clampToOpenPeriod) throw new PeriodClosedError(entryDate, closedThrough)
    effectiveDate = nextDay(closedThrough)
    effectiveDescription = `${effectiveDescription || ''} (dated ${entryDate}, posted in open period)`.trim()
  }

  const normalized = (lines || [])
    .map((l) => ({
      account_code: l.account_code,
      debit_cents: Math.round(l.debit_cents || 0),
      credit_cents: Math.round(l.credit_cents || 0),
      memo: l.memo ?? null,
    }))
    .filter((l) => l.debit_cents !== 0 || l.credit_cents !== 0)

  const label = `${sourceType}#${sourceId}/${sourceEvent}`
  if (normalized.length < 2) {
    throw new Error(`ledger: journal ${label} needs at least two non-zero lines`)
  }
  const totalDebit = normalized.reduce((s, l) => s + l.debit_cents, 0)
  const totalCredit = normalized.reduce((s, l) => s + l.credit_cents, 0)
  if (totalDebit !== totalCredit) {
    throw new Error(`ledger: journal ${label} is unbalanced (debit ${totalDebit} != credit ${totalCredit})`)
  }

  const settings = await loadAccountingSettings(client, tenantId)
  const isVatSettlement = sourceType === 'vat_settlement' && sourceEvent === 'filed'
  if (!isVatSettlement) {
    const outputCode = settings?.output_vat_account_code
    const inputCode = settings?.input_vat_account_code
    const outputLedger = normalized
      .filter((line) => line.account_code === outputCode)
      .reduce((sum, line) => sum + line.credit_cents - line.debit_cents, 0)
    const inputLedger = normalized
      .filter((line) => line.account_code === inputCode)
      .reduce((sum, line) => sum + line.debit_cents - line.credit_cents, 0)
    const outputFacts = taxFacts.reduce((sum, fact) => sum + Number(fact.output_vat_cents || 0), 0)
    const inputFacts = taxFacts.reduce((sum, fact) => sum + Number(fact.deductible_input_vat_cents || 0), 0)
    if (outputLedger !== outputFacts || inputLedger !== inputFacts) {
      throw new VatControlReconciliationError({ outputFacts, outputLedger, inputFacts, inputLedger })
    }
  }

  const transactionId = await insertLedgerTransaction(client, tenantId, {
    entryDate: effectiveDate,
    description: effectiveDescription,
    sourceType,
    sourceId,
    sourceEvent,
    actorUserId,
  })
  if (transactionId == null) return { posted: false }

  await insertLedgerEntries(client, tenantId, transactionId, normalized)
  if (taxFacts.length) {
    await insertLedgerTaxFacts(client, tenantId, transactionId, taxFacts)
  }
  return { posted: true, transactionId }
}

// ---------- read helpers (ledger browser) ----------

// The browser headline is the value of the primary economic event. For most
// types that is the gross debit total. A merch sale is a *compound* journal
// (the sale plus the COGS↔inventory cost relief), so summing both debit legs
// over-counts by the cost — use the gross sale from the source doc instead.
// This holds for the void and reversal mirrors too: they carry the same gross,
// and the sign comes from classify().
function headlineAmount(row) {
  if (row.source_type === 'merch_sale' && row.merch_sale_unit_price_incl_cents != null) {
    // Imported sales carry the exact gross (gross_incl_cents); manual sales use
    // quantity × unit price.
    return row.merch_sale_gross_incl_cents ?? row.merch_sale_quantity * row.merch_sale_unit_price_incl_cents
  }
  return row.total_debit_cents
}

// One ledger-browser list row. Amount is the headline event value signed by the
// entry type (purchases/outgoing money negative); journals show no amount.
function toListRow(row) {
  const { type, group, voided, sign } = classify(row.source_type, row.source_event)
  return {
    id: row.id,
    entry_date: row.entry_date,
    type,
    group,
    // A manually voided original carries no void source_event, so fold in its
    // voided_at marker: both halves of a void hide from the default list.
    voided: voided || row.voided_at != null,
    receipt: receiptFor(row),
    description: describe(row),
    note: row.note ?? null,
    amount_cents: sign === null ? null : sign * headlineAmount(row),
    source_type: row.source_type,
    source_id: row.source_id,
    source_event: row.source_event,
  }
}

// `period` is the { sql, values } result of buildPeriodWhere(query, 'lt.entry_date').
export async function getLedgerList(executor, tenantId, period) {
  const rows = await listTransactions(executor, tenantId, period)
  return rows.map(toListRow)
}

// Global-search read: matches transactions by description or joined source-doc
// text, mapped to the same list-row shape as getLedgerList. Short queries (<3
// chars) return nothing so we don't run a wildcard scan on every keystroke.
export async function searchLedgerTransactions(executor, tenantId, query) {
  const q = String(query.q ?? '').trim()
  if (q.length < 3) return []
  const rows = await searchTransactions(executor, tenantId, `%${q}%`, parseSearchLimit(query.limit))
  return rows.map(toListRow)
}

// One ledger-entry (line-level) search row. Type and voided are classified
// server-side like toListRow so the entry-search page matches the browser:
// a manually voided original carries no void source_event, so fold in voided_at.
function toEntryLineRow(row) {
  const { type } = classify(row.source_type, row.source_event)
  return {
    id: row.id,
    transaction_id: row.transaction_id,
    entry_date: row.entry_date,
    account_code: row.account_code,
    account_name: row.account_name,
    type,
    description: row.description ?? null,
    memo: row.memo ?? null,
    debit_cents: row.debit_cents,
    credit_cents: row.credit_cents,
    source_type: row.source_type,
    source_event: row.source_event,
    voided: classify(row.source_type, row.source_event).voided || row.voided_at != null,
  }
}

// Line-level entry search for the "Ledger entries" page: every ledger_entries
// row hitting one of `accountCodes` in `period`. Empty selection returns []
// (the page skips the fetch to avoid scanning the whole ledger). `period` is
// buildPeriodWhere(query, 'lt.entry_date', 3).
export async function getLedgerEntriesByAccount(executor, tenantId, accountCodes, period) {
  if (!accountCodes.length) return []
  const rows = await listEntriesByAccounts(executor, tenantId, accountCodes, period)
  return rows.map(toEntryLineRow)
}

export async function listLedgerEntryDates(executor, tenantId) {
  return listEntryDates(executor, tenantId)
}

export async function getLedgerTenantDisplayName(executor, tenantId) {
  return getTenantDisplayName(executor, tenantId)
}

function originFor(row) {
  const label = describe(row)
  switch (row.source_type) {
    case 'invoice': return { label, path: `/invoices/${row.source_id}` }
    case 'purchase': return { label, path: `/purchases/${row.source_id}` }
    case 'journal': return { label, path: '/journal' }
    case 'reimbursement': return { label, path: '/reimbursements' }
    case 'merch_sale': return { label, path: '/merch' }
    case 'vat_settlement': return { label, path: '/vat-returns' }
    case 'vat_settlement_payment': return { label, path: '/vat-returns' }
    // A manual void's source is the ledger entry it reverses.
    case 'ledger_transaction': return { label, path: `/ledger/${row.source_id}` }
    default: return { label, path: null }
  }
}

// Detail for one transaction, or null (route 404s — no cross-tenant leak).
// Carries the correction state that drives the front-end banner/button choice:
// whether this entry was voided/reversed, whether it is itself a correction,
// and whether its booking period is still open (→ Void) or closed (→ Reversal).
export async function getLedgerEntryDetail(executor, tenantId, transactionId) {
  const row = await getTransaction(executor, tenantId, transactionId)
  if (!row) return null
  // Per line: the reclassification journal that moves it (posted immediately,
  // so approved with its correcting transaction).
  const lines = (await listLines(executor, tenantId, transactionId)).map((l) => ({
    id: l.id,
    account_code: l.account_code,
    account_name: l.account_name,
    memo: l.memo,
    debit_cents: l.debit_cents,
    credit_cents: l.credit_cents,
    reclassification: l.reclassified_by_journal_id == null ? null : {
      journal_id: l.reclassified_by_journal_id,
      status: l.reclassification_status,
      posted_transaction_id: l.reclassified_to_transaction_id ?? null,
    },
  }))
  const { type, group, voided } = classify(row.source_type, row.source_event)
  const isCorrection = row.source_type === 'ledger_transaction'
    && (row.source_event === 'void' || row.source_event === 'reversal')
  const closedThrough = await fetchBooksClosedThrough(executor, tenantId)
  return {
    id: row.id,
    entry_date: row.entry_date,
    type,
    group,
    voided: voided || row.voided_at != null,
    voided_by_transaction_id: row.voided_by_transaction_id ?? null,
    reversed_by_transaction_id: row.reversed_by_transaction_id ?? null,
    corrects_transaction_id: isCorrection ? row.source_id : null,
    period_open: !closedThrough || row.entry_date > closedThrough,
    receipt: receiptFor(row),
    description: describe(row),
    source_type: row.source_type,
    source_id: row.source_id,
    created_at: row.created_at,
    created_by_name: row.created_by_name,
    note: row.note ?? null,
    note_updated_at: row.note_updated_at ?? null,
    note_updated_by_name: row.note_updated_by_name ?? null,
    origin: originFor(row),
    lines,
  }
}

// Sets/clears the free-text note on one transaction (any state, incl. voided
// and corrections — notes are display metadata). Blank input stores NULL.
export async function updateLedgerNote(executor, tenantId, transactionId, body, actorUserId) {
  const raw = body.note ?? null
  if (raw !== null && typeof raw !== 'string') return badRequest('Invalid note')
  const note = raw === null ? null : (raw.trim() || null)
  const updated = await updateTransactionNote(executor, tenantId, transactionId, note, actorUserId)
  if (!updated) return notFound('Not found')
  return { noteUpdate: updated }
}

// Posts a correcting transaction: a new journal dated today with every line of
// `original` debit/credit-swapped. `mode` is 'void' or 'reversal'; the
// source_event records which.
async function postReversingJournal(client, tenantId, original, mode, actorUserId, opts = {}) {
  const verb = mode === 'void' ? 'Void' : 'Reversal'
  const lines = (await listLines(client, tenantId, original.id)).map((l) => ({
    account_code: l.account_code,
    debit_cents: l.credit_cents,
    credit_cents: l.debit_cents,
    memo: l.memo,
  }))
  const taxFacts = reverseTaxFacts(await listTransactionTaxFacts(client, tenantId, original.id))
  return postJournal(client, tenantId, {
    entryDate: today(),
    description: `${verb} of ledger entry #${original.id}`,
    sourceType: 'ledger_transaction', sourceId: original.id, sourceEvent: mode,
    lines, taxFacts, actorUserId, ...opts,
  })
}

export class TaxClassificationError extends Error {
  constructor(source) {
    super(`${source} has an invalid VAT category classification`)
    this.name = 'TaxClassificationError'
    this.code = 'invalid_tax_category'
    this.status = 400
  }
}

// Corrects one ledger transaction by posting a reversing journal dated today
// (debit/credit swapped). Two modes, gated on the original's booking period:
//   'void'     — open period only. Marks the original voided_at; both halves
//                then hide from the ledger and drop out of every financial
//                report (corrections-as-exclusion).
//   'reversal' — closed period only. A *visible* correction: marks the original
//                reversed_by_transaction_id, but both halves stay in the ledger
//                and in reports, netting the mistake out forward without
//                touching the closed period.
// A correction entry can't itself be voided/reversed, nor can an already
// corrected original. Idempotent on (ledger_transaction, id, mode).
// Row-state guards shared by void and reverse: a correction can't itself be
// corrected, nor a row already voided/reversed. Returns an error body or null.
function correctionRowConflict(row) {
  if (row.source_type === 'vat_settlement') {
    return { status: 409, body: { error: 'VAT settlements must be corrected through the VAT return workflow', code: 'vat_settlement_managed' } }
  }
  if (classify(row.source_type, row.source_event).voided || row.source_event === 'reversal') {
    return { status: 409, body: { error: 'A correction entry cannot be voided or reversed', code: 'void_of_void' } }
  }
  if (row.voided_at) {
    return { status: 409, body: { error: 'This ledger entry has already been voided', code: 'already_voided' } }
  }
  if (row.reversed_by_transaction_id) {
    return { status: 409, body: { error: 'This ledger entry has already been reversed', code: 'already_reversed' } }
  }
  return null
}

// The { status, body } shape of ReclassifiedLinesError, for the correction
// paths that return error results instead of throwing.
const RECLASSIFIED_LINES_CONFLICT = ledgerErrorResult(new ReclassifiedLinesError()).error

// Open periods must be voided, closed periods reversed. Returns an error body or null.
function correctionPeriodConflict(mode, isClosed, closedThrough) {
  if (mode === 'void' && isClosed) {
    return { status: 409, body: { error: `This ledger entry is in a closed period (closed through ${closedThrough}); reverse it instead`, code: 'use_reversal', closed_through: closedThrough } }
  }
  if (mode === 'reversal' && !isClosed) {
    return { status: 409, body: { error: 'This ledger entry is in an open period; void it instead', code: 'use_void' } }
  }
  return null
}

async function applyCorrection(pool, tenantId, transactionId, actorUserId, mode) {
  return withTransaction(async (client) => {
    // Serialize against a concurrent reclassification of this transaction (it
    // takes the same row lock), so the reclassified-lines check can't race.
    if (!(await lockTransactionRow(client, tenantId, transactionId))) {
      abortTransaction({ error: { status: 404, body: { error: 'Not found' } } })
    }
    const row = await getTransaction(client, tenantId, transactionId)
    if (!row) abortTransaction({ error: { status: 404, body: { error: 'Not found' } } })
    const rowConflict = correctionRowConflict(row)
    if (rowConflict) abortTransaction({ error: rowConflict })
    if (await hasReclassifiedLines(client, tenantId, transactionId)) {
      abortTransaction({ error: RECLASSIFIED_LINES_CONFLICT })
    }

    const closedThrough = await fetchBooksClosedThrough(client, tenantId)
    const isClosed = Boolean(closedThrough && row.entry_date <= closedThrough)
    const periodConflict = correctionPeriodConflict(mode, isClosed, closedThrough)
    if (periodConflict) abortTransaction({ error: periodConflict })

    const result = await postReversingJournal(client, tenantId, row, mode, actorUserId)
    if (!result.posted) {
      const code = mode === 'void' ? 'already_voided' : 'already_reversed'
      abortTransaction({ error: { status: 409, body: { error: 'Entry already corrected', code } } })
    }

    // Mark the original. The compensating ledger_transaction/void is excluded
    // from reports by its source_event, so only the original needs marking.
    if (mode === 'void') {
      await markTransactionVoided(client, tenantId, transactionId, result.transactionId)
    } else {
      await markTransactionReversed(client, tenantId, transactionId, result.transactionId)
    }

    return { transactionId: result.transactionId }
  }, { db: pool, mapError: ledgerErrorResult })
}

// Transaction-scoped correction used by domain workflows that must combine a
// correction and replacement posting atomically. The caller owns BEGIN/COMMIT.
export async function correctLedgerTransaction(client, tenantId, transactionId, actorUserId = null) {
  if (!(await lockTransactionRow(client, tenantId, transactionId))) {
    return { error: { status: 404, body: { error: 'Not found' } } }
  }
  const row = await getTransaction(client, tenantId, transactionId)
  if (!row) return { error: { status: 404, body: { error: 'Not found' } } }
  const rowConflict = correctionRowConflict(row)
  if (rowConflict) return { error: rowConflict }
  if (await hasReclassifiedLines(client, tenantId, transactionId)) {
    return { error: RECLASSIFIED_LINES_CONFLICT }
  }

  const closedThrough = await fetchBooksClosedThrough(client, tenantId)
  const mode = closedThrough && row.entry_date <= closedThrough ? 'reversal' : 'void'
  const result = await postReversingJournal(client, tenantId, row, mode, actorUserId, { clampToOpenPeriod: true })
  if (!result.posted) {
    const code = mode === 'void' ? 'already_voided' : 'already_reversed'
    return { error: { status: 409, body: { error: 'Entry already corrected', code } } }
  }
  if (mode === 'void') await markTransactionVoided(client, tenantId, transactionId, result.transactionId)
  else await markTransactionReversed(client, tenantId, transactionId, result.transactionId)
  return { mode, transactionId: result.transactionId }
}

// Domain workflows identify their posting by source identity, while correction
// state and journals remain owned by the ledger. The caller keeps its domain
// mutation in the same database transaction and rolls back on a returned error.
export async function correctLedgerTransactionBySource(
  client,
  tenantId,
  { sourceType, sourceId, sourceEvent },
  actorUserId = null,
) {
  const original = await getTransactionBySource(
    client, tenantId, sourceType, sourceId, sourceEvent,
  )
  if (!original) return { error: { status: 404, body: { error: 'Not found' } } }
  return correctLedgerTransaction(client, tenantId, original.id, actorUserId)
}

// Void an open-period entry (hidden + excluded from reports). 409s a
// closed-period entry with code use_reversal.
export async function voidLedgerTransaction(pool, tenantId, transactionId, actorUserId = null) {
  return applyCorrection(pool, tenantId, transactionId, actorUserId, 'void')
}

// Reverse a closed-period entry with a visible correction. 409s an open-period
// entry with code use_void.
export async function reverseLedgerTransaction(pool, tenantId, transactionId, actorUserId = null) {
  return applyCorrection(pool, tenantId, transactionId, actorUserId, 'reversal')
}

// 'YYYY-MM-01' of the month `count` months after the given year/month (1-based).
function monthStart(year, month, count = 0) {
  const d = new Date(Date.UTC(year, month - 1 + count, 1))
  return d.toISOString().slice(0, 10)
}

// First days of every calendar month covering [from, toExclusive).
function enumerateMonths(from, toExclusive) {
  const months = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  while (monthStart(year, month) < toExclusive) {
    months.push({ year, month })
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return months
}

// The quarter containing `now`, plus its filing due date — the last day of the
// month after the quarter ends (NL VAT convention).
function currentVatQuarter(now = new Date()) {
  const year = now.getFullYear()
  const quarter = Math.floor(now.getMonth() / 3) + 1
  const startMonth = (quarter - 1) * 3 + 1
  const toExclusive = monthStart(year, startMonth, 3)
  const dueExclusive = new Date(`${monthStart(year, startMonth, 4)}T00:00:00Z`)
  dueExclusive.setUTCDate(dueExclusive.getUTCDate() - 1)
  return {
    year,
    quarter,
    range: { from: monthStart(year, startMonth), toExclusive },
    dueDate: dueExclusive.toISOString().slice(0, 10),
  }
}

// A null range means "all time": span whole months from the first to the last
// booked entry (falling back to the current calendar year when empty).
export async function resolveEffectiveRange(executor, tenantId, range, fiscalYearStart = { month: 1, day: 1 }) {
  if (range) return range
  const dates = await listEntryDates(executor, tenantId) // DESC
  if (dates.length) {
    const min = dates[dates.length - 1]
    const max = dates[0]
    return {
      from: `${min.slice(0, 7)}-01`,
      toExclusive: monthStart(Number(max.slice(0, 4)), Number(max.slice(5, 7)), 1),
    }
  }
  return fiscalYearRange(currentFiscalYear(fiscalYearStart), fiscalYearStart)
}

// Aggregates the financial dashboard: revenue/expense/result per month over
// the requested period (null range = all time, spanning the booked entries),
// the VAT position of the *current* quarter, and the open invoice buckets
// (which reflect current status, not the period).
export async function getFinancialOverview(executor, tenantId, range) {
  const behavior = await loadAccountingBehavior(executor, tenantId)
  const fiscalYearStart = behavior.fiscalYearStart
  const effectiveRange = await resolveEffectiveRange(executor, tenantId, range, fiscalYearStart)

  // Trailing-three-calendar-years result trend, pinned to "today" (independent
  // of the selected period, like the VAT and bank figures).
  const TREND_YEARS = 3
  const currentYear = currentFiscalYear(fiscalYearStart)
  const firstTrendYear = currentYear - (TREND_YEARS - 1)
  const annualRanges = Array.from({ length: TREND_YEARS }, (_, index) => ({
    year: firstTrendYear + index,
    ...fiscalYearRange(firstTrendYear + index, fiscalYearStart),
  }))

  const vatQuarter = currentVatQuarter()
  const [monthRows, annualRows, vat, buckets, bankBalanceCents, merch, merchInventoryCents, feeRows] =
    await Promise.all([
      monthlyResultTotals(executor, tenantId, effectiveRange),
      annualResultTotals(executor, tenantId, annualRanges),
      vatTotals(executor, tenantId, vatQuarter.range),
      openInvoiceBuckets(executor, tenantId),
      checkingAccountBalance(executor, tenantId),
      merchTotals(executor, tenantId, effectiveRange),
      merchInventoryValue(executor, tenantId),
      upcomingBandFeesByStatus(executor, tenantId),
    ])

  const annualByYear = new Map(annualRows.map((r) => [r.year, r]))
  const annualResults = Array.from({ length: TREND_YEARS }, (_, i) => {
    const year = firstTrendYear + i
    const row = annualByYear.get(year)
    const revenue = row?.revenue_cents || 0
    const expense = row?.expense_cents || 0
    // has_data distinguishes a real zero result from a year with no ledger
    // activity at all — the chart renders the latter as a gap, not a point.
    return { year, has_data: Boolean(row), revenue_cents: revenue, expense_cents: expense, result_cents: revenue - expense }
  })

  const byKey = new Map(monthRows.map((r) => [r.month_key, r]))
  const months = enumerateMonths(effectiveRange.from, effectiveRange.toExclusive).map(({ year, month }) => {
    const key = `${year}-${String(month).padStart(2, '0')}`
    const row = byKey.get(key)
    const revenue = row?.revenue_cents || 0
    const expense = row?.expense_cents || 0
    return { key, year, month, revenue_cents: revenue, expense_cents: expense, result_cents: revenue - expense }
  })
  const totals = months.reduce(
    (acc, m) => ({
      revenue_cents: acc.revenue_cents + m.revenue_cents,
      expense_cents: acc.expense_cents + m.expense_cents,
      result_cents: acc.result_cents + m.result_cents,
    }),
    { revenue_cents: 0, expense_cents: 0, result_cents: 0 },
  )

  const outputCents = vat?.output_cents || 0
  const inputCents = vat?.input_cents || 0

  // Upcoming gross band fees, pinned to "today": a single total plus a per-status
  // breakdown across the active gig statuses (independent of the selected period).
  const FEE_STATUSES = ['option', 'confirmed', 'announced']
  const feeByStatus = Object.fromEntries(FEE_STATUSES.map((s) => [s, { count: 0, total_cents: 0 }]))
  let feeTotalCents = 0
  let feeGigCount = 0
  for (const row of feeRows) {
    feeByStatus[row.status] = { count: row.gig_count, total_cents: row.total_cents }
    feeTotalCents += row.total_cents
    feeGigCount += row.gig_count
  }

  return {
    currency: behavior.currency,
    months,
    totals,
    annual_results: annualResults,
    bank: { balance_cents: bankBalanceCents },
    vat: {
      year: vatQuarter.year,
      quarter: vatQuarter.quarter,
      due_date: vatQuarter.dueDate,
      output_cents: outputCents,
      input_cents: inputCents,
      net_cents: outputCents - inputCents,
    },
    invoices: {
      overdue: { count: buckets.overdue_count, total_cents: buckets.overdue_total_cents },
      unpaid: { count: buckets.unpaid_count, total_cents: buckets.unpaid_total_cents },
      draft: { count: buckets.draft_count, total_cents: buckets.draft_total_cents },
    },
    // Merch contribution within the same period as `months`/`totals`; inventory
    // value is a point-in-time asset balance regardless of the period.
    merch: {
      revenue_cents: merch.revenue_cents,
      cogs_cents: merch.cogs_cents,
      gross_profit_cents: merch.revenue_cents - merch.cogs_cents,
      inventory_value_cents: merchInventoryCents,
    },
    upcoming_fees: {
      total_cents: feeTotalCents,
      gig_count: feeGigCount,
      by_status: feeByStatus,
    },
  }
}

// ---------- invoice journals (revenue) ----------

async function invoiceTaxFacts(client, tenantId, invoice) {
  const behavior = await loadAccountingBehavior(client, tenantId)
  const countryCode = invoice.accounting_country_snapshot ?? behavior.accountingCountry
  const sourceLines = await fetchInvoiceLines(client, invoice.id, tenantId)
  if (!sourceLines.length) return []

  const exempt = invoice.vat_treatment_snapshot === 'small_business_exempt'
  const reverseCharge = invoice.vat_treatment_snapshot === 'reverse_charge' || invoice.reverse_charge
  const prepared = sourceLines.map((line) => {
    const effective = (exempt || reverseCharge) ? { ...line, tax_percentage: 0 } : line
    const totals = computeLineTotals(effective, (exempt || reverseCharge) ? false : invoice.tax_inclusive)
    return { line, net: totals.netCents }
  })
  const subtotal = prepared.reduce((sum, row) => sum + row.net, 0)
  const targetBase = invoice.subtotal_cents - invoice.discount_cents
  const bases = prepared.map((row) => subtotal === 0 ? 0 : Math.round((row.net * targetBase) / subtotal))
  if (bases.length) {
    bases[bases.length - 1] += targetBase - bases.reduce((sum, value) => sum + value, 0)
  }

  const facts = prepared.map(({ line }, index) => {
    const selectedLine = reverseCharge && !line.tax_category_code
      ? { ...line, tax_category_code: 'intra_eu_supply_services', tax_percentage: 0 }
      : line
    const rate = exempt || reverseCharge ? 0 : Number(line.tax_percentage)
    const tax = (exempt || reverseCharge) ? 0 : Math.round((bases[index] * rate) / 100)
    const taxPoint = invoice.supply_date ?? invoice.issue_date
    return saleTaxFact({
      line: selectedLine,
      countryCode,
      taxPoint,
      taxableBaseCents: bases[index],
      taxCents: tax,
      schemeCode: invoice.vat_scheme_code_snapshot,
      schemeTreatment: exempt ? 'small_business_exempt' : null,
      counterpartyCountry: invoice.customer_address_country,
      sourceLineKind: 'invoice_line',
    })
  }).filter(Boolean)
  if (facts.length !== prepared.length) {
    throw new TaxClassificationError('Invoice')
  }

  const output = facts.reduce((sum, fact) => sum + fact.output_vat_cents, 0)
  const residual = invoice.tax_cents - output
  const target = facts.find((fact) => fact.output_vat_cents !== 0)
  if (!target && residual !== 0) {
    throw new TaxClassificationError('Invoice')
  }
  if (target && residual !== 0) {
    target.tax_amount_cents += residual
    target.output_vat_cents += residual
  }
  return facts
}

// Invoice sent: DR receivable (asset up), CR revenue, CR output VAT (liability up).
export async function postInvoiceSent(client, tenantId, invoice, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const receivable = requireCode(settings, 'receivable_account_code')
  const revenue = requireCode(settings, 'default_revenue_account_code')
  const netCents = invoice.subtotal_cents - invoice.discount_cents
  const memo = `Invoice ${invoice.invoice_number}`

  const lines = [
    { account_code: receivable, debit_cents: invoice.total_cents, memo },
    { account_code: revenue, credit_cents: netCents, memo },
  ]
  if (invoice.tax_cents > 0) {
    lines.push({ account_code: requireCode(settings, 'output_vat_account_code'), credit_cents: invoice.tax_cents, memo })
  }
  const taxFacts = await invoiceTaxFacts(client, tenantId, invoice)

  return postJournal(client, tenantId, {
    entryDate: toDateString(invoice.issue_date),
    description: `Invoice ${invoice.invoice_number} sent`,
    sourceType: 'invoice', sourceId: invoice.id, sourceEvent: 'sent', lines, taxFacts, ...opts,
  })
}

// Invoice paid: DR checking (cash up), CR receivable (clears the asset). The
// entry date defaults to the Mollie paid timestamp; bank-statement reconciliation
// overrides it via opts.entryDate with the statement booking date.
export async function postInvoicePaid(client, tenantId, invoice, opts = {}) {
  const { entryDate, ...journalOpts } = opts
  const settings = await loadAccountingSettings(client, tenantId)
  const checking = requireCode(settings, 'primary_checking_account_code')
  const receivable = requireCode(settings, 'receivable_account_code')
  const memo = `Invoice ${invoice.invoice_number}`

  return postJournal(client, tenantId, {
    entryDate: toDateString(entryDate ?? invoice.mollie_paid_at),
    description: `Invoice ${invoice.invoice_number} paid`,
    sourceType: 'invoice', sourceId: invoice.id, sourceEvent: 'paid',
    lines: [
      { account_code: checking, debit_cents: invoice.total_cents, memo },
      { account_code: receivable, credit_cents: invoice.total_cents, memo },
    ],
    ...journalOpts,
  })
}

// Invoice voided: reverses the `sent` journal (CR receivable, DR revenue, DR
// VAT) and marks that original, so the void is reflected on both halves in the
// ledger browser. Splits on the original's booking period like a manual
// correction:
//   open period   → the original is *voided*: both halves hide from the default
//                   list and drop from reports. The compensating journal carries
//                   its own voided_at so the pair still nets to zero.
//   closed period → the original is *reversed*: a visible 'reversal' correction
//                   that stays in the ledger and in reports, never mutating the
//                   closed period.
export async function postInvoiceVoid(client, tenantId, invoice, opts = {}) {
  // The compensation cancels the `sent` posting, so that posting's lines must
  // not carry an active reclassification (lock + guard, like a manual void).
  const original = await getTransactionBySource(client, tenantId, 'invoice', invoice.id, 'sent')
  await assertNoActiveReclassifications(client, tenantId, original?.id)
  const closedThrough = await fetchBooksClosedThrough(client, tenantId)
  const isClosed = Boolean(original && closedThrough && original.entry_date <= closedThrough)

  const settings = await loadAccountingSettings(client, tenantId)
  const receivable = requireCode(settings, 'receivable_account_code')
  const revenue = requireCode(settings, 'default_revenue_account_code')
  const netCents = invoice.subtotal_cents - invoice.discount_cents
  const memo = `Invoice ${invoice.invoice_number} ${isClosed ? 'reversed' : 'voided'}`

  const lines = [
    { account_code: receivable, credit_cents: invoice.total_cents, memo },
    { account_code: revenue, debit_cents: netCents, memo },
  ]
  if (invoice.tax_cents > 0) {
    lines.push({ account_code: requireCode(settings, 'output_vat_account_code'), debit_cents: invoice.tax_cents, memo })
  }
  const taxFacts = original
    ? reverseTaxFacts(await listTransactionTaxFacts(client, tenantId, original.id))
    : []

  const result = await postJournal(client, tenantId, {
    entryDate: today(),
    description: memo,
    sourceType: 'invoice', sourceId: invoice.id,
    sourceEvent: isClosed ? 'reversal' : 'void', lines, taxFacts, ...opts,
  })

  if (result.posted && original) {
    if (isClosed) {
      await markTransactionReversed(client, tenantId, original.id, result.transactionId)
    } else {
      await markTransactionVoided(client, tenantId, original.id, result.transactionId)
      await markTransactionVoidedAt(client, tenantId, result.transactionId)
    }
  }
  return result
}

// ---------- purchase journals (expenses) ----------

// Bill accrued (on approve): recoverable VAT posts net cost + input VAT;
// non-recoverable VAT is part of the expense/asset cost. Both credit the gross
// payable amount.
export async function postBillAccrued(client, tenantId, purchase, purchaseLines, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const behavior = await loadAccountingBehavior(client, tenantId)
  const payable = requireCode(settings, 'payable_account_code')
  const memo = `Bill ${purchase.receipt_number} — ${purchase.supplier_name}`
  const inputVatRecoverable = purchase.input_vat_recoverable_snapshot !== false
  const countryCode = purchase.accounting_country_snapshot ?? behavior.accountingCountry
  const taxFacts = purchaseLines.map((line) => purchaseTaxFact({
    line,
    countryCode,
    taxPoint: purchase.receipt_date,
    schemeCode: purchase.vat_scheme_code_snapshot,
    inputVatRecoverable,
    counterpartyCountry: purchase.supplier_country_code,
    sourceLineKind: 'purchase_line',
  })).filter(Boolean)
  if (taxFacts.length !== purchaseLines.length) {
    throw new TaxClassificationError('Purchase')
  }

  // Group book costs by account. Lines that stock a product book to the merch
  // inventory asset (the goods aren't an expense until sold); other lines use
  // their explicit code or fall back to the tenant default expense account.
  const costByAccount = new Map()
  let inputVatCents = 0
  for (let index = 0; index < purchaseLines.length; index += 1) {
    const line = purchaseLines[index]
    const fact = taxFacts[index]
    const amounts = fact
      ? {
        costCents: fact.taxable_base_cents + fact.non_deductible_input_vat_cents,
        inputVatCents: fact.deductible_input_vat_cents,
      }
      : computePurchaseLineAccountingAmounts(line, inputVatRecoverable)
    const code = line.product_id
      ? requireCode(settings, 'merch_inventory_account_code')
      : (line.account_code || requireCode(settings, 'default_expense_account_code'))
    costByAccount.set(code, (costByAccount.get(code) || 0) + amounts.costCents)
    inputVatCents += amounts.inputVatCents
  }

  const lines = []
  for (const [code, cost] of costByAccount) {
    lines.push({ account_code: code, debit_cents: cost, memo })
  }
  if (inputVatCents > 0) {
    lines.push({ account_code: requireCode(settings, 'input_vat_account_code'), debit_cents: inputVatCents, memo })
  }
  const selfAssessedVatCents = taxFacts.reduce((sum, fact) => sum + fact.output_vat_cents, 0)
  if (selfAssessedVatCents > 0) {
    lines.push({
      account_code: requireCode(settings, 'output_vat_account_code'),
      credit_cents: selfAssessedVatCents,
      memo,
    })
  }
  lines.push({ account_code: payable, credit_cents: purchase.total_cents, memo })

  return postJournal(client, tenantId, {
    entryDate: toDateString(purchase.receipt_date),
    description: `Bill ${purchase.receipt_number} accrued`,
    sourceType: 'purchase', sourceId: purchase.id, sourceEvent: 'accrued', lines, taxFacts, ...opts,
  })
}

// Bill paid by bank: DR payable / CR checking. If a band member fronted the
// cash, the band owes that member instead: DR payable / CR reimbursement
// liability.
export async function postBillPaid(client, tenantId, purchase, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const payable = requireCode(settings, 'payable_account_code')
  const creditAccount = purchase.payment_method === 'member'
    ? requireCode(settings, 'default_reimbursement_account_code')
    : requireCode(settings, 'primary_checking_account_code')
  const memo = `Bill ${purchase.receipt_number} — ${purchase.supplier_name}`

  return postJournal(client, tenantId, {
    entryDate: toDateString(purchase.paid_at),
    description: `Bill ${purchase.receipt_number} paid`,
    sourceType: 'purchase', sourceId: purchase.id, sourceEvent: 'paid',
    lines: [
      { account_code: payable, debit_cents: purchase.total_cents, memo },
      { account_code: creditAccount, credit_cents: purchase.total_cents, memo },
    ],
    ...opts,
  })
}

// ---------- bank statement import journals ----------

// A bank-statement line posted as a direct journal (no matching invoice/bill).
// Received (credit): DR primary checking, CR the chosen contra account. Paid
// (debit): DR the chosen contra account, CR primary checking. Two distinct
// source events ('received' / 'paid') let the ledger browser sign the row
// without the direction.
//
// The bank amount is always gross: it is what actually moved, so the checking
// leg keeps it whole. A `vatRate` splits the *other* side into net + VAT —
// output VAT on money received, input VAT on money paid — exactly as an invoice
// or bill would, which is what makes these lines show up in the VAT return
// (computed from the VAT account balances). No rate (or 0) posts two legs as
// before.
export async function postBankStatementLine(client, tenantId, line, opts = {}) {
  const {
    id, entryDate, amountCents, direction, contraAccountCode, memo, vatRate = null,
    taxCategoryCode = null, taxJurisdictionCode = null, inputVatRecoveryPercent = 100,
  } = line
  const settings = await loadAccountingSettings(client, tenantId)
  const behavior = await loadAccountingBehavior(client, tenantId)
  const treatment = await resolveLiveTreatment(client, tenantId, toDateString(entryDate))
  const checking = requireCode(settings, 'primary_checking_account_code')
  const received = direction === 'credit'
  const saleVatRate = received && treatment.schemeExempt ? 0 : (vatRate ?? 0)
  const taxLine = {
    id,
    position: 0,
    amount_cents: amountCents,
    amount_incl_cents: amountCents, tax_rate: received ? saleVatRate : (vatRate ?? 0),
    vat_rate: received ? saleVatRate : (vatRate ?? 0),
    tax_category_code: taxCategoryCode,
    tax_jurisdiction_code: taxJurisdictionCode,
    input_vat_recovery_percent: inputVatRecoveryPercent,
  }
  const totals = computePurchaseLineTotals(taxLine)
  const fact = vatRate == null && !taxCategoryCode
    ? null
    : received
    ? saleTaxFact({
      line: taxLine,
      countryCode: behavior.accountingCountry,
      taxPoint: entryDate,
      taxableBaseCents: totals.netCents,
      taxCents: totals.vatCents,
      schemeCode: treatment.vat_scheme_code,
      schemeTreatment: treatment.vat_treatment,
      sourceLineKind: 'bank_statement_line',
    })
    : purchaseTaxFact({
      line: taxLine,
      countryCode: behavior.accountingCountry,
      taxPoint: entryDate,
      schemeCode: treatment.vat_scheme_code,
      inputVatRecoverable: treatment.inputVatRecoverable,
      sourceLineKind: 'bank_statement_line',
    })
  if (!fact && (vatRate != null || taxCategoryCode)) {
    throw new TaxClassificationError('Bank line')
  }
  const netCents = fact
    ? fact.taxable_base_cents + fact.non_deductible_input_vat_cents
    : totals.netCents
  const vatCents = received
    ? (fact?.output_vat_cents ?? totals.vatCents)
    : (fact?.deductible_input_vat_cents ?? totals.vatCents)

  const lines = received
    ? [
      { account_code: checking, debit_cents: amountCents, memo },
      { account_code: contraAccountCode, credit_cents: netCents, memo },
    ]
    : [
      { account_code: contraAccountCode, debit_cents: netCents, memo },
      { account_code: checking, credit_cents: amountCents, memo },
    ]
  if (vatCents > 0) {
    const vatCode = requireCode(settings, received ? 'output_vat_account_code' : 'input_vat_account_code')
    lines.push(received
      ? { account_code: vatCode, credit_cents: vatCents, memo }
      : { account_code: vatCode, debit_cents: vatCents, memo })
  }
  if (!received && (fact?.output_vat_cents ?? 0) > 0) {
    lines.push({
      account_code: requireCode(settings, 'output_vat_account_code'),
      credit_cents: fact.output_vat_cents,
      memo,
    })
  }

  return postJournal(client, tenantId, {
    entryDate: toDateString(entryDate),
    description: memo ?? null,
    sourceType: 'bank_statement_line',
    sourceId: id,
    sourceEvent: received ? 'received' : 'paid',
    lines,
    taxFacts: fact ? [fact] : [],
    ...opts,
  })
}

// ---------- opening balance journal (equity) ----------

// Sets the tenant's opening bank balance on a chosen date: a positive balance
// DR primary checking (asset up) / CR Opening Balance Equity; a negative
// (overdrawn) balance swaps the sides. `signedAmountCents` is the signed balance
// (positive = funds available). Idempotent per tenant — sourceId is the tenant
// id, so a second call returns { posted: false } and the "opening balance set"
// state can never be duplicated. Not clamped to the open period: this is a
// deliberate dated entry, so a closed period surfaces PeriodClosedError.
export async function postOpeningBalance(client, tenantId, { signedAmountCents, entryDate }, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const bank = requireCode(settings, 'primary_checking_account_code')
  const amount = Math.abs(signedAmountCents)
  const memo = 'Opening balance'
  const lines = signedAmountCents >= 0
    ? [
      { account_code: bank, debit_cents: amount, memo },
      { account_code: OPENING_BALANCE_EQUITY_CODE, credit_cents: amount, memo },
    ]
    : [
      { account_code: OPENING_BALANCE_EQUITY_CODE, debit_cents: amount, memo },
      { account_code: bank, credit_cents: amount, memo },
    ]

  return postJournal(client, tenantId, {
    entryDate: toDateString(entryDate),
    description: memo,
    sourceType: 'opening_balance', sourceId: tenantId, sourceEvent: 'set', lines, ...opts,
  })
}

// ---------- merch sale journals (revenue + COGS) ----------

// Merch sale recorded, one balanced journal combining the sale and cost legs:
// DR the receipt account gross (cash up — bank or cash on hand per the sale's
// payment_method), CR merch revenue net, CR output VAT;
// DR COGS / CR inventory at quantity × the sale's snapshotted unit cost.
// COGS uses the sale's snapshot of the product's moving-average cost, the same
// basis at which purchases booked the goods into inventory.
export async function postMerchSaleRecorded(client, tenantId, sale, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const behavior = await loadAccountingBehavior(client, tenantId)
  const cashAccount = requireCode(
    settings,
    sale.payment_method === 'cash' ? 'cash_account_code' : 'primary_checking_account_code',
  )
  // The sale snapshots the product's chosen revenue account; fall back to the
  // band default (incl. pre-snapshot sales whose code is null).
  const revenue = sale.revenue_account_code || requireCode(settings, 'merch_revenue_account_code')
  // Imported sales carry an exact inclusive total (gross_incl_cents) because a
  // discounted Shopify line gross may not divide evenly by quantity; manual
  // sales fall back to quantity × unit price.
  const grossCents = sale.gross_incl_cents ?? sale.quantity * sale.unit_price_incl_cents
  const totals = computePurchaseLineTotals({
    amount_incl_cents: grossCents, tax_rate: sale.vat_rate,
  })
  const taxFact = saleTaxFact({
    line: {
      id: sale.id,
      position: 0,
      vat_rate: sale.vat_rate,
      tax_category_code: sale.tax_category_code,
      tax_jurisdiction_code: sale.tax_jurisdiction_code,
    },
    countryCode: sale.accounting_country_snapshot ?? behavior.accountingCountry,
    taxPoint: sale.sale_date,
    taxableBaseCents: totals.netCents,
    taxCents: totals.vatCents,
    schemeCode: sale.vat_scheme_code_snapshot,
    schemeTreatment: sale.tax_treatment_snapshot,
    sourceLineKind: 'merch_sale',
  })
  if (!taxFact) throw new TaxClassificationError('Merch sale')
  const netCents = taxFact?.taxable_base_cents ?? totals.netCents
  const vatCents = taxFact?.output_vat_cents ?? totals.vatCents
  const cogsCents = sale.quantity * sale.unit_cost_cents
  const memo = `Merch sale: ${sale.quantity} × ${sale.product_name}`

  const lines = [
    { account_code: cashAccount, debit_cents: grossCents, memo },
    { account_code: revenue, credit_cents: netCents, memo },
  ]
  if (vatCents > 0) {
    lines.push({ account_code: requireCode(settings, 'output_vat_account_code'), credit_cents: vatCents, memo })
  }
  if (cogsCents > 0) {
    lines.push(
      { account_code: requireCode(settings, 'merch_cogs_account_code'), debit_cents: cogsCents, memo },
      { account_code: requireCode(settings, 'merch_inventory_account_code'), credit_cents: cogsCents, memo },
    )
  }

  return postJournal(client, tenantId, {
    entryDate: toDateString(sale.sale_date),
    description: memo,
    sourceType: 'merch_sale', sourceId: sale.id, sourceEvent: 'recorded',
    lines, taxFacts: taxFact ? [taxFact] : [], ...opts,
  })
}

// ---------- shopify import: revenue-only line ----------

// A Shopify order line mapped to a tenant revenue account rather than a product
// (shipping, a non-catalog item, …). No inventory/COGS: DR checking gross (all
// imports settle to bank), CR revenue net, CR output VAT. `line.id` is the
// shopify_order_imports row id, which is also the idempotency source_id.
export async function postShopifyRevenueLine(client, tenantId, line, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const behavior = await loadAccountingBehavior(client, tenantId)
  const checking = requireCode(settings, 'primary_checking_account_code')
  const totals = computePurchaseLineTotals({
    amount_incl_cents: line.amount_incl_cents, tax_rate: line.vat_rate,
  })
  const taxFact = saleTaxFact({
    line: {
      id: line.id,
      position: 0,
      vat_rate: line.vat_rate,
      tax_category_code: line.tax_category_code,
      tax_jurisdiction_code: line.tax_jurisdiction_code,
    },
    countryCode: behavior.accountingCountry,
    taxPoint: line.entry_date,
    taxableBaseCents: totals.netCents,
    taxCents: totals.vatCents,
    sourceLineKind: 'shopify_revenue_line',
  })
  if (!taxFact) throw new TaxClassificationError('Shopify line')
  const netCents = taxFact?.taxable_base_cents ?? totals.netCents
  const vatCents = taxFact?.output_vat_cents ?? totals.vatCents
  const memo = line.memo

  const lines = [
    { account_code: checking, debit_cents: line.amount_incl_cents, memo },
    { account_code: line.revenue_account_code, credit_cents: netCents, memo },
  ]
  if (vatCents > 0) {
    lines.push({ account_code: requireCode(settings, 'output_vat_account_code'), credit_cents: vatCents, memo })
  }

  return postJournal(client, tenantId, {
    entryDate: toDateString(line.entry_date),
    description: memo,
    sourceType: 'shopify_revenue_line', sourceId: line.id, sourceEvent: 'recorded',
    lines, taxFacts: taxFact ? [taxFact] : [], ...opts,
  })
}

// ---------- reimbursement journals (settling member debt) ----------

// Reimbursement paid: DR reimbursement liability (clears what the band owed the
// member), CR checking (cash out). Settles one or more member-paid purchases whose
// summed total is reimbursement.amount_cents.
export async function postReimbursementPaid(client, tenantId, reimbursement, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const liability = requireCode(settings, 'default_reimbursement_account_code')
  const checking = requireCode(settings, 'primary_checking_account_code')
  const memo = reimbursement.memo || `Reimbursement to band member ${reimbursement.band_member_id}`

  return postJournal(client, tenantId, {
    entryDate: toDateString(reimbursement.paid_on),
    description: `Reimbursement #${reimbursement.id}`,
    sourceType: 'reimbursement', sourceId: reimbursement.id, sourceEvent: 'paid',
    lines: [
      { account_code: liability, debit_cents: reimbursement.amount_cents, memo },
      { account_code: checking, credit_cents: reimbursement.amount_cents, memo },
    ],
    ...opts,
  })
}

// ---------- user journals (manual postings) ----------

// Posts a balanced amount on `side` ('debit' | 'credit') to `accountCode`.
function leg(accountCode, side, amountCents, memo) {
  return side === 'debit'
    ? { account_code: accountCode, debit_cents: amountCents, memo }
    : { account_code: accountCode, credit_cents: amountCents, memo }
}

// Posts a user-entered journal to the ledger. Per line: the gross amount_cents is
// split into net (→ account_code, on `side`) + VAT (→ input/output VAT account on
// the same side); when a balancing account is set, the gross posts to it on the
// opposite side, making a single row a complete balanced posting. Lines without a
// balancing account rely on the user balancing across the whole journal, which
// postJournal asserts. Callers must have validated postability first.
export async function postUserJournal(client, tenantId, journal, journalLines, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const behavior = await loadAccountingBehavior(client, tenantId)
  const treatment = await resolveLiveTreatment(client, tenantId, toDateString(journal.entry_date))
  const opposite = (side) => (side === 'debit' ? 'credit' : 'debit')
  const lines = []
  const taxFacts = []

  for (const jl of journalLines) {
    const effectiveVatRate = jl.side === 'credit' && treatment.schemeExempt
      ? 0
      : jl.vat_rate
    const factLine = effectiveVatRate === jl.vat_rate
      ? jl
      : { ...jl, vat_rate: effectiveVatRate }
    const totals = computePurchaseLineTotals({
      amount_incl_cents: jl.amount_cents, tax_rate: effectiveVatRate,
    })
    const fact = Number(jl.vat_rate) === 0 && !jl.tax_category_code
      ? null
      : jl.side === 'credit'
      ? saleTaxFact({
        line: factLine,
        countryCode: behavior.accountingCountry,
        taxPoint: journal.entry_date,
        taxableBaseCents: totals.netCents,
        taxCents: totals.vatCents,
        schemeCode: treatment.vat_scheme_code,
        schemeTreatment: treatment.vat_treatment,
        sourceLineKind: 'journal_line',
      })
      : purchaseTaxFact({
        line: factLine,
        countryCode: behavior.accountingCountry,
        taxPoint: journal.entry_date,
        schemeCode: treatment.vat_scheme_code,
        inputVatRecoverable: treatment.inputVatRecoverable,
        sourceLineKind: 'journal_line',
      })
    if (!fact && (Number(jl.vat_rate) !== 0 || jl.tax_category_code)) {
      throw new TaxClassificationError('Journal line')
    }
    if (fact) taxFacts.push(fact)
    const netCents = fact
      ? fact.taxable_base_cents + fact.non_deductible_input_vat_cents
      : totals.netCents
    const vatCents = jl.side === 'credit'
      ? (fact?.output_vat_cents ?? totals.vatCents)
      : (fact?.deductible_input_vat_cents ?? totals.vatCents)
    const memo = jl.description || journal.description || null

    lines.push(leg(jl.account_code, jl.side, netCents, memo))
    if (vatCents > 0) {
      const vatField = jl.side === 'debit' ? 'input_vat_account_code' : 'output_vat_account_code'
      lines.push(leg(requireCode(settings, vatField), jl.side, vatCents, memo))
    }
    if (jl.side === 'debit' && (fact?.output_vat_cents ?? 0) > 0) {
      lines.push(leg(requireCode(settings, 'output_vat_account_code'), 'credit', fact.output_vat_cents, memo))
    }
    if (jl.balancing_account_code) {
      lines.push(leg(jl.balancing_account_code, opposite(jl.side), jl.amount_cents, memo))
    }
  }

  return postJournal(client, tenantId, {
    entryDate: toDateString(journal.entry_date),
    // No header description → fall back to the first line's, so the ledger
    // browser doesn't show a blank row.
    description: journal.description ?? journalLines[0]?.description ?? null,
    sourceType: 'journal', sourceId: journal.id, sourceEvent: 'posted', lines, taxFacts, ...opts,
  })
}
