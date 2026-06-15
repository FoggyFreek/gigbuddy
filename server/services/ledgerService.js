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
import { computePurchaseLineTotals } from '../../shared/purchaseTotals.js'
import { classify, describe, receiptFor } from './ledgerEntryTypes.js'
import {
  listTransactions,
  getTransaction,
  getTransactionBySource,
  listLines,
  listEntryDates,
  monthlyResultTotals,
  annualResultTotals,
  vatTotals,
  checkingAccountBalance,
  merchTotals,
  merchInventoryValue,
} from '../repositories/ledgerRepository.js'
import { openInvoiceBuckets } from '../repositories/invoiceRepository.js'

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

// Maps the ledger guard errors to a discriminated { error } result for the HTTP
// layer, or null when the error is not a ledger guard and should propagate.
export function ledgerErrorResult(err) {
  if (err instanceof AccountingNotConfiguredError) {
    return { error: { status: err.status, body: { error: err.message, code: err.code, field: err.field } } }
  }
  if (err instanceof PeriodClosedError) {
    return { error: { status: err.status, body: { error: err.message, code: err.code, closed_through: err.closedThrough } } }
  }
  return null
}

// Per-tenant advisory lock serializing ledger postings against accounting
// settings changes. Posting transactions take it via loadAccountingSettings
// (their first settings read); the settings PATCH takes it before its
// open-balance checks, so a posting in flight to the old account codes commits
// (and is seen by the balance check) before the codes can change, and vice
// versa. Transaction-scoped: released automatically at COMMIT/ROLLBACK.
export const ACCOUNTING_SETTINGS_LOCK_NAMESPACE = 53002

export async function acquireAccountingSettingsLock(client, tenantId) {
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [ACCOUNTING_SETTINGS_LOCK_NAMESPACE, tenantId])
}

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
  const { rows } = await client.query(
    'SELECT * FROM tenant_accounting_settings WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0] || null
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

async function fetchBooksClosedThrough(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT to_char(books_closed_through, 'YYYY-MM-DD') AS closed_through
       FROM tenant_accounting_settings WHERE tenant_id = $1`,
    [tenantId],
  )
  return rows[0]?.closed_through || null
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
}

export async function postJournal(client, tenantId, {
  entryDate, description, sourceType, sourceId, sourceEvent, lines,
  actorUserId = null, clampToOpenPeriod = false,
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

  const { rows } = await client.query(
    `INSERT INTO ledger_transactions
       (tenant_id, entry_date, description, source_type, source_id, source_event, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, source_type, source_id, source_event) DO NOTHING
     RETURNING id`,
    [tenantId, effectiveDate, effectiveDescription, sourceType, sourceId, sourceEvent, actorUserId],
  )
  if (!rows.length) return { posted: false }
  const transactionId = rows[0].id

  for (const l of normalized) {
    await client.query(
      `INSERT INTO ledger_entries
         (tenant_id, transaction_id, account_code, debit_cents, credit_cents, memo)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, transactionId, l.account_code, l.debit_cents, l.credit_cents, l.memo],
    )
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
    return row.merch_sale_quantity * row.merch_sale_unit_price_incl_cents
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
  const lines = await listLines(executor, tenantId, transactionId)
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
    origin: originFor(row),
    lines,
  }
}

// Posts a correcting transaction: a new journal dated today with every line of
// `original` debit/credit-swapped. `mode` is 'void' or 'reversal'; the
// source_event records which.
// Marks an original transaction as voided by its (open-period) compensating
// entry: the original then hides from the default list and drops from reports.
async function markVoided(client, tenantId, originalId, byTransactionId) {
  await client.query(
    `UPDATE ledger_transactions SET voided_by_transaction_id = $1, voided_at = NOW()
      WHERE id = $2 AND tenant_id = $3`,
    [byTransactionId, originalId, tenantId],
  )
}

// Marks an original as reversed by a visible (closed-period) correction: both
// halves stay in the ledger and in reports, netting the mistake out forward.
async function markReversed(client, tenantId, originalId, byTransactionId) {
  await client.query(
    `UPDATE ledger_transactions SET reversed_by_transaction_id = $1
      WHERE id = $2 AND tenant_id = $3`,
    [byTransactionId, originalId, tenantId],
  )
}

// Flags a transaction's own voided_at so it drops from reports. Used on the
// compensating half of a domain void (merch) that isn't a ledger_transaction/void,
// so the open-period pair nets to zero like a manual void does.
async function markVoidedAt(client, tenantId, transactionId) {
  await client.query(
    `UPDATE ledger_transactions SET voided_at = NOW() WHERE id = $1 AND tenant_id = $2`,
    [transactionId, tenantId],
  )
}

async function postReversingJournal(client, tenantId, original, mode, actorUserId) {
  const verb = mode === 'void' ? 'Void' : 'Reversal'
  const lines = (await listLines(client, tenantId, original.id)).map((l) => ({
    account_code: l.account_code,
    debit_cents: l.credit_cents,
    credit_cents: l.debit_cents,
    memo: l.memo,
  }))
  return postJournal(client, tenantId, {
    entryDate: today(),
    description: `${verb} of ledger entry #${original.id}`,
    sourceType: 'ledger_transaction', sourceId: original.id, sourceEvent: mode,
    lines, actorUserId,
  })
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
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const row = await getTransaction(client, tenantId, transactionId)
    if (!row) {
      await client.query('ROLLBACK')
      return { error: { status: 404, body: { error: 'Not found' } } }
    }
    const rowConflict = correctionRowConflict(row)
    if (rowConflict) {
      await client.query('ROLLBACK')
      return { error: rowConflict }
    }

    const closedThrough = await fetchBooksClosedThrough(client, tenantId)
    const isClosed = Boolean(closedThrough && row.entry_date <= closedThrough)
    const periodConflict = correctionPeriodConflict(mode, isClosed, closedThrough)
    if (periodConflict) {
      await client.query('ROLLBACK')
      return { error: periodConflict }
    }

    let result
    try {
      result = await postReversingJournal(client, tenantId, row, mode, actorUserId)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      const mapped = ledgerErrorResult(err)
      if (mapped) return mapped
      throw err
    }
    if (!result.posted) {
      await client.query('ROLLBACK')
      const code = mode === 'void' ? 'already_voided' : 'already_reversed'
      return { error: { status: 409, body: { error: 'Entry already corrected', code } } }
    }

    // Mark the original. The compensating ledger_transaction/void is excluded
    // from reports by its source_event, so only the original needs marking.
    if (mode === 'void') {
      await markVoided(client, tenantId, transactionId, result.transactionId)
    } else {
      await markReversed(client, tenantId, transactionId, result.transactionId)
    }

    await client.query('COMMIT')
    return { transactionId: result.transactionId }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
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
export async function resolveEffectiveRange(executor, tenantId, range) {
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
  const year = new Date().getFullYear()
  return { from: `${year}-01-01`, toExclusive: `${year + 1}-01-01` }
}

// Aggregates the financial dashboard: revenue/expense/result per month over
// the requested period (null range = all time, spanning the booked entries),
// the VAT position of the *current* quarter, and the open invoice buckets
// (which reflect current status, not the period).
export async function getFinancialOverview(executor, tenantId, range) {
  const effectiveRange = await resolveEffectiveRange(executor, tenantId, range)

  // Trailing-three-calendar-years result trend, pinned to "today" (independent
  // of the selected period, like the VAT and bank figures).
  const TREND_YEARS = 3
  const currentYear = new Date().getFullYear()
  const firstTrendYear = currentYear - (TREND_YEARS - 1)
  const annualRange = { from: `${firstTrendYear}-01-01`, toExclusive: `${currentYear + 1}-01-01` }

  const vatQuarter = currentVatQuarter()
  const [monthRows, annualRows, vat, buckets, settings, bankBalanceCents, merch, merchInventoryCents] =
    await Promise.all([
      monthlyResultTotals(executor, tenantId, effectiveRange),
      annualResultTotals(executor, tenantId, annualRange),
      vatTotals(executor, tenantId, vatQuarter.range),
      openInvoiceBuckets(executor, tenantId),
      loadAccountingSettings(executor, tenantId),
      checkingAccountBalance(executor, tenantId),
      merchTotals(executor, tenantId, effectiveRange),
      merchInventoryValue(executor, tenantId),
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

  return {
    currency: settings?.currency || 'EUR',
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
  }
}

// ---------- invoice journals (revenue) ----------

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

  return postJournal(client, tenantId, {
    entryDate: toDateString(invoice.issue_date),
    description: `Invoice ${invoice.invoice_number} sent`,
    sourceType: 'invoice', sourceId: invoice.id, sourceEvent: 'sent', lines, ...opts,
  })
}

// Invoice paid: DR checking (cash up), CR receivable (clears the asset).
export async function postInvoicePaid(client, tenantId, invoice, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const checking = requireCode(settings, 'primary_checking_account_code')
  const receivable = requireCode(settings, 'receivable_account_code')
  const memo = `Invoice ${invoice.invoice_number}`

  return postJournal(client, tenantId, {
    entryDate: toDateString(invoice.mollie_paid_at),
    description: `Invoice ${invoice.invoice_number} paid`,
    sourceType: 'invoice', sourceId: invoice.id, sourceEvent: 'paid',
    lines: [
      { account_code: checking, debit_cents: invoice.total_cents, memo },
      { account_code: receivable, credit_cents: invoice.total_cents, memo },
    ],
    ...opts,
  })
}

// Invoice voided: reverses the `sent` journal (CR receivable, DR revenue, DR VAT).
export async function postInvoiceVoid(client, tenantId, invoice, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const receivable = requireCode(settings, 'receivable_account_code')
  const revenue = requireCode(settings, 'default_revenue_account_code')
  const netCents = invoice.subtotal_cents - invoice.discount_cents
  const memo = `Invoice ${invoice.invoice_number} voided`

  const lines = [
    { account_code: receivable, credit_cents: invoice.total_cents, memo },
    { account_code: revenue, debit_cents: netCents, memo },
  ]
  if (invoice.tax_cents > 0) {
    lines.push({ account_code: requireCode(settings, 'output_vat_account_code'), debit_cents: invoice.tax_cents, memo })
  }

  return postJournal(client, tenantId, {
    entryDate: today(),
    description: `Invoice ${invoice.invoice_number} voided`,
    sourceType: 'invoice', sourceId: invoice.id, sourceEvent: 'void', lines, ...opts,
  })
}

// ---------- purchase journals (expenses) ----------

// Bill accrued (on approve): DR expense account(s) per line (grouped on net),
// DR input VAT (claimable asset), CR payable (liability up).
export async function postBillAccrued(client, tenantId, purchase, purchaseLines, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const payable = requireCode(settings, 'payable_account_code')
  const memo = `Bill ${purchase.receipt_number} — ${purchase.supplier_name}`

  // Group net amounts by account. Lines that stock a product book to the merch
  // inventory asset (the goods aren't an expense until sold); other lines use
  // their explicit code or fall back to the tenant default expense account.
  const netByAccount = new Map()
  for (const line of purchaseLines) {
    const { netCents } = computePurchaseLineTotals(line)
    const code = line.product_id
      ? requireCode(settings, 'merch_inventory_account_code')
      : (line.account_code || requireCode(settings, 'default_expense_account_code'))
    netByAccount.set(code, (netByAccount.get(code) || 0) + netCents)
  }

  const lines = []
  for (const [code, net] of netByAccount) {
    lines.push({ account_code: code, debit_cents: net, memo })
  }
  if (purchase.tax_cents > 0) {
    lines.push({ account_code: requireCode(settings, 'input_vat_account_code'), debit_cents: purchase.tax_cents, memo })
  }
  lines.push({ account_code: payable, credit_cents: purchase.total_cents, memo })

  return postJournal(client, tenantId, {
    entryDate: toDateString(purchase.receipt_date),
    description: `Bill ${purchase.receipt_number} accrued`,
    sourceType: 'purchase', sourceId: purchase.id, sourceEvent: 'accrued', lines, ...opts,
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

// ---------- merch sale journals (revenue + COGS) ----------

// Merch sale recorded, one balanced journal combining the sale and cost legs:
// DR the receipt account gross (cash up — bank or cash on hand per the sale's
// payment_method), CR merch revenue net, CR output VAT;
// DR COGS / CR inventory at quantity × the sale's snapshotted unit cost.
// COGS uses the sale's snapshot of the product's moving-average cost, the same
// basis at which purchases booked the goods into inventory.
export async function postMerchSaleRecorded(client, tenantId, sale, opts = {}) {
  const settings = await loadAccountingSettings(client, tenantId)
  const cashAccount = requireCode(
    settings,
    sale.payment_method === 'cash' ? 'cash_account_code' : 'primary_checking_account_code',
  )
  // The sale snapshots the product's chosen revenue account; fall back to the
  // band default (incl. pre-snapshot sales whose code is null).
  const revenue = sale.revenue_account_code || requireCode(settings, 'merch_revenue_account_code')
  const grossCents = sale.quantity * sale.unit_price_incl_cents
  const { netCents, vatCents } = computePurchaseLineTotals({
    amount_incl_cents: grossCents, tax_rate: sale.vat_rate,
  })
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
    sourceType: 'merch_sale', sourceId: sale.id, sourceEvent: 'recorded', lines, ...opts,
  })
}

// Merch sale voided: an exact mirror of `recorded` (debit/credit swapped) dated
// today (corrections-forward), which also marks the original recorded entry so
// the void is reflected in the ledger browser. Splits on the original's booking
// period exactly like a manual correction:
//   open period   → the original is *voided*: both halves hide from the default
//                   list and drop from reports. The compensating carries its own
//                   voided_at so the pair still nets to zero.
//   closed period → the original is *reversed*: a visible 'reversal' correction
//                   that stays in the ledger and reports, never mutating the
//                   closed period.
export async function postMerchSaleVoided(client, tenantId, sale, opts = {}) {
  const original = await getTransactionBySource(client, tenantId, 'merch_sale', sale.id, 'recorded')
  const closedThrough = await fetchBooksClosedThrough(client, tenantId)
  const isClosed = Boolean(original && closedThrough && original.entry_date <= closedThrough)

  const settings = await loadAccountingSettings(client, tenantId)
  const cashAccount = requireCode(
    settings,
    sale.payment_method === 'cash' ? 'cash_account_code' : 'primary_checking_account_code',
  )
  // Same snapshotted account as the original recorded posting so the reversal
  // nets out exactly, even if the product's account changed since the sale.
  const revenue = sale.revenue_account_code || requireCode(settings, 'merch_revenue_account_code')
  const grossCents = sale.quantity * sale.unit_price_incl_cents
  const { netCents, vatCents } = computePurchaseLineTotals({
    amount_incl_cents: grossCents, tax_rate: sale.vat_rate,
  })
  const cogsCents = sale.quantity * sale.unit_cost_cents
  const memo = `Merch sale ${isClosed ? 'reversed' : 'voided'}: ${sale.quantity} × ${sale.product_name}`

  const lines = [
    { account_code: cashAccount, credit_cents: grossCents, memo },
    { account_code: revenue, debit_cents: netCents, memo },
  ]
  if (vatCents > 0) {
    lines.push({ account_code: requireCode(settings, 'output_vat_account_code'), debit_cents: vatCents, memo })
  }
  if (cogsCents > 0) {
    lines.push(
      { account_code: requireCode(settings, 'merch_cogs_account_code'), credit_cents: cogsCents, memo },
      { account_code: requireCode(settings, 'merch_inventory_account_code'), debit_cents: cogsCents, memo },
    )
  }

  const result = await postJournal(client, tenantId, {
    entryDate: today(),
    description: memo,
    sourceType: 'merch_sale', sourceId: sale.id,
    sourceEvent: isClosed ? 'reversal' : 'voided', lines, ...opts,
  })

  if (result.posted && original) {
    if (isClosed) {
      await markReversed(client, tenantId, original.id, result.transactionId)
    } else {
      await markVoided(client, tenantId, original.id, result.transactionId)
      await markVoidedAt(client, tenantId, result.transactionId)
    }
  }
  return result
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
  const opposite = (side) => (side === 'debit' ? 'credit' : 'debit')
  const lines = []

  for (const jl of journalLines) {
    const { netCents, vatCents } = computePurchaseLineTotals({
      amount_incl_cents: jl.amount_cents, tax_rate: jl.vat_rate,
    })
    const memo = jl.description || journal.description || null

    lines.push(leg(jl.account_code, jl.side, netCents, memo))
    if (vatCents > 0) {
      const vatField = jl.side === 'debit' ? 'input_vat_account_code' : 'output_vat_account_code'
      lines.push(leg(requireCode(settings, vatField), jl.side, vatCents, memo))
    }
    if (jl.balancing_account_code) {
      lines.push(leg(jl.balancing_account_code, opposite(jl.side), netCents + vatCents, memo))
    }
  }

  return postJournal(client, tenantId, {
    entryDate: toDateString(journal.entry_date),
    // No header description → fall back to the first line's, so the ledger
    // browser doesn't show a blank row.
    description: journal.description ?? journalLines[0]?.description ?? null,
    sourceType: 'journal', sourceId: journal.id, sourceEvent: 'posted', lines, ...opts,
  })
}
