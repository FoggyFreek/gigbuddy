import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { insertSlugSyncOperation } from '../../../server/repositories/linkpageSlugSyncRepository.js'
import { reconcileLinkpageSlugSync } from '../../../server/services/linkpageSlugSyncService.js'
import { runLinkpageSlugReconciliationTick } from '../../../server/jobs/linkpageSlugReconciliation.js'

let pool, runMigrations, truncateAll, seedTwoTenants
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => pool.end())

const addOperation = (tenantId, revision, oldSlug, newSlug) => insertSlugSyncOperation(pool, {
  tenantId, slugRevision: revision, oldSlug, newSlug,
})

describe('LinkBuddy slug synchronization worker', () => {
  it('processes multiple tenants but never delivers a later tenant revision first', async () => {
    const a1 = await addOperation(seed.tenantA.id, 1, 'alpha', 'alpha-one')
    const a2 = await addOperation(seed.tenantA.id, 2, 'alpha-one', 'alpha-two')
    const b1 = await addOperation(seed.tenantB.id, 1, 'beta', 'beta-one')
    const delivered = []
    const deliver = vi.fn(async (operation) => {
      delivered.push(operation.id)
      return { ok: true, code: 'applied' }
    })

    await expect(reconcileLinkpageSlugSync(pool, { deliver })).resolves.toEqual({ processed: 3, purged: 0 })
    expect(delivered).toEqual([a1.id, b1.id, a2.id])
  })

  it('backs off retryable conflicts and accepts duplicate delivery outcomes', async () => {
    const operation = await addOperation(seed.tenantA.id, 1, 'alpha', 'alpha-one')
    const conflict = vi.fn().mockResolvedValue({ ok: false, code: 'slug_conflict' })

    await reconcileLinkpageSlugSync(pool, { deliver: conflict })
    const { rows: [retried] } = await pool.query(
      `SELECT status, attempt_count, last_error_code,
              next_attempt_at > NOW() AS backed_off
         FROM linkpage_slug_sync_operations WHERE id = $1`,
      [operation.id],
    )
    expect(retried).toEqual({
      status: 'pending', attempt_count: 1, last_error_code: 'slug_conflict', backed_off: true,
    })

    await pool.query(
      'UPDATE linkpage_slug_sync_operations SET next_attempt_at = NOW() WHERE id = $1',
      [operation.id],
    )
    await reconcileLinkpageSlugSync(pool, {
      deliver: vi.fn().mockResolvedValue({ ok: true, code: 'already_applied' }),
    })
    const { rows: [completed] } = await pool.query(
      'SELECT status, attempt_count, last_error_code, completed_at IS NOT NULL AS completed FROM linkpage_slug_sync_operations WHERE id = $1',
      [operation.id],
    )
    expect(completed).toEqual({
      status: 'completed', attempt_count: 2, last_error_code: null, completed: true,
    })
  })

  it('purges completed operations only after the diagnostic retention window', async () => {
    const old = await addOperation(seed.tenantA.id, 1, 'alpha', 'alpha-one')
    const recent = await addOperation(seed.tenantA.id, 2, 'alpha-one', 'alpha-two')
    await pool.query(
      `UPDATE linkpage_slug_sync_operations
          SET status = 'completed', completed_at = NOW() - INTERVAL '31 days'
        WHERE id = $1`,
      [old.id],
    )
    await pool.query(
      `UPDATE linkpage_slug_sync_operations
          SET status = 'completed', completed_at = NOW()
        WHERE id = $1`,
      [recent.id],
    )

    await expect(reconcileLinkpageSlugSync(pool, { deliver: vi.fn() }))
      .resolves.toEqual({ processed: 0, purged: 1 })
    const { rows } = await pool.query('SELECT id FROM linkpage_slug_sync_operations ORDER BY id')
    expect(rows).toEqual([{ id: recent.id }])
  })

  it('uses a session advisory lock so only one application instance reconciles', async () => {
    const blocker = await pool.connect()
    const reconcile = vi.fn().mockResolvedValue({ processed: 0, purged: 0 })
    try {
      await blocker.query("SELECT pg_advisory_lock(hashtext('linkpage_slug_reconciliation'))")
      await expect(runLinkpageSlugReconciliationTick({ db: pool, reconcile })).resolves.toBe(false)
      expect(reconcile).not.toHaveBeenCalled()
      await blocker.query("SELECT pg_advisory_unlock(hashtext('linkpage_slug_reconciliation'))")

      await expect(runLinkpageSlugReconciliationTick({ db: pool, reconcile })).resolves.toBe(true)
      expect(reconcile).toHaveBeenCalledWith(pool)
    } finally {
      await blocker.query("SELECT pg_advisory_unlock(hashtext('linkpage_slug_reconciliation'))")
      blocker.release()
    }
  })
})
