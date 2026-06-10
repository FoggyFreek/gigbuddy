// Reimbursement domain logic. Route handlers stay thin and delegate here.
//
// Functions return a discriminated result so the HTTP layer can map outcomes
// to status codes without knowing the rules:
//   { error: { status, body } }   — caller should respond with that status/body
//   anything else                 — success payload (see each function)
import { parseId, isValidIsoDate } from '../validators/journalValidators.js'
import { validateBandMemberForTenant } from '../repositories/purchaseRepository.js'
import {
  fetchOutstandingByMember,
  fetchOutstandingPurchases,
  insertReimbursement,
  settlePurchases,
} from '../repositories/reimbursementRepository.js'
import {
  AccountingNotConfiguredError,
  postReimbursementPaid,
} from './ledgerService.js'

// Sentinel thrown inside the transaction when a concurrent settlement claimed a
// purchase first, so the whole reimbursement rolls back.
const RACE_CONFLICT = 'purchase_not_outstanding'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function notOutstanding() {
  return {
    error: {
      status: 409,
      body: {
        error: 'One or more purchases are not outstanding for this member',
        code: 'purchase_not_outstanding',
      },
    },
  }
}

export async function listOutstanding(pool, tenantId) {
  return { items: await fetchOutstandingByMember(pool, tenantId) }
}

export async function listMemberOutstandingPurchases(pool, tenantId, bandMemberId) {
  const member = await validateBandMemberForTenant(pool, bandMemberId, tenantId)
  if (member === null) return { error: { status: 404, body: { error: 'Not found' } } }
  return { items: await fetchOutstandingPurchases(pool, tenantId, member.id) }
}

// Registers a reimbursement that settles the selected member-paid purchases and
// posts DR reimbursement liability / CR checking for their summed total. The
// insert, settlement, and journal all happen in one transaction.
export async function createReimbursement(pool, tenantId, body) {
  const member = await validateBandMemberForTenant(pool, body.band_member_id, tenantId)
  if (member === null) {
    return { error: { status: 400, body: { error: 'Invalid band_member_id', code: 'invalid_band_member' } } }
  }

  const rawIds = Array.isArray(body.purchase_ids) ? body.purchase_ids : []
  const ids = rawIds.map(parseId)
  if (!ids.length || ids.some((id) => id === null)) {
    return { error: { status: 400, body: { error: 'Select at least one purchase', code: 'no_purchases_selected' } } }
  }
  const uniqueIds = [...new Set(ids)]

  const paidOn = body.paid_on ?? today()
  if (!isValidIsoDate(paidOn)) {
    return { error: { status: 400, body: { error: 'Invalid paid_on', code: 'invalid_date' } } }
  }

  // Every selected id must be outstanding for THIS member (same member, unsettled,
  // paid, member-method). Anything else — another member's, already settled, or
  // bank-paid — is rejected before we touch the ledger.
  const outstanding = await fetchOutstandingPurchases(pool, tenantId, member.id)
  const byId = new Map(outstanding.map((p) => [p.id, p]))
  const selected = uniqueIds.map((id) => byId.get(id))
  if (selected.some((p) => !p)) return notOutstanding()
  const amountCents = selected.reduce((sum, p) => sum + p.total_cents, 0)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const reimbursement = await insertReimbursement(client, tenantId, {
      band_member_id: member.id,
      amount_cents: amountCents,
      paid_on: paidOn,
      memo: body.memo ?? null,
    })
    const claimed = await settlePurchases(client, tenantId, reimbursement.id, uniqueIds)
    if (claimed !== uniqueIds.length) {
      const conflict = new Error(RACE_CONFLICT)
      conflict.code = RACE_CONFLICT
      throw conflict
    }
    await postReimbursementPaid(client, tenantId, reimbursement)
    await client.query('COMMIT')
    return { reimbursement }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err instanceof AccountingNotConfiguredError) {
      return { error: { status: err.status, body: { error: err.message, code: err.code, field: err.field } } }
    }
    if (err.code === RACE_CONFLICT) return notOutstanding()
    throw err
  } finally {
    client.release()
  }
}

// Reimburses a member's entire outstanding balance in one go.
export async function reimburseMemberFull(pool, tenantId, bandMemberId, body = {}) {
  const member = await validateBandMemberForTenant(pool, bandMemberId, tenantId)
  if (member === null) return { error: { status: 404, body: { error: 'Not found' } } }

  const outstanding = await fetchOutstandingPurchases(pool, tenantId, member.id)
  if (!outstanding.length) {
    return { error: { status: 409, body: { error: 'Nothing outstanding for this member', code: 'nothing_outstanding' } } }
  }

  return createReimbursement(pool, tenantId, {
    band_member_id: member.id,
    purchase_ids: outstanding.map((p) => p.id),
    paid_on: body.paid_on,
    memo: body.memo,
  })
}
