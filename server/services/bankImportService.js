// Bank-statement import: parse+stage a CAMT.053/MT940 file, then commit per-line
// decisions into the ledger. Two-phase so client requests never carry money —
// amounts and eligibility are re-read from the staged rows (and locked target
// docs) at commit time. Each line commits in its own transaction (report-and-
// skip): one failing line never rolls back the others. Modeled on the Shopify
// importer (merchShopifyService.js).
import crypto from 'node:crypto'
import { parseBankStatement, BankStatementParseError } from './bankStatement/index.js'
import {
  postBankStatementLine,
  postOpeningBalance,
  ledgerErrorResult,
} from './ledgerService.js'
import { settleInvoice } from './invoiceService.js'
import { settlePurchase } from './purchaseService.js'
import { hasOpeningBalance } from '../repositories/ledgerRepository.js'
import { accountExistsOfType } from '../repositories/accountRepository.js'
import {
  findSuppliersForImport,
  insertContact,
  contactExistsInTenant,
} from '../repositories/contactRepository.js'
import { normalizeIban } from '../validators/contactValidators.js'
import { clearInvoicePaymentLink, markInvoicePaid } from '../repositories/invoiceRepository.js'
import { deactivateMolliePaymentLink } from './molliePaymentLinkService.js'
import {
  findImportByHash,
  insertImport,
  fetchImport,
  lockImport,
  importHasCommittedLines,
  deleteImport,
  markImportCommitted,
  insertLine,
  listLines,
  countPendingLines,
  lockLine,
  markLineResult,
  existingBankReferenceRows,
  listOpenInvoices,
  listOpenPurchases,
  lockInvoice,
  lockPurchase,
  reserveMollieReconciliation,
  fetchMollieReconciliation,
  markMollieReconciliation,
  lockMollieReconciliation,
} from '../repositories/bankImportRepository.js'

// Groups rows by a key into a Map<key, row[]> for O(1) in-memory matching.
function groupBy(rows, keyOf) {
  const map = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    const bucket = map.get(key)
    if (bucket) bucket.push(row)
    else map.set(key, [row])
  }
  return map
}

const MAX_BYTES = 10 * 1024 * 1024
// Matches the commit-side decision cap (bankImportValidators.parseCommitBody) so
// a staged import can always be committed in one request.
const MAX_LINES = 1000

function badRequest(error, code) {
  return { error: { status: 400, body: code ? { error, code } : { error } } }
}

async function tenantCurrency(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT currency FROM tenant_accounting_settings WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0]?.currency || 'EUR'
}

function lineMemo(line) {
  return [line.counterparty_name, line.remittance_info].filter(Boolean).join(' — ') || null
}

function duplicateIdentity({ accountIban, bankRef, bookingDate, amountCents, direction }) {
  if (!bankRef) return null
  return [accountIban ?? '', bankRef, String(bookingDate), amountCents, direction].join('\u001f')
}

// ---------- parse + stage ----------

export async function parseAndStage(db, tenantId, file, userId) {
  if (!file?.buffer?.length) return badRequest('No file uploaded')
  if (file.buffer.length > MAX_BYTES) return badRequest('File too large')

  const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex')

  // Exact re-upload → return the existing staged import (idempotent).
  const existing = await findImportByHash(db, tenantId, fileHash)
  if (existing) return decorateImport(db, tenantId, existing)

  let parsed
  try {
    parsed = parseBankStatement(file.buffer)
  } catch (err) {
    if (err instanceof BankStatementParseError) return badRequest(err.message, 'parse_failed')
    throw err
  }
  if (!parsed.lines.length) return badRequest('Statement has no transactions', 'empty_statement')
  if (parsed.lines.length > MAX_LINES) {
    return badRequest(`Statement has too many transactions (max ${MAX_LINES})`, 'too_many_lines')
  }

  const currency = await tenantCurrency(db, tenantId)

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    let imp = await insertImport(client, tenantId, {
      filename: file.originalname || 'statement',
      format: parsed.format,
      currency: parsed.currency,
      statementRef: parsed.statementRef,
      accountIban: parsed.accountIban,
      fileHash,
      openingBalanceCents: parsed.openingBalance?.signedAmountCents ?? null,
      openingBalanceDate: parsed.openingBalance?.date ?? null,
      createdByUserId: userId,
    })
    let pendingCount = 0
    for (let i = 0; i < parsed.lines.length; i++) {
      const line = parsed.lines[i]
      const lineCurrency = line.currency || parsed.currency || currency
      // Only the tenant currency is postable; others stage as a skip so the
      // history is preserved but they never reach the ledger.
      const status = lineCurrency && lineCurrency !== currency ? 'skipped_currency' : 'pending'
      if (status === 'pending') pendingCount++
      await insertLine(client, tenantId, imp.id, i, line, status)
    }
    if (pendingCount === 0) imp = await markImportCommitted(client, tenantId, imp.id)
    await client.query('COMMIT')
    return decorateImport(db, tenantId, imp)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err.code === '23505' && err.constraint === 'bank_statement_imports_tenant_id_file_hash_key') {
      const winner = await findImportByHash(db, tenantId, fileHash)
      if (winner) return decorateImport(db, tenantId, winner)
    }
    throw err
  } finally {
    client.release()
  }
}

// Attaches per-line reconciliation/supplier suggestions and a soft duplicate
// flag. Read-only — the frontend uses these to pre-fill the review step.
async function decorateImport(db, tenantId, imp) {
  const lines = await listLines(db, tenantId, imp.id)
  const pending = lines.filter((l) => l.status === 'pending')
  const debits = pending.filter((l) => l.direction === 'debit')

  // Batched lookups — one query each, not one per line.
  const priorReferenceRows = await existingBankReferenceRows(
    db, tenantId, lines.map((l) => l.bank_ref), imp.id,
  )
  const priorIdentities = new Set(priorReferenceRows.map((row) => duplicateIdentity({
    accountIban: row.account_iban,
    bankRef: row.bank_ref,
    bookingDate: row.booking_date,
    amountCents: row.amount_cents,
    direction: row.direction,
  })))
  const openInvoices = pending.some((l) => l.direction === 'credit')
    ? (await listOpenInvoices(db, tenantId)).map(toInvoiceMatch)
    : []
  const openPurchases = debits.length ? await listOpenPurchases(db, tenantId) : []
  const suppliers = debits.length
    ? await findSuppliersForImport(db, tenantId, debits.map((l) => l.counterparty_iban), debits.map((l) => l.counterparty_name))
    : []

  const invByAmount = groupBy(openInvoices, (i) => i.total_cents)
  const purByAmount = groupBy(openPurchases, (p) => p.total_cents)
  const supByIban = groupBy(suppliers.filter((s) => s.iban), (s) => s.iban.toUpperCase())
  const supByName = groupBy(suppliers, (s) => (s.name ?? '').toLowerCase())

  const decorated = lines.map((line) => {
    const suggestion = { possibleDuplicate: false, supplierMatches: [], invoiceMatches: [], purchaseMatches: [] }
    const identity = duplicateIdentity({
      accountIban: imp.account_iban,
      bankRef: line.bank_ref,
      bookingDate: line.booking_date,
      amountCents: line.amount_cents,
      direction: line.direction,
    })
    suggestion.possibleDuplicate = identity != null && priorIdentities.has(identity)

    if (line.status === 'pending') {
      if (line.direction === 'debit') {
        suggestion.purchaseMatches = purByAmount.get(line.amount_cents) ?? []
        const byIban = line.counterparty_iban ? supByIban.get(line.counterparty_iban.toUpperCase()) : null
        suggestion.supplierMatches = (byIban && byIban.length)
          ? byIban
          : (line.counterparty_name ? (supByName.get(line.counterparty_name.toLowerCase()) ?? []) : [])
      } else {
        suggestion.invoiceMatches = invByAmount.get(line.amount_cents) ?? []
      }
    }
    return { ...line, suggestion }
  })

  // Nudge to set the opening balance from this statement when the tenant has
  // none yet and the statement carried one. Recomputed on every parse/get, so
  // the banner reappears on each import until an opening balance exists.
  const openingBalanceSuggested = imp.opening_balance_cents != null
    && !(await hasOpeningBalance(db, tenantId))

  return {
    import: { ...imp, opening_balance_date: toDateOnly(imp.opening_balance_date) },
    lines: decorated,
    openingBalanceSuggested,
  }
}

// Shapes an open-invoice row into a reconciliation match, nesting the linked
// gig's headline (event name, venue/festival, date) so the review UI can show
// what the invoice was for. `gig` is null when the invoice isn't linked to a gig.
function toInvoiceMatch(row) {
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    customer_name: row.customer_name,
    total_cents: row.total_cents,
    mollie_payment_link_id: row.mollie_payment_link_id,
    gig: row.gig_id
      ? {
        event_description: row.gig_event_description,
        event_date: toDateOnly(row.gig_event_date),
        venue_name: row.gig_venue_name,
        festival_name: row.gig_festival_name,
      }
      : null,
  }
}

// Postgres returns a DATE column as a Date; normalize to a plain 'YYYY-MM-DD'
// string for the client.
function toDateOnly(value) {
  if (!value) return null
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

export async function getImport(db, tenantId, importId) {
  const imp = await fetchImport(db, tenantId, importId)
  if (!imp) return { error: { status: 404, body: { error: 'Not found' } } }
  return decorateImport(db, tenantId, imp)
}

export async function cancelImport(db, tenantId, importId) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const imp = await lockImport(client, tenantId, importId)
    if (!imp) {
      await client.query('ROLLBACK')
      return { error: { status: 404, body: { error: 'Not found' } } }
    }
    if (await importHasCommittedLines(client, tenantId, importId)) {
      await client.query('ROLLBACK')
      return {
        error: {
          status: 409,
          body: {
            error: 'Import has already committed lines',
            code: 'bank_import_has_committed_lines',
          },
        },
      }
    }
    await deleteImport(client, tenantId, importId)
    await client.query('COMMIT')
    return {}
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Posts the opening balance from a staged import's own opening-balance value
// (never client-supplied — re-read from the staged row). Idempotent per tenant
// via postOpeningBalance; a second attempt (or a tenant that already has one)
// 409s opening_balance_exists.
export async function setOpeningBalanceFromImport(db, tenantId, importId, userId) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const imp = await lockImport(client, tenantId, importId)
    if (!imp) {
      await client.query('ROLLBACK')
      return { error: { status: 404, body: { error: 'Not found' } } }
    }
    if (imp.opening_balance_cents == null) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'This statement has no opening balance', code: 'no_opening_balance' } } }
    }
    const result = await postOpeningBalance(client, tenantId, {
      signedAmountCents: imp.opening_balance_cents,
      entryDate: toDateOnly(imp.opening_balance_date),
    }, { actorUserId: userId })
    if (!result.posted) {
      await client.query('ROLLBACK')
      return { error: { status: 409, body: { error: 'Opening balance already set', code: 'opening_balance_exists' } } }
    }
    await client.query('COMMIT')
    return { posted: true, transactionId: result.transactionId }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped) return mapped
    throw err
  } finally {
    client.release()
  }
}

// ---------- commit ----------

export async function commitImport(db, tenantId, importId, decisions, userId) {
  const imp = await fetchImport(db, tenantId, importId)
  if (!imp) return { error: { status: 404, body: { error: 'Not found' } } }

  const results = []
  for (const decision of decisions) {
    const status = await commitDecision(db, tenantId, importId, decision, userId)
    results.push({ line_id: decision.lineId, status })
  }
  // Finalize only once every line has a terminal status; a partial commit leaves
  // the import staged so the remaining lines can still be decided.
  if (await countPendingLines(db, tenantId, importId) === 0) {
    await markImportCommitted(db, tenantId, importId)
  }

  const imported = results.filter((r) => r.status === 'imported'
    || r.status === 'reconciled_invoice' || r.status === 'reconciled_purchase').length
  return { imported, skipped: results.length - imported, results }
}

async function commitDecision(db, tenantId, importId, decision, userId) {
  if (decision.action !== 'reconcile_invoice') {
    return commitLine(db, tenantId, importId, decision, userId)
  }
  const reserved = await reserveLinkedInvoiceReconciliation(
    db, tenantId, importId, decision, userId,
  )
  if (!reserved) return commitLine(db, tenantId, importId, decision, userId)
  if (typeof reserved === 'string') return reserved

  return withMollieReconciliationLock(db, reserved.operation.id, async () => {
    const current = await fetchMollieReconciliation(db, tenantId, decision.lineId)
    if (current?.status === 'completed') return 'reconciled_invoice'
    if (current?.status === 'mollie_paid') return 'skipped_invoice_paid_via_mollie'
    if (current?.status === 'conflict') return 'skipped_mollie_reconciliation_conflict'

    if (current?.status !== 'deactivated') {
      const remote = await deactivateMolliePaymentLink({
        pool: db,
        invoice: reserved.invoice,
        tenantId,
        invoiceId: reserved.invoice.id,
      })
      if (remote.error) {
        const paid = remote.error.body?.code === 'payment_link_paid'
        await markMollieReconciliation(
          db, tenantId, reserved.operation.id,
          paid ? 'mollie_paid' : 'retryable_error',
          remote.error.body?.code ?? 'mollie_error',
        )
        return paid ? 'skipped_invoice_paid_via_mollie' : 'skipped_mollie_error'
      }
      await markMollieReconciliation(db, tenantId, reserved.operation.id, 'deactivated')
    }
    return finalizeLinkedInvoiceReconciliation(
      db, tenantId, importId, decision, userId, reserved.operation.id,
    )
  })
}

const MOLLIE_RECONCILIATION_LOCK_NAMESPACE = 1936027746

// Serializes retries for one durable operation without wrapping the provider
// call in a transaction. A waiting request observes the winner's terminal state.
async function withMollieReconciliationLock(db, operationId, fn) {
  const client = await db.connect()
  let releaseError = null
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [MOLLIE_RECONCILIATION_LOCK_NAMESPACE, operationId])
    return await fn()
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [MOLLIE_RECONCILIATION_LOCK_NAMESPACE, operationId])
    } catch (err) {
      releaseError = err
    }
    client.release(releaseError)
  }
}

// Short local reservation transaction. A null result means the invoice has no
// active link and should use the ordinary reconciliation path.
async function reserveLinkedInvoiceReconciliation(db, tenantId, importId, decision, userId) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const imp = await lockImport(client, tenantId, importId)
    if (!imp) { await client.query('ROLLBACK'); return 'skipped_not_found' }
    const line = await lockLine(client, tenantId, importId, decision.lineId)
    const invoice = await lockInvoice(client, tenantId, decision.invoiceId)
    if (!line || !invoice) { await client.query('ROLLBACK'); return 'skipped_not_found' }
    if (line.status !== 'pending') { await client.query('ROLLBACK'); return 'skipped_already_committed' }
    if (line.direction !== 'credit') { await client.query('ROLLBACK'); return 'skipped_direction_mismatch' }
    if (invoice.status !== 'sent') { await client.query('ROLLBACK'); return 'skipped_invoice_not_open' }
    if (invoice.total_cents !== line.amount_cents) { await client.query('ROLLBACK'); return 'skipped_amount_mismatch' }
    if (!invoice.mollie_payment_link_id) { await client.query('ROLLBACK'); return null }

    const operation = await reserveMollieReconciliation(
      client, tenantId, line.id, invoice.id, userId,
    )
    if (!operation || operation.invoice_id !== invoice.id
        || operation.mollie_payment_link_id !== invoice.mollie_payment_link_id) {
      await client.query('ROLLBACK')
      return 'skipped_mollie_reconciliation_conflict'
    }
    await client.query('COMMIT')
    return { operation, invoice }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function finalizeLinkedInvoiceReconciliation(db, tenantId, importId, decision, userId, operationId) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const operation = await lockMollieReconciliation(client, tenantId, operationId)
    if (operation?.status === 'completed') {
      await client.query('COMMIT')
      return 'reconciled_invoice'
    }
    const line = await lockLine(client, tenantId, importId, decision.lineId)
    const invoice = await lockInvoice(client, tenantId, decision.invoiceId)
    const invalid = !operation || operation.status !== 'deactivated'
      || !line || line.status !== 'pending' || line.direction !== 'credit'
      || !invoice || invoice.status !== 'sent' || invoice.total_cents !== line.amount_cents
      || invoice.mollie_payment_link_id !== operation.mollie_payment_link_id
    if (invalid) {
      if (operation) await markMollieReconciliation(client, tenantId, operation.id, 'conflict', 'state_changed')
      await client.query('COMMIT')
      return 'skipped_mollie_reconciliation_conflict'
    }

    const cleared = await clearInvoicePaymentLink(
      client, tenantId, invoice.id, operation.mollie_payment_link_id,
    )
    if (!cleared) {
      await markMollieReconciliation(client, tenantId, operation.id, 'conflict', 'link_changed')
      await client.query('COMMIT')
      return 'skipped_mollie_reconciliation_conflict'
    }
    const status = await postReconciledInvoice(client, tenantId, line, cleared, userId)
    if (status !== 'reconciled_invoice') {
      await client.query('ROLLBACK')
      return status
    }
    await markMollieReconciliation(client, tenantId, operation.id, 'completed')
    await client.query('COMMIT')
    return status
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped?.error.body.code === 'period_closed') return 'skipped_closed_period'
    if (mapped?.error.body.code === 'accounting_not_configured') return 'skipped_accounting_not_configured'
    throw err
  } finally {
    client.release()
  }
}

// Commits one decision in its own transaction. Maps ledger guard errors to skip
// statuses so the rest of the import proceeds.
async function commitLine(db, tenantId, importId, decision, userId) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const imp = await lockImport(client, tenantId, importId)
    if (!imp) { await client.query('ROLLBACK'); return 'skipped_not_found' }
    const line = await lockLine(client, tenantId, importId, decision.lineId)
    if (!line) { await client.query('ROLLBACK'); return 'skipped_not_found' }
    if (line.status !== 'pending') { await client.query('ROLLBACK'); return 'skipped_already_committed' }

    const status = await applyDecision(client, tenantId, line, decision, userId)
    if (status === 'skipped') {
      await markLineResult(client, tenantId, line.id, { status: 'skipped' })
      await client.query('COMMIT')
      return status
    }
    if (status !== 'imported' && status !== 'reconciled_invoice' && status !== 'reconciled_purchase') {
      await client.query('ROLLBACK')
      return status
    }
    await client.query('COMMIT')
    return status
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped?.error.body.code === 'period_closed') return 'skipped_closed_period'
    if (mapped?.error.body.code === 'accounting_not_configured') return 'skipped_accounting_not_configured'
    throw err
  } finally {
    client.release()
  }
}

const SYSTEM_OPTS = (userId) => ({ actorUserId: userId, clampToOpenPeriod: true })

async function applyDecision(client, tenantId, line, decision, userId) {
  switch (decision.action) {
    case 'skip':
      return 'skipped'
    case 'reconcile_invoice':
      return reconcileInvoice(client, tenantId, line, decision, userId)
    case 'reconcile_purchase':
      return reconcilePurchase(client, tenantId, line, decision, userId)
    case 'journal_received':
      return journalLine(client, tenantId, line, decision, userId, 'credit', 'revenue')
    case 'journal_paid':
      return journalLine(client, tenantId, line, decision, userId, 'debit', 'expense')
    default:
      return 'skipped'
  }
}

async function reconcileInvoice(client, tenantId, line, decision, userId) {
  if (line.direction !== 'credit') return 'skipped_direction_mismatch'
  const invoice = await lockInvoice(client, tenantId, decision.invoiceId)
  if (!invoice) return 'skipped_not_found'
  if (invoice.status !== 'sent') return 'skipped_invoice_not_open'
  if (invoice.mollie_payment_link_id != null) return 'skipped_invoice_has_link'
  if (invoice.total_cents !== line.amount_cents) return 'skipped_amount_mismatch'

  return postReconciledInvoice(client, tenantId, line, invoice, userId)
}

// Flips the invoice to paid and posts the paid journal via settleInvoice (the
// invoice-domain owner), then links the statement line to the posted transaction.
async function postReconciledInvoice(client, tenantId, line, invoice, userId) {
  const updated = await markInvoicePaid(client, tenantId, invoice.id)
  if (!updated) return 'skipped_not_found'
  const result = await settleInvoice(client, tenantId, invoice.id, {
    entryDate: line.booking_date, actorUserId: userId, clampToOpenPeriod: true,
  })
  if (result.error) return 'skipped_not_found'
  await markLineResult(client, tenantId, line.id, {
    status: 'reconciled_invoice', ledgerTransactionId: result.posted.transactionId ?? null,
    matchedSourceType: 'invoice', matchedSourceId: invoice.id,
  })
  return 'reconciled_invoice'
}

async function reconcilePurchase(client, tenantId, line, decision, userId) {
  if (line.direction !== 'debit') return 'skipped_direction_mismatch'
  const purchase = await lockPurchase(client, tenantId, decision.purchaseId)
  if (!purchase) return 'skipped_not_found'
  if (purchase.status !== 'approved' || purchase.paid_at != null) return 'skipped_bill_not_open'
  if (purchase.total_cents !== line.amount_cents) return 'skipped_amount_mismatch'

  const result = await settlePurchase(client, tenantId, purchase.id, {
    paidOn: line.booking_date, method: 'bank', registeredByUserId: userId, clampToOpenPeriod: true,
  })
  if (result.error) return 'skipped_not_found'
  await markLineResult(client, tenantId, line.id, {
    status: 'reconciled_purchase', ledgerTransactionId: result.posted.transactionId ?? null,
    matchedSourceType: 'purchase', matchedSourceId: purchase.id,
  })
  return 'reconciled_purchase'
}

// Direct-journal fallback. `expectedDirection` guards against the frontend
// posting an incoming line as an expense (or vice versa); the contra account
// must be of `accountType` (expense/COGS for paid, revenue for received).
async function journalLine(client, tenantId, line, decision, userId, expectedDirection, accountType) {
  if (line.direction !== expectedDirection) return 'skipped_direction_mismatch'

  const code = decision.contraAccountCode
  const okType = accountType === 'expense'
    ? (await accountExistsOfType(client, tenantId, code, 'expense'))
      || (await accountExistsOfType(client, tenantId, code, 'cost_of_goods_sold'))
    : await accountExistsOfType(client, tenantId, code, accountType)
  if (!okType) return 'skipped_invalid_account'

  if (decision.action === 'journal_paid') {
    const supplierStatus = await resolveSupplier(client, tenantId, decision, line)
    if (supplierStatus) return supplierStatus
  }

  const posted = await postBankStatementLine(client, tenantId, {
    id: line.id,
    entryDate: line.booking_date,
    amountCents: line.amount_cents,
    direction: line.direction,
    contraAccountCode: code,
    memo: lineMemo(line),
  }, SYSTEM_OPTS(userId))
  await markLineResult(client, tenantId, line.id, {
    status: 'imported', ledgerTransactionId: posted.transactionId ?? null,
  })
  return 'imported'
}

// Links or creates the supplier for an outgoing line. Persisting the supplier
// (with the counterparty IBAN) is what lets future imports auto-match. Returns a
// skip status on error, or null on success/no-op.
async function resolveSupplier(client, tenantId, decision, line) {
  if (decision.supplierContactId != null) {
    if (!(await contactExistsInTenant(client, decision.supplierContactId, tenantId))) {
      return 'skipped_invalid_supplier'
    }
    return null
  }
  if (!decision.createSupplier) return null
  try {
    await insertContact(client, tenantId, {
      name: decision.createSupplier.name,
      email: null,
      phone: null,
      category: 'supplier',
      iban: normalizeIban(decision.createSupplier.iban ?? line.counterparty_iban),
    })
  } catch (err) {
    // A supplier of that name already exists (UNIQUE lower(name)+category): fine,
    // the goal (a matchable supplier record) is already met.
    if (err.code !== '23505') throw err
  }
  return null
}
