import pool from '../../../db/index.js'
import { reconcileLinkpageSlugSync } from '../linkpageSlugSyncService.js'
import { logger } from '../../../utils/logger.js'

const TICK_INTERVAL_MS = 30 * 1000
const FIRST_TICK_DELAY_MS = 10 * 1000

export async function runLinkpageSlugReconciliationTick({
  db = pool,
  reconcile = reconcileLinkpageSlugSync,
} = {}) {
  const client = await db.connect()
  let locked = false
  try {
    const { rows: [row] } = await client.query(
      "SELECT pg_try_advisory_lock(hashtext('linkpage_slug_reconciliation')) AS locked",
    )
    locked = row.locked
    if (!locked) return false

    await reconcile(db)
    return true
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext('linkpage_slug_reconciliation'))")
        .catch((err) => logger.error('linkpage.slug_sync_unlock_failed', { err }))
    }
    client.release()
  }
}

let timer = null

export function startLinkpageSlugReconciliation() {
  if (process.env.NODE_ENV === 'test' || process.env.LINKPAGE_SCHEDULER_DISABLED) return
  if (timer) return
  const tick = () => runLinkpageSlugReconciliationTick()
    .catch((err) => logger.error('linkpage.slug_sync_tick_failed', { err }))
  setTimeout(tick, FIRST_TICK_DELAY_MS).unref()
  timer = setInterval(tick, TICK_INTERVAL_MS)
  timer.unref()
}
