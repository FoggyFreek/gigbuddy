import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { PURGEABLE_FEATURES, FEATURES } from '../../../server/auth/entitlements.js'
import { FakeProvider } from './_fakeProvider.js'

// Billing owns WHEN entitlement-gated data is deleted; the owning domain owns
// WHAT. These are the invariants of that seam: every purgeable feature has an
// owner, a gap is fatal rather than silent, and dispatch reaches exactly the
// tenants the module's ladder covers.

vi.mock('../../../server/finance/invoices/molliePaymentLinkService.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, removeMolliePaymentLink: vi.fn(async () => ({ invoice: null })) }
})

let pool, runMigrations, truncateAll, seedTwoTenants, billing
let registry, purgeSvc, entSvc, providerFactory
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  billing = await import('./_billing.js')
  registry = await import('../../../server/entitlements/purgeRegistry.js')
  purgeSvc = await import('../../../server/commerce/billing/entitlementPurgeService.js')
  entSvc = await import('../../../server/entitlements/entitlementResolver.js')
  providerFactory = await import('../../../server/commerce/billing/paymentProvider/providerFactory.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  entSvc.clearEntitlementCaches()
  providerFactory.setPaymentProviderForTests(new FakeProvider())
})

afterAll(async () => {
  providerFactory.resetPaymentProvider()
  await pool.end()
})

async function seedChart(tenantId, name = 'Chart') {
  const { rows } = await pool.query(
    'INSERT INTO songs (tenant_id, title) VALUES ($1, $2) RETURNING id',
    [tenantId, `Song ${name}`],
  )
  await pool.query(
    `INSERT INTO song_chordpro_charts (song_id, tenant_id, name, source)
     VALUES ($1, $2, $3, '{title: Test}')`,
    [rows[0].id, tenantId, name],
  )
}

async function chartCount(tenantId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM song_chordpro_charts WHERE tenant_id = $1', [tenantId],
  )
  return rows[0].n
}

describe('the purge registry', () => {
  it('has an owner for every purgeable feature', () => {
    // Importing the purge service pulls the registration barrel, so this holds
    // wherever the purge can run — not only when the HTTP router was loaded.
    expect([...registry.registeredPurgeFeatures()].sort())
      .toEqual([...PURGEABLE_FEATURES].sort())
    expect(() => registry.assertPurgeHandlersRegistered()).not.toThrow()
  })

  it('a feature with no handler is a startup failure, naming the gap', async () => {
    // A fresh registry stands in for a PURGEABLE_FEATURES entry shipped without
    // a handler: it must crash at load, never silently retain the data.
    vi.resetModules()
    const fresh = await import('../../../server/entitlements/purgeRegistry.js')
    expect(() => fresh.assertPurgeHandlersRegistered()).toThrow(/No purge handler registered/)
    for (const feature of PURGEABLE_FEATURES) {
      expect(() => fresh.assertPurgeHandlersRegistered()).toThrow(new RegExp(feature))
    }
    vi.resetModules()
  })

  it('refuses a duplicate handler for one feature', () => {
    expect(() => registry.registerPurgeHandler(FEATURES.CHORDPRO, () => {}))
      .toThrow(/Duplicate purge handler/)
  })

  it('refuses a handler for a feature that is not purgeable', () => {
    expect(() => registry.registerPurgeHandler(FEATURES.FINANCE, () => {}))
      .toThrow(/non-purgeable/)
  })

  it('defaults a bare function to the transaction lock', () => {
    expect(registry.getPurgeHandler(FEATURES.CHORDPRO).lock).toBe('transaction')
    // Integrations mixes remote Mollie calls with local writes, so it declares
    // the session lock and must never run inside a transaction.
    expect(registry.getPurgeHandler(FEATURES.INTEGRATIONS).lock).toBe('session')
  })
})

describe('dispatch scope', () => {
  // userA owns two BAND tenants (one archived) and one personal workspace.
  async function ownThreeTenants() {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    await billing.setTenantOwner(seed.tenantB.id, seed.userA.id)
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantB.id])
    const personal = await billing.createPersonalTenant(seed.userA.id)
    return { bandId: seed.tenantA.id, archivedBandId: seed.tenantB.id, personalId: personal.id }
  }

  it('runs the handler for every owned tenant of the ladder, archived included', async () => {
    const { bandId, archivedBandId, personalId } = await ownThreeTenants()
    await seedChart(bandId)
    await seedChart(archivedBandId)
    await seedChart(personalId)

    // A band module removed at the boundary: the band ladder falls to its floor
    // and loses chordpro; the artist ladder is untouched.
    const sub = await billing.createSubscription({ userId: seed.userA.id, planSlug: 'artist_gold' })
    const result = await purgeSvc.executeModulePurge(pool, {
      subscriptionId: sub.id,
      audience: 'band',
      manifest: { features: [FEATURES.CHORDPRO] },
    })

    expect(result.purged).toBe(true)
    expect(await chartCount(bandId)).toBe(0)
    // Archived tenants can be unarchived, so the promised deletion reaches them.
    expect(await chartCount(archivedBandId)).toBe(0)
    // The other ladder is a separate product — its data survives.
    expect(await chartCount(personalId)).toBe(1)
  })

  it("never reaches another user's tenant", async () => {
    await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
    await billing.setTenantOwner(seed.tenantB.id, seed.userB.id)
    await seedChart(seed.tenantA.id)
    await seedChart(seed.tenantB.id)

    const sub = await billing.createSubscription({ userId: seed.userA.id, planSlug: 'artist_gold' })
    await purgeSvc.executeModulePurge(pool, {
      subscriptionId: sub.id,
      audience: 'band',
      manifest: { features: [FEATURES.CHORDPRO] },
    })

    expect(await chartCount(seed.tenantA.id)).toBe(0)
    expect(await chartCount(seed.tenantB.id)).toBe(1)
  })
})
