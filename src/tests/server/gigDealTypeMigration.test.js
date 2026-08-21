import './_envSetup.js'
// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let pool, runMigrations, truncateAll, seedTwoTenants

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
})

afterAll(async () => {
  await pool.end()
})

describe('migration 196 — gig deal types', () => {
  it('maps every legacy type and forces venue costs on for the old plain guarantee', async () => {
    const seed = await seedTwoTenants()
    const migration = await readFile(
      new URL('../../../server/db/migrations/196_gig_deal_types.sql', import.meta.url),
      'utf8',
    )
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('ALTER TABLE gigs DROP CONSTRAINT gigs_guarantee_variant_check')
      await client.query('ALTER TABLE gigs DROP COLUMN guarantee_variant')
      await client.query('ALTER TABLE gigs DROP CONSTRAINT gigs_deal_type_check')
      await client.query(`ALTER TABLE gigs ADD CONSTRAINT gigs_deal_type_check
        CHECK (deal_type IN ('flat_fee', 'guarantee', 'guarantee_plus', 'guarantee_vs', 'door_deal'))`)

      for (const [description, dealType, includeVenueCosts] of [
        ['legacy-flat', 'flat_fee', false],
        ['legacy-guarantee', 'guarantee', false],
        ['legacy-plus', 'guarantee_plus', false],
        ['legacy-versus', 'guarantee_vs', false],
        ['legacy-door', 'door_deal', false],
      ]) {
        await client.query(
          `INSERT INTO gigs (
             tenant_id, event_date, event_description, status,
             deal_type, breakeven_includes_venue_costs
           ) VALUES ($1, '2026-12-01', $2, 'confirmed', $3, $4)`,
          [seed.tenantA.id, description, dealType, includeVenueCosts],
        )
      }

      await client.query(migration)
      const { rows } = await client.query(
        `SELECT event_description, deal_type, guarantee_variant, breakeven_includes_venue_costs
           FROM gigs
          WHERE event_description LIKE 'legacy-%'
          ORDER BY event_description`,
      )
      expect(rows).toEqual([
        {
          event_description: 'legacy-door',
          deal_type: 'door_deal',
          guarantee_variant: null,
          breakeven_includes_venue_costs: false,
        },
        {
          event_description: 'legacy-flat',
          deal_type: 'flat_fee',
          guarantee_variant: null,
          breakeven_includes_venue_costs: false,
        },
        {
          event_description: 'legacy-guarantee',
          deal_type: 'guarantee',
          guarantee_variant: 'plus',
          breakeven_includes_venue_costs: true,
        },
        {
          event_description: 'legacy-plus',
          deal_type: 'guarantee',
          guarantee_variant: 'plus',
          breakeven_includes_venue_costs: false,
        },
        {
          event_description: 'legacy-versus',
          deal_type: 'guarantee',
          guarantee_variant: 'versus',
          breakeven_includes_venue_costs: false,
        },
      ])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
