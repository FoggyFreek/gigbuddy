import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'

let pool, runMigrations, truncateAll, seedTwoTenants, postJournal
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const ledgerMod = await import('../../../server/finance/ledger/ledgerService.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  postJournal = ledgerMod.postJournal
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  const fixtureDb = await import('./_db.js')
  seed = await fixtureDb.seedAccountingForTenants(seed)
})

afterAll(async () => {
  await pool.end()
})

async function inRolledBackTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    return await fn(client)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

describe('VAT control account posting invariant', () => {
  it('rejects VAT control movement without matching tax facts', async () => {
    await inRolledBackTransaction(async (client) => {
      await expect(postJournal(client, seed.tenantA.id, {
        entryDate: '2026-06-01',
        description: 'direct VAT movement',
        sourceType: 'test', sourceId: 1, sourceEvent: 'posted',
        lines: [
          { account_code: '15000', debit_cents: 100 },
          { account_code: '11000', credit_cents: 100 },
        ],
      })).rejects.toMatchObject({ code: 'vat_control_reconciliation_failed' })
    })
  })

  it('allows the exact VAT settlement filing journal without new tax facts', async () => {
    await inRolledBackTransaction(async (client) => {
      const result = await postJournal(client, seed.tenantA.id, {
        entryDate: '2026-06-01',
        description: 'VAT settlement',
        sourceType: 'vat_settlement', sourceId: 1, sourceEvent: 'filed',
        lines: [
          { account_code: '24000', debit_cents: 100 },
          { account_code: '24010', credit_cents: 100 },
        ],
      })
      expect(result.posted).toBe(true)
    })
  })
})
