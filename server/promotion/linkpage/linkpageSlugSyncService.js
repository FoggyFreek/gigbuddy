import {
  fetchEligibleSlugSyncOperation,
  listDueSlugSyncOperations,
  markSlugSyncCompleted,
  purgeCompletedSlugSyncOperations,
  scheduleSlugSyncRetry,
} from './linkpageSlugSyncRepository.js'
import { deliverLinkpageSlugOperation } from './linkpageSlugClient.js'
import { logger } from '../../utils/logger.js'

const BASE_RETRY_MS = 30 * 1000
const MAX_RETRY_MS = 6 * 60 * 60 * 1000
const ALERT_ATTEMPTS = 5
const COMPLETED_RETENTION_DAYS = 30

export function slugSyncRetryDelay(attemptCount) {
  return Math.min(BASE_RETRY_MS * (2 ** Math.min(attemptCount, 10)), MAX_RETRY_MS)
}

export async function attemptLinkpageSlugSync(db, operation, {
  deliver = deliverLinkpageSlugOperation,
} = {}) {
  let outcome
  try {
    outcome = await deliver(operation)
  } catch {
    outcome = { ok: false, code: 'client_error' }
  }

  if (outcome.ok) {
    const completed = await markSlugSyncCompleted(db, operation.id)
    if (completed) {
      logger.info('linkpage.slug_sync_completed', {
        operationId: completed.id,
        tenantId: completed.tenant_id,
        revision: Number(completed.slug_revision),
        attemptCount: completed.attempt_count,
        status: outcome.code,
      })
    }
    return { sync: 'synced', code: outcome.code }
  }

  const retried = await scheduleSlugSyncRetry(
    db,
    operation.id,
    outcome.code,
    slugSyncRetryDelay(operation.attempt_count),
  )
  if (retried) {
    const log = retried.attempt_count >= ALERT_ATTEMPTS ? 'error' : 'warn'
    logger[log]('linkpage.slug_sync_failed', {
      operationId: retried.id,
      tenantId: retried.tenant_id,
      revision: Number(retried.slug_revision),
      attemptCount: retried.attempt_count,
      errorCode: outcome.code,
    })
  }
  return { sync: 'pending', code: outcome.code }
}

export async function attemptEligibleLinkpageSlugSync(db, operationId, options) {
  const operation = await fetchEligibleSlugSyncOperation(db, operationId)
  if (!operation) return { sync: 'pending', code: 'earlier_revision_pending' }
  return attemptLinkpageSlugSync(db, operation, options)
}

export async function reconcileLinkpageSlugSync(db, {
  deliver = deliverLinkpageSlugOperation,
  limit = 50,
} = {}) {
  let processed = 0
  while (processed < limit) {
    const operations = await listDueSlugSyncOperations(db, limit - processed)
    if (operations.length === 0) break
    for (const operation of operations) {
      try {
        await attemptLinkpageSlugSync(db, operation, { deliver })
      } catch (err) {
        logger.error('linkpage.slug_sync_reconcile_failed', {
          err,
          operationId: operation.id,
          tenantId: operation.tenant_id,
          revision: Number(operation.slug_revision),
          attemptCount: operation.attempt_count,
        })
      }
    }
    processed += operations.length
  }
  const purged = await purgeCompletedSlugSyncOperations(db, COMPLETED_RETENTION_DAYS)
  return { processed, purged }
}
