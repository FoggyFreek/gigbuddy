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
} from '../repositories/journalRepository.js'
import {
  isValidIsoDate,
  normalizeLines,
  findUnpostableLine,
} from '../validators/journalValidators.js'
import { ledgerErrorResult, postUserJournal } from './ledgerService.js'

const NOT_FOUND = { status: 404, body: { error: 'Not found' } }
const APPROVED_LOCKED = { status: 409, body: { error: 'Approved journals cannot be edited', code: 'journal_approved' } }
const ALREADY_APPROVED = { status: 409, body: { error: 'Journal already approved', code: 'already_approved' } }

function today() {
  return new Date().toISOString().slice(0, 10)
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
  if (!journal) return { error: NOT_FOUND }
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

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const id = await createJournalRepo(client, tenantId, {
      entryDate, description: body.description?.trim() || null,
      createdByUserId: actorUserId,
    })
    if (lines.length) await replaceJournalLines(client, id, tenantId, lines)
    await client.query('COMMIT')
    return { journalId: id }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// ---------- patch (draft only) ----------

export async function updateJournal(pool, tenantId, id, body) {
  const existing = await fetchJournal(pool, tenantId, id)
  if (!existing) return { error: NOT_FOUND }
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

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await updateJournalHeader(client, tenantId, id, {
      entryDate,
      description: 'description' in body ? (body.description?.trim() || null) : existing.description,
    })
    if (lines !== null) await replaceJournalLines(client, id, tenantId, lines)
    await client.query('COMMIT')
    return {}
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// ---------- delete (draft only) ----------

export async function deleteJournal(pool, tenantId, id) {
  const existing = await fetchJournal(pool, tenantId, id)
  if (!existing) return { error: NOT_FOUND }
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
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const journal = await lockJournalForApprove(client, tenantId, id)
    if (!journal) { await client.query('ROLLBACK'); return { error: NOT_FOUND } }
    if (journal.status === 'approved') { await client.query('ROLLBACK'); return { error: ALREADY_APPROVED } }

    const lines = await fetchJournalLines(client, id, tenantId)
    if (lines.length < 1) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'Journal has no lines', code: 'no_lines' } } }
    }

    const codes = lines.flatMap((l) => [l.account_code, l.balancing_account_code]).filter(Boolean)
    const activeCodes = await fetchActiveAccountCodes(client, tenantId, codes)
    const bad = findUnpostableLine(lines, activeCodes)
    if (bad) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: `Line ${bad.index} is not postable (${bad.reason})`, code: bad.code, line: bad.index } } }
    }

    let result
    try {
      result = await postUserJournal(client, tenantId, journal, lines, { actorUserId })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      const mapped = ledgerErrorResult(err)
      if (mapped) return mapped
      if (err.message?.startsWith('ledger:')) {
        return { error: { status: 400, body: { error: err.message, code: 'unbalanced_journal' } } }
      }
      throw err
    }

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
      await client.query('ROLLBACK')
      return { error: { status: 500, body: { error: 'Failed to post journal' } } }
    }

    const updated = await setApproved(client, tenantId, id, transactionId, actorUserId)
    if (!updated) { await client.query('ROLLBACK'); return { error: ALREADY_APPROVED } }

    await client.query('COMMIT')
    return { journal: updated }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
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
