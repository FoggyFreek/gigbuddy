import { limitedCollection } from '../../platform/collections/limitedCollectionService.js'
import {
  fetchOperationsSummary,
  listBillingOperationAlerts as listBillingOperationRows,
  listStatusDriftAlerts as listStatusDriftRows,
  listUnresolvedWebhookFailures as listWebhookFailureRows,
} from './adminOperationRepository.js'

function summaryRow(row) {
  return {
    terminalOperations: row.terminal_operations,
    retryingOperations: row.retrying_operations,
    pendingOperations: row.pending_operations,
    oldestPendingAt: row.oldest_pending_at,
    unresolvedWebhookFailures: row.unresolved_webhook_failures,
    statusDrift: row.status_drift,
  }
}

function operationRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    subscriptionId: row.subscription_id,
    userName: row.user_name,
    userEmail: row.user_email,
    opType: row.op_type,
    status: row.status,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function webhookRow(row) {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    userName: row.user_name,
    userEmail: row.user_email,
    providerPaymentId: row.provider_payment_id,
    errorCode: row.error_code,
    receivedAt: row.received_at,
  }
}

function driftRow(row) {
  return {
    subscriptionId: row.subscription_id,
    userName: row.user_name,
    userEmail: row.user_email,
    subscriptionStatus: row.subscription_status,
    scheduleStale: row.mollie_schedule_stale,
    repairNeeded: row.billing_repair_needed,
    paymentId: row.mollie_payment_id,
    paymentStatus: row.payment_status,
    paymentUpdatedAt: row.payment_updated_at,
    stalePayment: row.stale_payment,
  }
}

export async function getOperationsSummary(db) {
  return summaryRow(await fetchOperationsSummary(db))
}

export async function listBillingOperationAlerts(db, query = {}) {
  const result = await limitedCollection(query.limit, (limit) => listBillingOperationRows(db, limit))
  return result.error ? result : { ...result, items: result.items.map(operationRow) }
}

export async function listWebhookFailureAlerts(db, query = {}) {
  const result = await limitedCollection(query.limit, (limit) => listWebhookFailureRows(db, limit))
  return result.error ? result : { ...result, items: result.items.map(webhookRow) }
}

export async function listStatusDriftAlerts(db, query = {}) {
  const result = await limitedCollection(query.limit, (limit) => listStatusDriftRows(db, limit))
  return result.error ? result : { ...result, items: result.items.map(driftRow) }
}
