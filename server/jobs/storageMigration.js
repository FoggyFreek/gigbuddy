import pool from '../db/index.js'
import {
  claimNextMigration,
  failMigration,
  heartbeatMigration,
} from '../repositories/storageMigrationRepository.js'
import {
  runCopy,
  runInventory,
  runRustfsDelete,
  runValidation,
} from '../services/storageMigrationService.js'
import { logger } from '../utils/logger.js'

const TICK_MS = 5_000

const ACTIONS = {
  inventory: runInventory,
  copy: runCopy,
  validate: runValidation,
  delete_rustfs: runRustfsDelete,
}

const FAILURE_STATES = {
  inventory: 'inventory_failed',
  copy: 'copy_failed',
  validate: 'validation_failed',
  delete_rustfs: 'delete_failed',
}

function safeErrorCode(err) {
  return typeof err?.code === 'string' && /^[a-z0-9_]+$/.test(err.code)
    ? err.code
    : 'operation_failed'
}

export async function runStorageMigrationTick() {
  const job = await claimNextMigration(pool)
  if (!job) return false
  const heartbeat = setInterval(() => {
    heartbeatMigration(pool, job.tenant_id)
      .catch((err) => logger.error('storage_migration.heartbeat_failed', {
        err, tenantId: job.tenant_id, jobName: job.requested_action,
      }))
  }, 30_000)
  heartbeat.unref()
  try {
    await ACTIONS[job.requested_action](job.tenant_id)
  } catch (err) {
    await failMigration(
      pool,
      job.tenant_id,
      FAILURE_STATES[job.requested_action],
      safeErrorCode(err),
    )
    logger.error('storage_migration.failed', {
      err,
      tenantId: job.tenant_id,
      jobName: job.requested_action,
    })
  } finally {
    clearInterval(heartbeat)
  }
  return true
}

let timer = null

export function startStorageMigrationWorker() {
  if (process.env.NODE_ENV === 'test' || process.env.STORAGE_MIGRATION_WORKER_DISABLED === 'true') return
  if (timer) return
  const tick = () => runStorageMigrationTick()
    .catch((err) => logger.error('storage_migration.tick_failed', { err, jobName: 'tick' }))
  timer = setInterval(tick, TICK_MS)
  timer.unref()
}
