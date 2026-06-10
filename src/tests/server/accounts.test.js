import './_envSetup.js'
// @vitest-environment node
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

const __dirname = dirname(fileURLToPath(import.meta.url))

let app, pool, runMigrations, truncateAll, seedTwoTenants, DEFAULT_ACCOUNTS
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const seedMod = await import('../../../server/db/defaultChartOfAccounts.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  DEFAULT_ACCOUNTS = seedMod.DEFAULT_ACCOUNTS
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}
function asUserB(req) {
  return req
    .set('x-test-user-id', String(seed.userB.id))
    .set('x-test-tenant-id', String(seed.tenantB.id))
}

async function seedMemberUser() {
  const { rows: [u] } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status) VALUES ('sub-mem', 'mem@test.local', 'Member', 'approved') RETURNING *`,
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at) VALUES ($1, $2, 'member', 'approved', NOW())`,
    [u.id, seed.tenantA.id],
  )
  return u
}

describe('accounts — seeding (JS path)', () => {
  it('seeded tenants have all default accounts including 21100', async () => {
    const { rows } = await pool.query(
      'SELECT code FROM chart_of_accounts WHERE tenant_id = $1 ORDER BY code',
      [seed.tenantA.id],
    )
    const codes = rows.map((r) => r.code)
    for (const acc of DEFAULT_ACCOUNTS) {
      expect(codes).toContain(acc.code)
    }
    expect(codes).toContain('21100')
  })

  it('seeded tenants have the default settings row with expected defaults', async () => {
    const { rows } = await pool.query(
      'SELECT * FROM tenant_accounting_settings WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    expect(rows).toHaveLength(1)
    const s = rows[0]
    expect(s.currency).toBe('EUR')
    expect(s.receivable_account_code).toBe('11200')
    expect(s.default_revenue_account_code).toBe('41000')
    expect(s.payable_account_code).toBe('21100')
    expect(s.default_expense_account_code).toBe('62100')
    expect(s.primary_checking_account_code).toBe('11000')
    expect(s.output_vat_account_code).toBe('24000')
    expect(s.input_vat_account_code).toBe('15000')
  })

  it('each tenant has its own independent copy of default accounts', async () => {
    const { rows: aRows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM chart_of_accounts WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    const { rows: bRows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM chart_of_accounts WHERE tenant_id = $1',
      [seed.tenantB.id],
    )
    expect(aRows[0].n).toBe(DEFAULT_ACCOUNTS.length)
    expect(bRows[0].n).toBe(DEFAULT_ACCOUNTS.length)
  })
})

describe('accounts — migration backfill parity', () => {
  it('backfill SQL produces the same accounts as the JS seed', async () => {
    // Insert a bare tenant (no JS seeding), run the idempotent migration, verify
    const { rows: [bare] } = await pool.query(
      `INSERT INTO tenants (slug, band_name) VALUES ('bare', 'Bare Band') RETURNING id`,
    )
    const migrationSql = readFileSync(
      join(__dirname, '../../../server/db/migrations/064_chart_of_accounts.sql'),
      'utf8',
    )
    await pool.query(migrationSql)

    const { rows: accs } = await pool.query(
      'SELECT code, name, type, parent_code FROM chart_of_accounts WHERE tenant_id = $1 ORDER BY code',
      [bare.id],
    )
    const jsCodes = DEFAULT_ACCOUNTS.map((a) => a.code).sort()
    const sqlCodes = accs.map((a) => a.code).sort()
    expect(sqlCodes).toEqual(jsCodes)

    for (const acc of DEFAULT_ACCOUNTS) {
      const row = accs.find((r) => r.code === acc.code)
      expect(row).toBeDefined()
      expect(row.name).toBe(acc.name)
      expect(row.type).toBe(acc.type)
      expect(row.parent_code).toBe(acc.parent_code ?? null)
    }

    const { rows: [s] } = await pool.query(
      'SELECT * FROM tenant_accounting_settings WHERE tenant_id = $1',
      [bare.id],
    )
    expect(s).toBeDefined()
    expect(s.currency).toBe('EUR')
    expect(s.primary_checking_account_code).toBe('11000')
  })
})

describe('accounts — isolation', () => {
  it('GET /api/accounts returns only active tenant accounts', async () => {
    const res = await asUserA(request(app).get('/api/accounts')).expect(200)
    const allForA = res.body.map((a) => a.code)
    const bCodes = (
      await pool.query('SELECT code FROM chart_of_accounts WHERE tenant_id = $1', [seed.tenantB.id])
    ).rows.map((r) => r.code)
    // No overlap expected (same codes exist per tenant, but all returned are for tenantA)
    const tenantIds = [...new Set(res.body.map((a) => a.tenant_id))]
    expect(tenantIds).toEqual([seed.tenantA.id])
    expect(allForA.sort()).toEqual(bCodes.sort()) // same codes, different tenants
  })

  it('cross-tenant PATCH by id returns 404', async () => {
    const { rows: [acc] } = await pool.query(
      "SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '61200'",
      [seed.tenantB.id],
    )
    await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ name: 'Hacked' })
      .expect(404)
  })

  it('cross-tenant DELETE by id returns 404', async () => {
    // create a leaf account under tenantB so it is deletable (no children/settings)
    const { rows: [leaf] } = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code)
       VALUES ($1, '99001', 'B-only leaf', 'expense', '62000') RETURNING id`,
      [seed.tenantB.id],
    )
    await asUserA(request(app).delete(`/api/accounts/${leaf.id}`)).expect(404)
    // owner can delete it
    await asUserB(request(app).delete(`/api/accounts/${leaf.id}`)).expect(204)
  })

  it('settings changes do not leak between tenants', async () => {
    await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ currency: 'USD' })
      .expect(200)
    const bRes = await asUserB(request(app).get('/api/accounts/settings')).expect(200)
    expect(bRes.body.currency).toBe('EUR')
  })
})

describe('accounts — CRUD', () => {
  it('GET /api/accounts returns all accounts ordered by code', async () => {
    const res = await asUserA(request(app).get('/api/accounts')).expect(200)
    const codes = res.body.map((a) => a.code)
    expect(codes).toEqual([...codes].sort())
    expect(codes.length).toBe(DEFAULT_ACCOUNTS.length)
  })

  it('POST creates a child account under an existing parent', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '61999', name: 'Touring Expenses', type: 'expense', parent_code: '61000' })
      .expect(201)
    expect(res.body.code).toBe('61999')
    expect(res.body.is_system).toBe(false)
  })

  it('POST 409 code_taken on duplicate code', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '11000', name: 'Duplicate', type: 'asset' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/code_taken/)
  })

  it('POST 400 on unknown parent_code', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '99999', name: 'Orphan', type: 'expense', parent_code: '00000' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/parent/)
  })

  it('POST 400 on type mismatch with parent', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '99998', name: 'Wrong type', type: 'asset', parent_code: '61000' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/type/)
  })

  it('POST 400 on invalid code format', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: 'ABC', name: 'Bad code', type: 'expense' })
    expect(res.status).toBe(400)
  })

  it('POST 400 on empty name', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '99997', name: '  ', type: 'expense' })
    expect(res.status).toBe(400)
  })

  it('PATCH deactivates an unreferenced account', async () => {
    // Find a leaf with no settings reference
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts
       WHERE tenant_id = $1
         AND code NOT IN ('11000','11200','21100','41000','62100','24000','15000')
         AND code NOT IN (
           SELECT code FROM chart_of_accounts c2
           WHERE c2.parent_code = chart_of_accounts.code AND c2.tenant_id = $1
         )
       LIMIT 1`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ is_active: false })
      .expect(200)
    expect(res.body.is_active).toBe(false)
  })

  it('PATCH reactivates an account', async () => {
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts
       WHERE tenant_id = $1 AND code = '64200' LIMIT 1`,
      [seed.tenantA.id],
    )
    await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ is_active: false })
      .expect(200)
    const res = await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ is_active: true })
      .expect(200)
    expect(res.body.is_active).toBe(true)
  })

  it('PATCH deactivating a settings-referenced account returns 409 account_in_use', async () => {
    // 11200 is the default receivable_account_code
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '11200'`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ is_active: false })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/account_in_use/)
  })

  it('DELETE unused leaf account returns 204', async () => {
    await asUserA(request(app).post('/api/accounts'))
      .send({ code: '61998', name: 'To delete', type: 'expense', parent_code: '61000' })
      .expect(201)
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '61998'`,
      [seed.tenantA.id],
    )
    await asUserA(request(app).delete(`/api/accounts/${acc.id}`)).expect(204)
  })

  it('DELETE account with children returns 409 account_in_use', async () => {
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '61000'`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).delete(`/api/accounts/${acc.id}`))
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/account_in_use/)
  })

  it('DELETE settings-referenced account returns 409 account_in_use', async () => {
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '11200'`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).delete(`/api/accounts/${acc.id}`))
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/account_in_use/)
  })
})

describe('accounts — admin gating', () => {
  it('GET /api/accounts returns 200 for plain member', async () => {
    const mem = await seedMemberUser()
    await request(app).get('/api/accounts')
      .set('x-test-user-id', String(mem.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .expect(200)
  })

  it('POST /api/accounts returns 403 for plain member', async () => {
    const mem = await seedMemberUser()
    await request(app).post('/api/accounts')
      .set('x-test-user-id', String(mem.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .send({ code: '99001', name: 'Member acct', type: 'expense' })
      .expect(403)
  })

  it('PATCH /api/accounts/:id returns 403 for plain member', async () => {
    const mem = await seedMemberUser()
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 LIMIT 1`,
      [seed.tenantA.id],
    )
    await request(app).patch(`/api/accounts/${acc.id}`)
      .set('x-test-user-id', String(mem.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .send({ name: 'Hacked' })
      .expect(403)
  })

  it('DELETE /api/accounts/:id returns 403 for plain member', async () => {
    const mem = await seedMemberUser()
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 LIMIT 1`,
      [seed.tenantA.id],
    )
    await request(app).delete(`/api/accounts/${acc.id}`)
      .set('x-test-user-id', String(mem.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .expect(403)
  })
})

describe('accounts/settings — CRUD', () => {
  it('GET /api/accounts/settings returns the settings row', async () => {
    const res = await asUserA(request(app).get('/api/accounts/settings')).expect(200)
    expect(res.body.currency).toBe('EUR')
    expect(res.body.primary_checking_account_code).toBe('11000')
  })

  it('PATCH /api/accounts/settings updates currency', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ currency: 'USD' })
      .expect(200)
    expect(res.body.currency).toBe('USD')
  })

  it('PATCH /api/accounts/settings 400 on unknown code', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ receivable_account_code: '99999' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown_account_code/)
  })

  it('PATCH /api/accounts/settings 400 on inactive code', async () => {
    // 13000 (Owned Gear) is an asset leaf not referenced by settings.
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '13000'`,
      [seed.tenantA.id],
    )
    // deactivate it first, then it can't be used as the receivable account
    await asUserA(request(app).patch(`/api/accounts/${acc.id}`)).send({ is_active: false }).expect(200)
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ receivable_account_code: '13000' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown_account_code/)
  })

  it('PATCH /api/accounts/settings 400 on wrong account type (asset as revenue)', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ default_revenue_account_code: '11000' }) // 11000 is asset, not revenue
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/wrong_account_type/)
  })

  it('PATCH /api/accounts/settings 400 on bad currency', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ currency: 'euros' })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/accounts/settings null clears a code', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ receivable_account_code: null })
      .expect(200)
    expect(res.body.receivable_account_code).toBeNull()
  })

  it('PATCH /api/accounts/settings updates VAT accounts to valid types', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ output_vat_account_code: '24000', input_vat_account_code: '15000' })
      .expect(200)
    expect(res.body.output_vat_account_code).toBe('24000')
    expect(res.body.input_vat_account_code).toBe('15000')
  })

  it('PATCH /api/accounts/settings 400 when output VAT is not a liability', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ output_vat_account_code: '15000' }) // 15000 is an asset
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/wrong_account_type/)
  })

  it('PATCH /api/accounts/settings 400 when input VAT is not an asset', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ input_vat_account_code: '24000' }) // 24000 is a liability
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/wrong_account_type/)
  })

  it('GET /api/accounts/settings backstop includes VAT defaults when row is missing', async () => {
    await pool.query('DELETE FROM tenant_accounting_settings WHERE tenant_id = $1', [seed.tenantA.id])
    const res = await asUserA(request(app).get('/api/accounts/settings')).expect(200)
    expect(res.body.output_vat_account_code).toBe('24000')
    expect(res.body.input_vat_account_code).toBe('15000')
  })

  it('PATCH deactivating a VAT-referenced account returns 409 account_in_use', async () => {
    // 24000 is the default output_vat_account_code
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '24000'`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).patch(`/api/accounts/${acc.id}`)).send({ is_active: false })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/account_in_use/)
  })

  it('PATCH /api/accounts/settings returns 403 for plain member', async () => {
    const mem = await seedMemberUser()
    await request(app).patch('/api/accounts/settings')
      .set('x-test-user-id', String(mem.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .send({ currency: 'USD' })
      .expect(403)
  })
})

describe('tenant creation — seeds accounts', () => {
  it('POST /api/admin/tenants seeds accounts and settings for the new tenant', async () => {
    const res = await request(app)
      .post('/api/admin/tenants')
      .set('x-test-user-id', String(seed.superUser.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .send({ slug: 'gamma', band_name: 'Gamma Band', adminUserId: seed.superUser.id })
      .expect(201)

    const { rows: accs } = await pool.query(
      'SELECT code FROM chart_of_accounts WHERE tenant_id = $1',
      [res.body.id],
    )
    expect(accs.length).toBe(DEFAULT_ACCOUNTS.length)

    const { rows: settings } = await pool.query(
      'SELECT * FROM tenant_accounting_settings WHERE tenant_id = $1',
      [res.body.id],
    )
    expect(settings).toHaveLength(1)
    expect(settings[0].currency).toBe('EUR')
  })
})
