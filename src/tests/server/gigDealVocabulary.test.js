import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  COST_PAID_BY,
  DEAL_TYPES,
  FEE_BASES,
  GUARANTEE_VARIANTS,
} from '../../../shared/gigDealVocabulary.js'

let pool, runMigrations

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  await runMigrations()
})

afterAll(async () => {
  await pool.end()
})

async function checkedValues(tableName, constraintName) {
  const { rows } = await pool.query(
    `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = $1 AND c.conname = $2`,
    [tableName, constraintName],
  )
  expect(rows).toHaveLength(1)
  return [...rows[0].definition.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

describe('gig deal vocabulary database contract', () => {
  it('matches every runtime list to its CHECK constraint', async () => {
    expect(await checkedValues('gigs', 'gigs_deal_type_check')).toEqual([...DEAL_TYPES])
    expect(await checkedValues('gigs', 'gigs_guarantee_variant_value_check')).toEqual([...GUARANTEE_VARIANTS])
    expect(await checkedValues('gigs', 'gigs_agency_fee_basis_check')).toEqual([...FEE_BASES])
    expect(await checkedValues('gigs', 'gigs_commission_basis_check')).toEqual([...FEE_BASES])
    expect(await checkedValues('gig_costs', 'gig_costs_paid_by_check')).toEqual([...COST_PAID_BY])
  })
})
