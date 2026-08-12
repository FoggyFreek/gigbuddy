import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import {
  postPaypalPayoutSettlement,
  ledgerErrorResult,
} from './ledgerService.js'
import {
  insertPaypalPayoutReconciliation,
  linkPaypalReconciliationOrders,
  listManualPaypalPayoutCandidates,
  lockUnreconciledPaypalOrders,
  markPaypalReconciliationPosted,
} from '../../commerce/merch/shopifyPaymentsRepository.js'
import { accountExistsOfType } from '../accounts/accountRepository.js'
import { parseListLimit } from '../../platform/http/requestValidators.js'
import { validateCustomPaypalPayout } from './paypalPayoutValidators.js'
import { badRequest, notFound } from '../../platform/http/serviceErrors.js'

export async function listPaypalPayoutCandidates(db, tenantId, rawLimit = 100) {
  const limit = parseListLimit(rawLimit)
  if (limit === null) return badRequest('limit must be between 1 and 100', { code: 'invalid_limit' })
  const rows = await listManualPaypalPayoutCandidates(db, tenantId, limit)
  return {
    items: rows.map((row) => ({
      id: row.id,
      order_name: row.order_name,
      shopify_order_id: row.shopify_order_legacy_id,
      processed_at: row.processed_at,
      currency: row.currency,
      gross_cents: row.gross_cents,
    })),
    meta: { limit },
  }
}

async function validDifferenceAccount(client, tenantId, accountCode) {
  return (await accountExistsOfType(client, tenantId, accountCode, 'revenue'))
    || (await accountExistsOfType(client, tenantId, accountCode, 'expense'))
    || (await accountExistsOfType(client, tenantId, accountCode, 'cost_of_goods_sold'))
}

export async function postPaypalSettlementInTransaction(
  client, tenantId, data, actorUserId = null,
) {
  const requestedIds = [...new Set(data.orderFinancialIds)]
  const orders = await lockUnreconciledPaypalOrders(client, tenantId, requestedIds)
  if (!requestedIds.length || orders.length !== requestedIds.length) return { code: 'not_found' }

  const currencies = new Set(orders.map((order) => order.currency))
  if (currencies.size !== 1 || (data.currency && !currencies.has(data.currency))) {
    return { code: 'currency_mismatch' }
  }
  const grossCents = orders.reduce((sum, order) => sum + order.gross_cents, 0)
  const differenceCents = grossCents - data.depositCents
  let differenceAccountCode = null
  if (differenceCents !== 0) {
    differenceAccountCode = data.differenceAccountCode
    if (!differenceAccountCode) return { code: 'mapping_required' }
    if (!(await validDifferenceAccount(client, tenantId, differenceAccountCode))) {
      return { code: 'invalid_account' }
    }
  }

  const reconciliation = await insertPaypalPayoutReconciliation(client, tenantId, {
    bankStatementLineId: data.bankStatementLineId ?? null,
    reference: data.reference ?? null,
    currency: orders[0].currency,
    grossCents,
    depositCents: data.depositCents,
    differenceCents,
    differenceAccountCode,
    actorUserId,
  })
  await linkPaypalReconciliationOrders(
    client, tenantId, reconciliation.id, orders.map((order) => order.id),
  )
  const posted = await postPaypalPayoutSettlement(client, tenantId, {
    id: reconciliation.id,
    reference: data.reference ?? null,
    grossCents,
    depositCents: data.depositCents,
    differenceCents,
    differenceAccountCode,
    entryDate: data.entryDate,
  }, { actorUserId, clampToOpenPeriod: true })
  const settled = await markPaypalReconciliationPosted(
    client, tenantId, reconciliation.id, {
      ledgerTransactionId: posted.transactionId,
      settlementMethod: data.settlementMethod,
      entryDate: data.entryDate,
      actorUserId,
    },
  )
  return { reconciliation: settled }
}

function customSettlementError(code) {
  if (code === 'not_found') return notFound('PayPal order not found')
  if (code === 'currency_mismatch') {
    return badRequest('PayPal orders must use one currency', { code: 'paypal_payout_currency_mismatch' })
  }
  if (code === 'mapping_required') {
    return badRequest('Select a PayPal fee or adjustment account', {
      code: 'paypal_payout_mapping_required',
    })
  }
  return badRequest('Invalid PayPal payout adjustment account', { code: 'invalid_account' })
}

export async function createCustomPaypalPayout(db, tenantId, body, actorUserId = null) {
  const validated = validateCustomPaypalPayout(body)
  if (validated.error) return badRequest(validated.error, { code: 'invalid_custom_paypal_payout' })
  return withTransaction(async (client) => {
    const result = await postPaypalSettlementInTransaction(client, tenantId, {
      ...validated.value,
      settlementMethod: 'manual',
    }, actorUserId)
    if (result.code) abortTransaction(customSettlementError(result.code))
    return result
  }, { db, mapError: ledgerErrorResult })
}
