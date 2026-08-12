import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

// Leaving a band is a fact about the user, not about an active tenant: an
// artist does it from their own workspace, with no band selected. So this sits
// on the user-level tier alongside /invites/redeem, and every failure is a 404
// — a tenant the caller is not in must be indistinguishable from one that does
// not exist.

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
  // userA is a seeded tenant_admin; the last-admin rule is covered in
  // lastTenantAdmin.test.js, so demote them to exercise the ordinary path.
  await pool.query(
    `UPDATE memberships SET role = 'reader' WHERE tenant_id = $1 AND user_id = $2`,
    [seed.tenantA.id, seed.userA.id],
  )
})

afterAll(async () => pool.end())

// No active tenant: the caller is sitting in their own workspace.
const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', 'null')

const leave = (tenantId) => request(app).delete(`/api/me/memberships/${tenantId}`)

const membershipCount = async (tenantId, userId) => {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM memberships WHERE tenant_id = $1 AND user_id = $2',
    [tenantId, userId],
  )
  return rowCount
}

describe('DELETE /api/me/memberships/:tenantId', () => {
  it('leaves a band with no active tenant and unlinks the roster row', async () => {
    await asUserA(leave(seed.tenantA.id)).expect(204)

    expect(await membershipCount(seed.tenantA.id, seed.userA.id)).toBe(0)
    const { rows } = await pool.query(
      'SELECT user_id FROM band_members WHERE id = $1',
      [seed.memberA.id],
    )
    expect(rows[0].user_id).toBeNull()
  })

  it('leaves the band alone otherwise', async () => {
    await asUserA(leave(seed.tenantA.id)).expect(204)

    const { rowCount } = await pool.query('SELECT 1 FROM tenants WHERE id = $1', [seed.tenantA.id])
    expect(rowCount).toBe(1)
    expect(await membershipCount(seed.tenantA.id, seed.superUser.id)).toBe(1)
  })

  it('404s for a band the caller is not in, and for one that does not exist', async () => {
    const foreign = await asUserA(leave(seed.tenantB.id)).expect(404)
    const missing = await asUserA(leave(999999)).expect(404)

    // Identical bodies: membership must not be a distinguishing signal.
    expect(foreign.body).toEqual(missing.body)
    expect(await membershipCount(seed.tenantB.id, seed.userB.id)).toBe(1)
  })

  it('404s on a second leave', async () => {
    await asUserA(leave(seed.tenantA.id)).expect(204)
    await asUserA(leave(seed.tenantA.id)).expect(404)
  })

  it('404s when the membership is not approved', async () => {
    await pool.query(
      `UPDATE memberships SET status = 'pending' WHERE tenant_id = $1 AND user_id = $2`,
      [seed.tenantA.id, seed.userA.id],
    )

    await asUserA(leave(seed.tenantA.id)).expect(404)
    expect(await membershipCount(seed.tenantA.id, seed.userA.id)).toBe(1)
  })

  it('audits the departure with the band that was left', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await asUserA(leave(seed.tenantA.id)).expect(204)

      const entries = log.mock.calls
        .map(([line]) => { try { return JSON.parse(line) } catch { return null } })
        .filter((e) => e?.action === 'membership.leave')
      expect(entries).toHaveLength(1)
      // req.tenantId is absent on this tier, so the service must supply it.
      expect(entries[0].tenantId).toBe(seed.tenantA.id)
    } finally {
      log.mockRestore()
    }
  })
})
