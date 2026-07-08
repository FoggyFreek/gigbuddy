// Billing reconciliation job. Grows with the billing phases; today it drains
// the storage cleanup queue (failed/orphaned uploads and future purge keys).
//
// Concurrency: multiple app instances may run this on the same interval, so a
// tick first takes a session-level advisory lock ON ONE CHECKED-OUT CLIENT and
// skips if another instance holds it. The lock is released on that same client
// in `finally` — session advisory locks belong to the connection, so lock and
// unlock must never go through the pool separately.
import pool from '../db/index.js'
import { removeObject } from '../services/storageService.js'
import { refreshTenantStorage } from '../services/statisticsService.js'
import {
  listCleanupQueue,
  deleteCleanupRow,
  bumpCleanupAttempts,
} from '../repositories/storageCleanupRepository.js'
import { BILLING_TASKS } from './billingTasks.js'
import { logger } from '../utils/logger.js'

const TICK_INTERVAL_MS = 15 * 60 * 1000
const FIRST_TICK_DELAY_MS = 30 * 1000
const CLEANUP_ALERT_ATTEMPTS = 5

// Deletes each queued object with an AWAITED remove (never the fire-and-forget
// safeRemove — the row may only disappear once the object is confirmed gone).
// A row with release_reservation had its usage reserved by a failed upload;
// once the object is confirmed absent, a full recompute reconciles the meter.
async function drainStorageCleanupQueue(client) {
  const rows = await listCleanupQueue(client)
  for (const row of rows) {
    try {
      await removeObject(row.object_key)
      await deleteCleanupRow(client, row.id)
      if (row.release_reservation) {
        await refreshTenantStorage(row.tenant_id)
      }
    } catch (err) {
      const attempts = await bumpCleanupAttempts(client, row.id)
      const log = attempts > CLEANUP_ALERT_ATTEMPTS ? 'error' : 'warn'
      logger[log]('billing.cleanup_drain_failed', { err, tenantId: row.tenant_id, jobName: 'storage_cleanup' })
    }
  }
}

// One reconciliation pass. Exported for tests; the scheduler calls it on an
// interval. Every task gets its own try/catch so one failure never starves
// the others.
export async function runReconciliationTick() {
  const client = await pool.connect()
  let locked = false
  try {
    const { rows: [row] } = await client.query(
      "SELECT pg_try_advisory_lock(hashtext('billing_reconciliation')) AS locked",
    )
    locked = row.locked
    if (!locked) return false

    logger.info('billing.reconcile', { jobName: 'tick' })
    // Each task is isolated: one failure never starves the others.
    for (const [jobName, task] of BILLING_TASKS) {
      try {
        await task()
      } catch (err) {
        logger.error('billing.reconcile_task_failed', { err, jobName })
      }
    }
    try {
      await drainStorageCleanupQueue(client)
    } catch (err) {
      logger.error('billing.reconcile_task_failed', { err, jobName: 'storage_cleanup' })
    }
    return true
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext('billing_reconciliation'))")
        .catch((err) => logger.error('billing.reconcile_unlock_failed', { err }))
    }
    client.release()
  }
}

let timer = null

export function startBillingReconciliation() {
  if (process.env.NODE_ENV === 'test' || process.env.BILLING_SCHEDULER_DISABLED) return
  if (timer) return
  const tick = () =>
    runReconciliationTick().catch((err) => logger.error('billing.reconcile_failed', { err }))
  setTimeout(tick, FIRST_TICK_DELAY_MS).unref()
  timer = setInterval(tick, TICK_INTERVAL_MS)
  timer.unref()
}
