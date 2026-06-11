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

export async function postJournal(client, tenantId, {
  entryDate, description, sourceType, sourceId, sourceEvent, lines,
  actorUserId = null, clampToOpenPeriod = false,
}) {
  // Period close: user postings into a closed period are rejected; system
  // postings (clampToOpenPeriod, e.g. webhook cash receipts) move to the first
  // open day so external money is never silently dropped.
  const { rows: settingsRows } = await client.query(
    `SELECT to_char(books_closed_through, 'YYYY-MM-DD') AS closed_through
       FROM tenant_accounting_settings WHERE tenant_id = $1`,
    [tenantId],
  )
  const closedThrough = settingsRows[0]?.closed_through || null
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

  // Group net amounts by expense account; lines without a code fall back to the
  // tenant default expense account.
  const netByAccount = new Map()
  for (const line of purchaseLines) {
    const { netCents } = computePurchaseLineTotals(line)
    const code = line.account_code || requireCode(settings, 'default_expense_account_code')
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
    description: journal.description ?? null,
    sourceType: 'journal', sourceId: journal.id, sourceEvent: 'posted', lines, ...opts,
  })
}
