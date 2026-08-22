import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { INVOICE_MODES } from '../../../shared/invoiceModes.js'

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
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

describe('tenant preferred invoice mode', () => {
  it('defaults existing and new tenants to combined', async () => {
    const response = await asUserA(request(app).get('/api/tenant/invoice-mode')).expect(200)
    expect(response.body).toEqual({ preferred_invoice_mode: 'combined' })

    const { rows } = await pool.query(
      'SELECT preferred_invoice_mode FROM tenants WHERE id = $1',
      [seed.tenantA.id],
    )
    expect(rows[0].preferred_invoice_mode).toBe('combined')
  })

  it.each(INVOICE_MODES)('accepts and persists %s', async (mode) => {
    await asUserA(request(app).patch('/api/tenant/invoice-mode')
      .send({ preferred_invoice_mode: mode })).expect(200, { preferred_invoice_mode: mode })

    const response = await asUserA(request(app).get('/api/tenant/invoice-mode')).expect(200)
    expect(response.body.preferred_invoice_mode).toBe(mode)
  })

  it.each(['split', '', null])('rejects invalid mode %s', async (mode) => {
    const response = await asUserA(request(app).patch('/api/tenant/invoice-mode')
      .send({ preferred_invoice_mode: mode })).expect(400)
    expect(response.body.code).toBe('invalid_invoice_mode')
  })

  it('requires finance.manage to update the preference', async () => {
    await pool.query(
      `UPDATE memberships SET role = 'contributor'
        WHERE tenant_id = $1 AND user_id = $2`,
      [seed.tenantA.id, seed.userA.id],
    )
    await asUserA(request(app).patch('/api/tenant/invoice-mode')
      .send({ preferred_invoice_mode: 'specified' })).expect(403)
  })

  it('keeps the preference tenant-scoped', async () => {
    await asUserA(request(app).patch('/api/tenant/invoice-mode')
      .send({ preferred_invoice_mode: 'specified' })).expect(200)

    const { rows } = await pool.query(
      'SELECT id, preferred_invoice_mode FROM tenants ORDER BY id',
    )
    expect(rows.find((tenant) => tenant.id === seed.tenantA.id).preferred_invoice_mode).toBe('specified')
    expect(rows.find((tenant) => tenant.id === seed.tenantB.id).preferred_invoice_mode).toBe('combined')
  })

  it('keeps the runtime mode list aligned with the database constraint', async () => {
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'tenants'
          AND c.conname = 'tenants_preferred_invoice_mode_check'`,
    )
    expect(rows).toHaveLength(1)
    const values = [...rows[0].definition.matchAll(/'([^']+)'/g)].map((match) => match[1])
    expect(values).toEqual([...INVOICE_MODES])
  })
})
