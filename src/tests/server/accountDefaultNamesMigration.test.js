import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Migration 176's backfill runs exactly once in production, against data the
// already-migrated test template never reproduces. These tests reconstruct the
// legacy shape (default_name NULL) and replay the migration, which is written to
// be re-runnable for exactly this reason.
//
// The schema is mutated here (DROP NOT NULL), so this file stands alone; the
// final replay puts the constraint back.

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'server/db/migrations/176_account_default_names.sql',
)
const PACK_VERSION_MIGRATION_PATH = path.resolve(
  process.cwd(),
  'server/db/migrations/177_country_pack_version.sql',
)

let pool, runMigrations, truncateAll, seedTwoTenants
let seed, migrationSql, packVersionSql

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  migrationSql = await readFile(MIGRATION_PATH, 'utf8')
  packVersionSql = await readFile(PACK_VERSION_MIGRATION_PATH, 'utf8')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  // seedTwoTenants gives both tenants an nl profile; move B to a country with no
  // label pack so "kept the English base" is distinguishable from "untouched".
  await pool.query(
    `UPDATE tenant_accounting_profiles SET country_code = 'de' WHERE tenant_id = $1`,
    [seed.tenantB.id],
  )
})

afterAll(async () => {
  // Leave the schema as the migration defines it for anything sharing this database.
  await pool.query(migrationSql)
  await pool.end()
})

// Strips the columns back to their pre-176 state.
async function makeRowsLegacy() {
  await pool.query('ALTER TABLE chart_of_accounts ALTER COLUMN default_name DROP NOT NULL')
  await pool.query('UPDATE chart_of_accounts SET default_name = NULL, name_is_customized = FALSE')
}

async function accountByCode(tenantId, code) {
  const { rows: [row] } = await pool.query(
    `SELECT code, name, default_name, name_is_customized, is_system
       FROM chart_of_accounts WHERE tenant_id = $1 AND code = $2`,
    [tenantId, code],
  )
  return row
}

async function isDefaultNameNullable() {
  const { rows: [row] } = await pool.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'chart_of_accounts' AND column_name = 'default_name'`,
  )
  return row.is_nullable === 'YES'
}

describe('migration 176 — account default names backfill', () => {
  it('fills every row and restores the NOT NULL constraint', async () => {
    await makeRowsLegacy()
    expect(await isDefaultNameNullable()).toBe(true)

    await pool.query(migrationSql)

    const { rows: [{ n }] } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM chart_of_accounts WHERE default_name IS NULL',
    )
    expect(n).toBe(0)
    expect(await isDefaultNameNullable()).toBe(false)
  })

  it('gives an nl tenant Dutch defaults and a packless tenant the English base', async () => {
    await makeRowsLegacy()
    await pool.query(migrationSql)

    expect((await accountByCode(seed.tenantA.id, '11200')).default_name).toBe('Debiteuren')
    expect((await accountByCode(seed.tenantB.id, '11200')).default_name).toBe('Accounts Receivable')
  })

  it('never rewrites an existing name, so legacy English rows only gain a reset affordance', async () => {
    await makeRowsLegacy()
    await pool.query(migrationSql)

    const nlRow = await accountByCode(seed.tenantA.id, '11200')
    // The tenant predates the pack: the label stays English until they reset it.
    expect(nlRow.name).toBe('Accounts Receivable')
    expect(nlRow.default_name).toBe('Debiteuren')
    expect(nlRow.name_is_customized).toBe(true)

    // Same tenant, same migration, no drift where the pack agrees with the base.
    const packlessRow = await accountByCode(seed.tenantB.id, '11200')
    expect(packlessRow.name).toBe('Accounts Receivable')
    expect(packlessRow.name_is_customized).toBe(false)
  })

  it('preserves a customized name and marks it customized', async () => {
    await pool.query(
      `UPDATE chart_of_accounts SET name = 'Rabobank zakelijk'
        WHERE tenant_id = $1 AND code = '11000'`,
      [seed.tenantB.id],
    )
    await makeRowsLegacy()
    await pool.query(migrationSql)

    const row = await accountByCode(seed.tenantB.id, '11000')
    expect(row.name).toBe('Rabobank zakelijk')
    expect(row.default_name).toBe('Primary Bank Account')
    expect(row.name_is_customized).toBe(true)
  })

  it('defaults a tenant-created account to its own name', async () => {
    await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, reporting_group, is_system)
       VALUES ($1, '61999', 'Festival Costs', 'expense', '61000', 'operating_expense', false)`,
      [seed.tenantB.id],
    )
    await makeRowsLegacy()
    await pool.query(migrationSql)

    expect(await accountByCode(seed.tenantB.id, '61999')).toMatchObject({
      name: 'Festival Costs',
      default_name: 'Festival Costs',
      name_is_customized: false,
      is_system: false,
    })
  })

  it('177 stamps the pack revision on tenants that had none', async () => {
    await pool.query('UPDATE tenant_accounting_profiles SET pack_version = NULL')

    await pool.query(packVersionSql)

    const { rows } = await pool.query(
      `SELECT tenant_id, pack_version FROM tenant_accounting_profiles
        WHERE tenant_id IN ($1, $2) ORDER BY tenant_id`,
      [seed.tenantA.id, seed.tenantB.id],
    )
    expect(rows.map((r) => r.pack_version)).toEqual(['nl-pack-2026.1', 'de-pack-2026.1'])
  })

  it('177 supersedes the pre-release stamp format', async () => {
    await pool.query(
      `UPDATE tenant_accounting_profiles SET pack_version = 'nl-accounts-2026.1'
        WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )

    await pool.query(packVersionSql)

    const { rows: [a] } = await pool.query(
      'SELECT pack_version FROM tenant_accounting_profiles WHERE tenant_id = $1', [seed.tenantA.id],
    )
    expect(a.pack_version).toBe('nl-pack-2026.1')
  })

  it('177 never overwrites a newer revision', async () => {
    await pool.query(
      `UPDATE tenant_accounting_profiles SET pack_version = 'nl-pack-2027.9'
        WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )
    await pool.query('UPDATE tenant_accounting_profiles SET pack_version = NULL WHERE tenant_id = $1', [seed.tenantB.id])

    await pool.query(packVersionSql)

    const { rows: [a] } = await pool.query(
      'SELECT pack_version FROM tenant_accounting_profiles WHERE tenant_id = $1', [seed.tenantA.id],
    )
    expect(a.pack_version).toBe('nl-pack-2027.9')
  })

  it('is idempotent — replaying it changes nothing', async () => {
    await makeRowsLegacy()
    await pool.query(migrationSql)

    const snapshot = async () => (await pool.query(
      `SELECT tenant_id, code, name, default_name, name_is_customized
         FROM chart_of_accounts ORDER BY tenant_id, code`,
    )).rows

    const before = await snapshot()
    await pool.query(migrationSql)
    expect(await snapshot()).toEqual(before)
  })
})
