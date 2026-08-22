import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
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
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source) VALUES ($1, $2, 'contributor', 'approved', NOW(), 'admin')`,
    [u.id, seed.tenantA.id],
  )
  return u
}

describe('accounts — schema compatibility', () => {
  it('the insert trigger fills default_name when a writer omits it', async () => {
    // The previous app container still serves while a deploy migrates, and its
    // INSERT has no default_name column.
    const { rows: [row] } = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, reporting_group)
       VALUES ($1, '99123', 'Legacy insert', 'expense', '62000', 'operating_expense')
       RETURNING default_name, name_is_customized`,
      [seed.tenantA.id],
    )
    expect(row.default_name).toBe('Legacy insert')
    expect(row.name_is_customized).toBe(false)
  })
})

describe('accounts — renaming and resetting', () => {
  async function accountByCode(tenantId, code) {
    const { rows: [row] } = await pool.query(
      `SELECT id, code, name, default_name, name_is_customized, is_system
         FROM chart_of_accounts WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    )
    return row
  }

  it('PATCH renames a system account and marks it customized', async () => {
    const acc = await accountByCode(seed.tenantA.id, '11000')
    const res = await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ name: 'Rabobank zakelijk' })
      .expect(200)

    expect(res.body).toMatchObject({
      code: '11000',
      name: 'Rabobank zakelijk',
      default_name: acc.default_name,
      name_is_customized: true,
    })
  })

  it('PATCH 400 name_required on a blank name', async () => {
    const acc = await accountByCode(seed.tenantA.id, '11000')
    const res = await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ name: '   ' })
      .expect(400)
    expect(res.body.error).toBe('name_required')
  })

  it('PATCH name: null restores the country default and clears the flag', async () => {
    const acc = await accountByCode(seed.tenantA.id, '11000')
    await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ name: 'Rabobank zakelijk' })
      .expect(200)

    const res = await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ name: null })
      .expect(200)

    expect(res.body).toMatchObject({
      name: acc.default_name,
      default_name: acc.default_name,
      name_is_customized: false,
    })
  })

  it('PATCH name: null on a tenant-created account returns 409 not_system_account', async () => {
    const created = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '61999', name: 'Touring Expenses', type: 'expense', parent_code: '61000' })
      .expect(201)
    // It has a default_name of its own; eligibility is decided by is_system.
    expect(created.body.default_name).toBe('Touring Expenses')

    const res = await asUserA(request(app).patch(`/api/accounts/${created.body.id}`))
      .send({ name: null })
      .expect(409)
    expect(res.body.error).toBe('not_system_account')
  })

  it('POST stores the entered name as its own default, not customized', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '61998', name: 'Festival Costs', type: 'expense', parent_code: '61000' })
      .expect(201)
    expect(res.body).toMatchObject({
      name: 'Festival Costs',
      default_name: 'Festival Costs',
      name_is_customized: false,
    })
  })

  it('PATCH cannot change the account code, alone or alongside a name', async () => {
    const acc = await accountByCode(seed.tenantA.id, '11000')

    const alone = await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ code: '99999' })
      .expect(400)
    expect(alone.body.error).toBe('nothing_to_update')

    const withName = await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ name: 'Renamed', code: '99999' })
      .expect(200)
    expect(withName.body.code).toBe('11000')

    expect((await accountByCode(seed.tenantA.id, '11000')).name).toBe('Renamed')
  })

  it('PATCH cannot set default_name or name_is_customized from the request body', async () => {
    const acc = await accountByCode(seed.tenantA.id, '11000')

    await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ default_name: 'Forged', name_is_customized: true })
      .expect(400)

    const after = await accountByCode(seed.tenantA.id, '11000')
    expect(after.default_name).toBe(acc.default_name)
    expect(after.name_is_customized).toBe(false)
  })

  it('cross-tenant reset returns 404', async () => {
    const acc = await accountByCode(seed.tenantB.id, '11000')
    await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ name: null })
      .expect(404)

    expect((await accountByCode(seed.tenantB.id, '11000')).name_is_customized).toBe(false)
  })
})

describe('accounts — capitalizable flag', () => {
  it('GET /api/accounts exposes is_capitalizable', async () => {
    const res = await asUserA(request(app).get('/api/accounts')).expect(200)
    const gear = res.body.find((a) => a.code === '13000')
    expect(gear.is_capitalizable).toBe(true)
  })

  it('POST creates a capitalizable asset sub-account', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '13500', name: 'Studio Monitors', type: 'asset', parent_code: '13000', is_capitalizable: true })
      .expect(201)
    expect(res.body.is_capitalizable).toBe(true)
  })

  it('POST defaults is_capitalizable to false when omitted', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '13600', name: 'Spare Cables', type: 'asset', parent_code: '13000' })
      .expect(201)
    expect(res.body.is_capitalizable).toBe(false)
  })

  it('POST 400 when is_capitalizable is set on a non-asset account', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '62950', name: 'Bad', type: 'expense', parent_code: '62000', is_capitalizable: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/capitalizable/)
  })

  it('PATCH toggles is_capitalizable on an asset account', async () => {
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '14000'`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ is_capitalizable: false })
      .expect(200)
    expect(res.body.is_capitalizable).toBe(false)
  })

  it('PATCH 400 when enabling is_capitalizable on a non-asset account', async () => {
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '62100'`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).patch(`/api/accounts/${acc.id}`))
      .send({ is_capitalizable: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/capitalizable/)
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
      `INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, reporting_group)
       VALUES ($1, '99001', 'B-only leaf', 'expense', '62000', 'operating_expense') RETURNING id`,
      [seed.tenantB.id],
    )
    await asUserA(request(app).delete(`/api/accounts/${leaf.id}`)).expect(404)
    // owner can delete it
    await asUserB(request(app).delete(`/api/accounts/${leaf.id}`)).expect(204)
  })

  it('a rejected compatibility-currency write does not affect another tenant', async () => {
    const rejected = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ currency: 'USD' })
      .expect(400)
    expect(rejected.body.error).toBe('currency_read_only')
    const bRes = await asUserB(request(app).get('/api/accounts/settings')).expect(200)
    expect(bRes.body.currency).toBe('EUR')
  })
})

describe('accounts — CRUD', () => {
  it('GET /api/accounts returns all accounts ordered by code', async () => {
    const res = await asUserA(request(app).get('/api/accounts')).expect(200)
    const codes = res.body.map((a) => a.code)
    expect(codes).toEqual([...codes].sort())
    expect(codes.length).toBeGreaterThan(0)
  })

  it('POST creates a child account under an existing parent', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '61999', name: 'Touring Expenses', type: 'expense', parent_code: '61000' })
      .expect(201)
    expect(res.body.code).toBe('61999')
    expect(res.body.is_system).toBe(false)
  })

  it('POST inherits the reporting group from its parent', async () => {
    const res = await asUserA(request(app).post('/api/accounts'))
      .send({ code: '71999', name: 'Municipal grant', type: 'revenue', parent_code: '70000' })
      .expect(201)

    expect(res.body).toMatchObject({
      code: '71999',
      type: 'revenue',
      parent_code: '70000',
      reporting_group: 'other_operating_income',
    })
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
         AND code NOT IN ('11000','11200','21100','22000','41000','62100','24000','15000')
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
  it('GET /api/accounts returns 403 for a plain member (no finance access)', async () => {
    const mem = await seedMemberUser()
    await request(app).get('/api/accounts')
      .set('x-test-user-id', String(mem.id))
      .set('x-test-tenant-id', String(seed.tenantA.id))
      .expect(403)
  })

  it('GET /api/accounts returns 200 for a financial_admin', async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (google_sub, email, name, status) VALUES ('sub-fa', 'fa@test.local', 'FinAdmin', 'approved') RETURNING *`,
    )
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source) VALUES ($1, $2, 'financial_admin', 'approved', NOW(), 'admin')`,
      [u.id, seed.tenantA.id],
    )
    await request(app).get('/api/accounts')
      .set('x-test-user-id', String(u.id))
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

  it('PATCH /api/accounts/settings rejects currency because the profile owns it', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ currency: 'USD' })
      .expect(400)
    expect(res.body.error).toBe('currency_read_only')
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

  it('rejects assigning a configured VAT control account to another accounting role', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ primary_checking_account_code: '15000' })
      .expect(400)
    expect(res.body).toMatchObject({
      code: 'vat_control_account_conflict',
      field: 'input_vat_account_code',
      conflicting_field: 'primary_checking_account_code',
      account_code: '15000',
    })
  })

  it('enforces VAT control account distinctness at the database boundary', async () => {
    await expect(pool.query(
      `UPDATE tenant_accounting_settings SET primary_checking_account_code = input_vat_account_code
        WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )).rejects.toMatchObject({ constraint: 'tenant_accounting_settings_input_vat_distinct' })
  })

  it('requires the old VAT control account to have a zero balance before reassignment', async () => {
    await pool.query(
      `INSERT INTO ledger_transactions (tenant_id, entry_date, description, source_type, source_id, source_event)
       VALUES ($1, '2026-06-01', 'test', 'test', 1, 'posted')`,
      [seed.tenantA.id],
    )
    const { rows: [txn] } = await pool.query(
      `SELECT id FROM ledger_transactions WHERE tenant_id = $1 AND source_type = 'test'`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO ledger_entries (tenant_id, transaction_id, account_code, debit_cents, credit_cents)
       VALUES ($1, $2, '15000', 100, 0), ($1, $2, '39000', 0, 100)`,
      [seed.tenantA.id, txn.id],
    )

    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ input_vat_account_code: '13000' })
      .expect(409)
    expect(res.body).toMatchObject({ code: 'account_has_open_balance', field: 'input_vat_account_code' })
  })

  it('allows VAT control account reassignment when the old balance is zero', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ input_vat_account_code: '13000' })
      .expect(200)
    expect(res.body.input_vat_account_code).toBe('13000')
  })

  it('PATCH /api/accounts/settings updates the reimbursement account to a liability', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ default_reimbursement_account_code: '21100' })
      .expect(200)
    expect(res.body.default_reimbursement_account_code).toBe('21100')
  })

  it('PATCH /api/accounts/settings 400 when reimbursement account is not a liability', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ default_reimbursement_account_code: '11000' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/wrong_account_type/)
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

  it('PATCH /api/accounts/settings updates the cash account to an asset', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ cash_account_code: '11100' })
      .expect(200)
    expect(res.body.cash_account_code).toBe('11100')
  })

  it('PATCH /api/accounts/settings 400 when cash account is not an asset', async () => {
    const res = await asUserA(request(app).patch('/api/accounts/settings'))
      .send({ cash_account_code: '24000' }) // 24000 is a liability
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/wrong_account_type/)
  })

  it('GET /api/accounts/settings backstop includes VAT defaults when row is missing', async () => {
    await pool.query('DELETE FROM tenant_accounting_settings WHERE tenant_id = $1', [seed.tenantA.id])
    const res = await asUserA(request(app).get('/api/accounts/settings')).expect(200)
    expect(res.body.output_vat_account_code).toBe('24000')
    expect(res.body.input_vat_account_code).toBe('15000')
    expect(res.body.default_reimbursement_account_code).toBe('22000')
    expect(res.body.cash_account_code).toBe('11100')
  })

  it('PATCH deactivating the cash-referenced account returns 409 account_in_use', async () => {
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '11100'`,
      [seed.tenantA.id],
    )
    const res = await asUserA(request(app).patch(`/api/accounts/${acc.id}`)).send({ is_active: false })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/account_in_use/)
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

  it('PATCH deactivating the reimbursement-referenced account returns 409 account_in_use', async () => {
    const { rows: [acc] } = await pool.query(
      `SELECT id FROM chart_of_accounts WHERE tenant_id = $1 AND code = '22000'`,
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
      .send({ slug: 'gamma', band_name: 'Gamma Band', adminUserId: seed.superUser.id, country_code: 'nl' })
      .expect(201)

    const { rows: accs } = await pool.query(
      'SELECT code FROM chart_of_accounts WHERE tenant_id = $1',
      [res.body.id],
    )
    expect(accs.length).toBeGreaterThan(0)

    const { rows: settings } = await pool.query(
      'SELECT * FROM tenant_accounting_settings WHERE tenant_id = $1',
      [res.body.id],
    )
    expect(settings).toHaveLength(1)
  })
})
