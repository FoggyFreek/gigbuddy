// Journal domain logic — user-entered postings on the band's own ledger. Route
// handlers stay thin and delegate here.
//
// Functions return a discriminated result so the HTTP layer can map outcomes to
// status codes without knowing the rules:
//   { error: { status, body } }   — caller should respond with that status/body
//   anything else                 — success payload (see each function)
//
// Two validation layers, kept separate:
//   - draft normalization (create/PATCH): permissive, persists half-filled rows
//     for autosave; only rejects unknown account codes up front (clean 400).
//   - approve-time posting validation: strict, every line must be postable before
//     anything is written to the immutable ledger.
import {
  fetchJournal,
  fetchJournalLines,
  listJournals as listJournalsRepo,
  createJournal as createJournalRepo,
  updateJournalHeader,
  replaceJournalLines,
  deleteJournal as deleteJournalRepo,
  lockJournalForApprove,
  setApproved,
  fetchActiveAccountCodes,
  fetchExistingAccountCodes,
  findReclassificationByLine,
} from '../repositories/journalRepository.js'
import {
  getTransaction as getLedgerTransaction,
  listLines as listLedgerLines,
  updateTransactionNote,
  getTransactionNote,
  lockTransactionRow,
} from '../repositories/ledgerRepository.js'
import {
  isValidIsoDate,
  normalizeLines,
  findUnpostableLine,
} from '../validators/journalValidators.js'
import { parsePositiveId } from '../validators/common.js'
import { ledgerErrorResult, postUserJournal, firstOpenDate } from './ledgerService.js'
import { classify } from './ledgerEntryTypes.js'
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { badRequest, conflict, notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Not found')
const APPROVED_LOCKED = { status: 409, body: { error: 'Approved journals cannot be edited', code: 'journal_approved' } }
const ALREADY_APPROVED = { status: 409, body: { error: 'Journal already approved', code: 'already_approved' } }

function today() {
  return new Date().toISOString().slice(0, 10)
}

// Notes are free text: trimmed, blank stored as NULL.
function normalizeNote(raw) {
  return typeof raw === 'string' ? (raw.trim() || null) : null
}

// Validates any non-null account/balancing codes against the tenant chart so an
// unknown code is a clean 400 rather than a raw FK violation. Allows inactive
// (still-existing) accounts on a draft.
async function validateDraftCodes(executor, tenantId, lines) {
  const codes = lines.flatMap((l) => [l.account_code, l.balancing_account_code]).filter(Boolean)
  if (!codes.length) return null
  const existing = await fetchExistingAccountCodes(executor, tenantId, codes)
  const bad = codes.find((c) => !existing.has(c))
  if (bad) {
    return { error: { status: 400, body: { error: 'Unknown account_code', code: 'unknown_account_code', account_code: bad } } }
  }
  return null
}

// ---------- reads ----------

export async function listJournals(pool, tenantId) {
  return listJournalsRepo(pool, tenantId)
}

export async function getJournal(pool, tenantId, id) {
  const journal = await fetchJournal(pool, tenantId, id)
  if (!journal) return NOT_FOUND
  // Once approved, the posted ledger transaction owns the canonical note (it
  // stays editable there); the draft's copy is only a pre-approval buffer.
  if (journal.status === 'approved' && journal.posted_transaction_id) {
    journal.note = await getTransactionNote(pool, tenantId, journal.posted_transaction_id)
  }
  const lines = await fetchJournalLines(pool, id, tenantId)
  return { journal: { ...journal, lines } }
}

// ---------- create ----------

export async function createJournal(pool, tenantId, body, actorUserId = null) {
  const entryDate = body.entry_date || today()
  if (!isValidIsoDate(entryDate)) return { error: { status: 400, body: { error: 'Invalid entry_date' } } }

  const lines = normalizeLines(body.lines)
  const codeErr = await validateDraftCodes(pool, tenantId, lines)
  if (codeErr) return codeErr

  return withTransaction(async (client) => {
    const id = await createJournalRepo(client, tenantId, {
      entryDate, description: body.description?.trim() || null,
      createdByUserId: actorUserId, note: normalizeNote(body.note),
    })
    if (lines.length) await replaceJournalLines(client, id, tenantId, lines)
    return { journalId: id }
  }, { db: pool })
}

// ---------- patch (draft only) ----------

export async function updateJournal(pool, tenantId, id, body) {
  const existing = await fetchJournal(pool, tenantId, id)
  if (!existing) return NOT_FOUND
  if (existing.status === 'approved') return { error: APPROVED_LOCKED }

  let entryDate = existing.entry_date
  if ('entry_date' in body) {
    if (!isValidIsoDate(body.entry_date)) return { error: { status: 400, body: { error: 'Invalid entry_date' } } }
    entryDate = body.entry_date
  }

  let lines = null
  if ('lines' in body) {
    lines = normalizeLines(body.lines)
    const codeErr = await validateDraftCodes(pool, tenantId, lines)
    if (codeErr) return codeErr
  }

  return withTransaction(async (client) => {
    await updateJournalHeader(client, tenantId, id, {
      entryDate,
      description: 'description' in body ? (body.description?.trim() || null) : existing.description,
      note: 'note' in body ? normalizeNote(body.note) : existing.note,
    })
    if (lines !== null) await replaceJournalLines(client, id, tenantId, lines)
    return {}
  }, { db: pool })
}

// ---------- delete (draft only) ----------

export async function deleteJournal(pool, tenantId, id) {
  const existing = await fetchJournal(pool, tenantId, id)
  if (!existing) return NOT_FOUND
  if (existing.status === 'approved') return { error: APPROVED_LOCKED }
  await deleteJournalRepo(pool, tenantId, id)
  return {}
}

// ---------- approve (post to ledger) ----------

// Approves a single draft inside its own transaction. Idempotency- and
// race-safe: the row is locked, the status flip is guarded by status='draft',
// and a duplicate ledger post is recovered to its existing transaction id so the
// header always ends up with a real posted_transaction_id.
export async function approveJournal(pool, tenantId, id, actorUserId = null) {
  return withTransaction(async (client) => {
    const journal = await lockJournalForApprove(client, tenantId, id)
    if (!journal) abortTransaction(NOT_FOUND)
    if (journal.status === 'approved') abortTransaction({ error: ALREADY_APPROVED })

    const lines = await fetchJournalLines(client, id, tenantId)
    if (lines.length < 1) {
      abortTransaction({ error: { status: 400, body: { error: 'Journal has no lines', code: 'no_lines' } } })
    }

    const codes = lines.flatMap((l) => [l.account_code, l.balancing_account_code]).filter(Boolean)
    const activeCodes = await fetchActiveAccountCodes(client, tenantId, codes)
    const bad = findUnpostableLine(lines, activeCodes)
    if (bad) {
      abortTransaction({ error: { status: 400, body: { error: `Line ${bad.index} is not postable (${bad.reason})`, code: bad.code, line: bad.index } } })
    }

    // A ledger-post failure (unbalanced / closed period / misconfigured) is
    // translated by mapError below into its HTTP shape after the rollback.
    const result = await postUserJournal(client, tenantId, journal, lines, { actorUserId })

    // postJournal returns { posted: false } if this (source_type, source_id,
    // source_event) was already posted (double-click / retry). Recover the
    // existing transaction id so setApproved always gets a real value.
    let transactionId = result.transactionId
    if (!transactionId) {
      const { rows } = await client.query(
        `SELECT id FROM ledger_transactions
          WHERE tenant_id = $1 AND source_type = 'journal' AND source_id = $2 AND source_event = 'posted'`,
        [tenantId, id],
      )
      transactionId = rows[0]?.id
    }
    if (!transactionId) {
      abortTransaction({ error: { status: 500, body: { error: 'Failed to post journal' } } })
    }

    const updated = await setApproved(client, tenantId, id, transactionId, actorUserId)
    if (!updated) abortTransaction({ error: ALREADY_APPROVED })

    // Carry the draft note onto the posted transaction, which is the canonical,
    // still-editable copy from here on.
    if (journal.note != null) {
      await updateTransactionNote(client, tenantId, transactionId, journal.note, actorUserId)
    }

    return { journal: updated }
  }, {
    db: pool,
    mapError: (err) => {
      const mapped = ledgerErrorResult(err)
      if (mapped) return mapped
      if (err.message?.startsWith('ledger:')) {
        return { error: { status: 400, body: { error: err.message, code: 'unbalanced_journal' } } }
      }
      return null
    },
  })
}

// ---------- reclassification (immediately posted journal moving one posted ledger line) ----------

function alreadyReclassified(existing) {
  return conflict('This ledger line has already been reclassified', {
    code: 'already_reclassified',
    journal_id: existing?.id ?? null,
    journal_status: existing?.status ?? null,
    posted_transaction_id: existing?.posted_transaction_id ?? null,
  })
}

// Voided/reversed originals and correction entries keep their notes but can't
// start a reclassification — their amounts are already compensated.
function isReclassifiable(txn) {
  return !classify(txn.source_type, txn.source_event).voided
    && txn.voided_at == null
    && txn.reversed_by_transaction_id == null
    && txn.source_event !== 'reversal'
    && txn.source_type !== 'ledger_transaction'
}

// Moves one complete posted ledger line to another account: reverse the amount
// on the source account, post the same side/amount on the destination. Gross,
// no VAT split — this changes account allocation only. Amounts and direction
// are re-read from the ledger, never taken from the request.
//
// The journal is created AND posted in one transaction — deliberately no draft
// phase: a pending draft could be edited into an unrelated posting, and a
// correction of the source transaction could invalidate it before approval.
// The state checks and the posting here are atomic instead.
export async function createReclassification(pool, tenantId, transactionId, body, actorUserId = null) {
  const sourceLineId = parsePositiveId(body.source_line_id)
  if (sourceLineId === null) return badRequest('Invalid source_line_id')
  const destination = typeof body.destination_account_code === 'string'
    ? body.destination_account_code.trim() : ''
  if (!destination) return badRequest('Invalid destination account', { code: 'invalid_destination_account' })
  if (body.note != null && typeof body.note !== 'string') return badRequest('Invalid note')

  const result = await withTransaction(async (client) => {
    // Same row lock as the correction flows (void/reverse), so "is this
    // transaction still uncorrected?" can't race a concurrent correction.
    if (!(await lockTransactionRow(client, tenantId, transactionId))) abortTransaction(NOT_FOUND)
    const txn = await getLedgerTransaction(client, tenantId, transactionId)
    if (!txn) abortTransaction(NOT_FOUND)
    if (!isReclassifiable(txn)) {
      abortTransaction(conflict('Voided, reversed, and correction entries cannot be reclassified', { code: 'not_reclassifiable' }))
    }

    const source = (await listLedgerLines(client, tenantId, transactionId))
      .find((l) => l.id === sourceLineId)
    if (!source) {
      abortTransaction(badRequest('Source line does not belong to this transaction', { code: 'invalid_source_line' }))
    }
    if (source.account_code === destination) {
      abortTransaction(badRequest('Destination equals the source account', { code: 'same_account' }))
    }
    const activeCodes = await fetchActiveAccountCodes(client, tenantId, [destination])
    if (!activeCodes.has(destination)) {
      abortTransaction(badRequest('Unknown or inactive destination account', { code: 'invalid_destination_account' }))
    }
    const existing = await findReclassificationByLine(client, tenantId, sourceLineId)
    if (existing) abortTransaction(alreadyReclassified(existing))

    const side = source.debit_cents > 0 ? 'debit' : 'credit'
    const amount = source.debit_cents > 0 ? source.debit_cents : source.credit_cents
    // Prefer the original booking date; a closed period moves the posting to
    // the first open day (same policy as external postings).
    const entryDate = await firstOpenDate(client, tenantId, txn.entry_date)
    const description = `Reclassification of ledger entry #${transactionId}`
    const note = normalizeNote(body.note)

    const journalId = await createJournalRepo(client, tenantId, {
      entryDate,
      description,
      createdByUserId: actorUserId,
      note,
      reclassifiesLedgerEntryId: sourceLineId,
    })
    const lines = [
      {
        position: 0, description: null, account_code: source.account_code, vat_rate: 0,
        side: side === 'debit' ? 'credit' : 'debit', amount_cents: amount, balancing_account_code: null,
      },
      {
        position: 1, description: null, account_code: destination, vat_rate: 0,
        side, amount_cents: amount, balancing_account_code: null,
      },
    ]
    await replaceJournalLines(client, journalId, tenantId, lines)

    // Post and approve immediately. The journal id is fresh, so the ledger's
    // idempotency key can't collide and the post always writes.
    const posted = await postUserJournal(
      client, tenantId, { id: journalId, entry_date: entryDate, description }, lines, { actorUserId },
    )
    await setApproved(client, tenantId, journalId, posted.transactionId, actorUserId)
    if (note != null) {
      await updateTransactionNote(client, tenantId, posted.transactionId, note, actorUserId)
    }
    return { journalId }
  }, {
    db: pool,
    // Concurrent duplicate: the partial unique index is the backstop; report
    // the winner's reference like the pre-check does. Ledger guard errors
    // (period close etc.) keep their standard HTTP shape.
    mapError: async (err) => {
      const mapped = ledgerErrorResult(err)
      if (mapped) return mapped
      if (err.code === '23505' && err.constraint === 'journals_reclassifies_unique') {
        return alreadyReclassified(await findReclassificationByLine(pool, tenantId, sourceLineId))
      }
      return null
    },
  })
  if (result.error) return result
  return getJournal(pool, tenantId, result.journalId)
}

// Approves multiple drafts (powers "Approve all"). De-duplicates ids; each is its
// own transaction so one bad entry doesn't sink the batch. Reports per-id results.
export async function approveMany(pool, tenantId, ids, actorUserId = null) {
  const unique = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  const results = []
  for (const id of unique) {
    const r = await approveJournal(pool, tenantId, id, actorUserId)
    results.push(r.error ? { id, ok: false, ...r.error.body } : { id, ok: true })
  }
  return { results }
}
