// Finance-onboarding domain logic: the opening-balance status that gates the
// welcome tutorial, and posting a manual opening balance. Posting reuses the
// ledger engine (postOpeningBalance) so all the balance/period-close invariants
// hold; this module only owns the transaction and the error contract. (Tutorial
// dismissal is generic — see server/services/tutorialService.js.)
import { postOpeningBalance, ledgerErrorResult } from './ledgerService.js'
import { hasOpeningBalance } from '../repositories/ledgerRepository.js'

export async function getStatus(db, tenantId) {
  return { openingBalanceSet: await hasOpeningBalance(db, tenantId) }
}

// Posts a manual opening balance in its own transaction. Idempotent per tenant
// (postOpeningBalance keys on the tenant id): a second attempt 409s
// opening_balance_exists. Ledger guard errors (period_closed,
// accounting_not_configured) are mapped to their HTTP shape.
export async function setOpeningBalance(db, tenantId, { signedAmountCents, entryDate }, userId) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await postOpeningBalance(client, tenantId, { signedAmountCents, entryDate }, { actorUserId: userId })
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
