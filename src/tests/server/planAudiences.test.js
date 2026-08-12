import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'

// Band and artist plans are two independent PRODUCTS. This file owns the
// invariants that fall out of that: a user may hold one live subscription per
// ladder, each tenant resolves through the ladder its kind selects, and nothing
// — service, HTTP, or raw SQL — may move a subscription across the boundary.
let app, pool, runMigrations, truncateAll, seedTwoTenants
let entitlementSvc, billingSvc, purgeSvc, limitSvc, adminSvc, providerFactory
let billing
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  entitlementSvc = await import('../../../server/services/entitlementService.js')
  billingSvc = await import('../../../server/services/billingService.js')
  purgeSvc = await import('../../../server/services/entitlementPurgeService.js')
  limitSvc = await import('../../../server/services/limitService.js')
  adminSvc = await import('../../../server/services/adminSubscriptionService.js')
  providerFactory = await import('../../../server/billing/paymentProvider/index.js')
  billing = await import('./_billing.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 999, yearly_price_cents = 9999 WHERE slug IN ('silver', 'gold', 'artist_gold')")
  entitlementSvc.clearEntitlementCaches()
  providerFactory.setPaymentProviderForTests(new FakeProvider())
})

afterAll(async () => {
  providerFactory.resetPaymentProvider()
  await pool.end()
})

async function planId(slug) {
  const { rows } = await pool.query('SELECT id FROM subscription_plans WHERE slug = $1', [slug])
  return rows[0].id
}

// userA owns band tenantA; returns it plus a personal workspace they also own.
async function ownBothKinds() {
  await billing.setTenantOwner(seed.tenantA.id, seed.userA.id)
  const personal = await billing.createPersonalTenant(seed.userA.id)
  return { bandTenantId: seed.tenantA.id, personalTenantId: personal.id, userId: seed.userA.id }
}

describe('two live subscriptions per user', () => {
  it('a band and an artist subscription coexist', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'artist_gold' })

    const { rows } = await pool.query(
      `SELECT audience FROM subscriptions WHERE user_id = $1 AND status <> 'canceled' ORDER BY audience`,
      [seed.userA.id],
    )
    expect(rows.map((r) => r.audience)).toEqual(['artist', 'band'])
  })

  it('but only one per ladder — the unique index still bites', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    await expect(billing.createSubscription({ userId: seed.userA.id, planSlug: 'silver' }))
      .rejects.toMatchObject({ code: '23505' })
  })

  it('audience is derived from the plan, never from the caller', async () => {
    // A caller insisting on the wrong audience is overruled by the trigger.
    const sub = await billing.createSubscription({
      userId: seed.userA.id, planSlug: 'artist_gold', audience: 'band',
    })
    expect(sub.audience).toBe('artist')
  })
})

describe('entitlement routing by tenant kind', () => {
  it('resolves each tenant through its own ladder, simultaneously', async () => {
    const { bandTenantId, personalTenantId, userId } = await ownBothKinds()
    await billing.createSubscription({ userId, planSlug: 'silver' })
    await billing.createSubscription({ userId, planSlug: 'artist_gold' })

    const band = await entitlementSvc.resolveTenantEntitlements(pool, bandTenantId)
    const personal = await entitlementSvc.resolveTenantEntitlements(pool, personalTenantId)

    expect(band.planSlug).toBe('silver')
    expect(personal.planSlug).toBe('artist_gold')
    // silver has no finance, artist_gold does — proof neither leaked into the other.
    expect(band.entitlements.features.finance).toBe(false)
    expect(personal.entitlements.features.finance).toBe(true)
  })

  it('falls back per ladder when neither subscription exists', async () => {
    const { bandTenantId, personalTenantId } = await ownBothKinds()

    expect((await entitlementSvc.resolveTenantEntitlements(pool, bandTenantId)).planSlug).toBe('bronze')
    expect((await entitlementSvc.resolveTenantEntitlements(pool, personalTenantId)).planSlug).toBe('artist_bronze')
  })

  it('a band subscription never reaches the personal workspace', async () => {
    const { personalTenantId, userId } = await ownBothKinds()
    await billing.createSubscription({ userId, planSlug: 'gold' })

    const personal = await entitlementSvc.resolveTenantEntitlements(pool, personalTenantId)
    expect(personal.planSlug).toBe('artist_bronze')
    expect(personal.locked).toBe(true)
  })

  // The fast path must not be trusted half-way: a caller supplying only the
  // owner would otherwise resolve the wrong product.
  it('re-reads ownership when the caller omits the tenant kind', async () => {
    const { personalTenantId, userId } = await ownBothKinds()
    await billing.createSubscription({ userId, planSlug: 'artist_gold' })

    const resolved = await entitlementSvc.resolveTenantEntitlements(pool, personalTenantId, {
      ownerUserId: userId,
    })
    expect(resolved.planSlug).toBe('artist_gold')
  })
})

describe('HTTP entitlement gates follow the active tenant', () => {
  // Exercises middleware/entitlements.js, which forwards req.tenantKind. A
  // resolver-only test cannot catch a middleware that forgets it.
  const as = (req, tenantId) => req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(tenantId))

  it('gates the personal workspace on the ARTIST plan while the band uses its own', async () => {
    const { bandTenantId, personalTenantId, userId } = await ownBothKinds()
    // Band gold grants calendar_sync; the artist ladder is on its free floor,
    // which does not. Same user, same request shape, opposite outcomes.
    await billing.createSubscription({ userId, planSlug: 'gold' })

    await as(request(app).post('/api/calendar-feed/regenerate'), bandTenantId).expect(200)
    const denied = await as(request(app).post('/api/calendar-feed/regenerate'), personalTenantId)
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe('entitlement_required')
    expect(denied.body.feature).toBe('calendar_sync')
  })

  it('opens the personal workspace once an artist subscription exists', async () => {
    const { personalTenantId, userId } = await ownBothKinds()
    await billing.createSubscription({ userId, planSlug: 'artist_gold' })

    await as(request(app).post('/api/calendar-feed/regenerate'), personalTenantId).expect(200)
  })
})

describe('the band cap reads the band ladder', () => {
  // artist_gold carries bands: 0, but that limit is vestigial — applying it
  // would forbid owning any band while subscribed to the artist product.
  it('an artist-only subscriber may still own a band', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'artist_gold' })

    const limits = await entitlementSvc.resolveUserLimits(pool, seed.userA.id)
    expect(limits.bands).toBe(1) // the band floor, not artist_gold's 0

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      expect(await limitSvc.enforceBandCap(client, seed.userA.id)).toBeNull()
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })
})

describe('cross-audience changes are refused', () => {
  const userA = () => ({ id: seed.userA.id, email: 'a@test.local', name: 'Alpha User' })

  // The reachable contract: routed by the target's audience, a band subscriber
  // naming an artist plan simply has no subscription on that ladder.
  it('changePlan onto the other ladder is a 404, not a silent switch', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'silver' })
    const res = await billingSvc.changePlan(pool, userA(), {
      planId: await planId('artist_gold'), interval: 'month',
    })
    expect(res.error.status).toBe(404)
  })

  it('downgrade onto the other ladder is a 404', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    const res = await billingSvc.downgrade(pool, userA(), {
      planId: await planId('artist_bronze'), interval: 'month', confirmation: 'downgrade to artist_bronze',
    })
    expect(res.error.status).toBe(404)
  })

  it('previewDowngrade onto the other ladder is a 404', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    const res = await billingSvc.previewDowngrade(pool, userA(), {
      planId: await planId('artist_bronze'), interval: 'month',
    })
    expect(res.error.status).toBe(404)
  })

  it('a downgrade WITHIN the artist ladder is accepted', async () => {
    await billing.createPersonalTenant(seed.userA.id)
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'artist_gold' })
    const res = await billingSvc.previewDowngrade(pool, userA(), {
      planId: await planId('artist_bronze'), interval: 'month',
    })
    expect(res.error).toBeUndefined()
    expect(res.isDowngrade).toBe(true)
    expect(res.isFreeFallback).toBe(true)
  })
})

describe('database backstops', () => {
  // Raw SQL, deliberately: these guard against a code path that bypasses the
  // service layer entirely. An ORM-level assertion proves nothing here.
  it('refuses a direct audience change on a subscription', async () => {
    const sub = await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    await expect(
      pool.query("UPDATE subscriptions SET audience = 'artist' WHERE id = $1", [sub.id]),
    ).rejects.toThrow(/audience is immutable/)
  })

  it('refuses moving a subscription to a plan on the other ladder', async () => {
    const sub = await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    await expect(
      pool.query('UPDATE subscriptions SET plan_id = $2 WHERE id = $1', [sub.id, await planId('artist_gold')]),
    ).rejects.toThrow(/plans cannot change audience/)
  })

  it('refuses a cross-audience pending plan change', async () => {
    const sub = await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    await expect(
      pool.query('UPDATE subscriptions SET pending_plan_id = $2 WHERE id = $1', [sub.id, await planId('artist_gold')]),
    ).rejects.toThrow(/pending plan .* is audience/)
  })

  it('refuses a cross-audience pending plan at INSERT time', async () => {
    await expect(pool.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, price_cents, pending_plan_id)
       VALUES ($1, $2, 'active', 999, $3)`,
      [seed.userA.id, await planId('gold'), await planId('artist_gold')],
    )).rejects.toThrow(/does not match audience/)
  })

  it("refuses changing a plan's audience", async () => {
    await expect(
      pool.query("UPDATE subscription_plans SET audience = 'artist' WHERE slug = 'gold'"),
    ).rejects.toThrow(/audience is immutable/)
  })

  it('keeps exactly one fallback per ladder', async () => {
    // A free second artist plan clears the fallback-integrity CHECK, so the
    // per-audience unique index is what actually refuses it.
    await expect(pool.query(
      `INSERT INTO subscription_plans (slug, name, audience, monthly_price_cents, yearly_price_cents,
                                       entitlements, is_active, is_fallback, sort_order)
       SELECT 'artist_bronze_2', 'Second Artist Floor', 'artist', 0, 0, entitlements, TRUE, TRUE, 9
         FROM subscription_plans WHERE slug = 'artist_bronze'`,
    )).rejects.toMatchObject({ code: '23505' })
  })
})

describe('trial is once per product', () => {
  it('a spent band trial leaves the artist trial available', async () => {
    await billing.createSubscription({
      userId: seed.userA.id, planSlug: 'gold', status: 'canceled', trial_ends_at: billing.daysFromNow(-30),
    })
    const repo = await import('../../../server/repositories/subscriptionRepository.js')

    expect(await repo.hasUsedTrial(pool, seed.userA.id, 'band')).toBe(true)
    expect(await repo.hasUsedTrial(pool, seed.userA.id, 'artist')).toBe(false)
  })
})

describe('downgrade purge stays inside its ladder', () => {
  async function chartCount(tenantId) {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM song_chordpro_charts WHERE tenant_id = $1', [tenantId],
    )
    return rows[0].n
  }

  async function seedChart(tenantId) {
    const { rows } = await pool.query(
      `INSERT INTO songs (tenant_id, title) VALUES ($1, 'Test Song') RETURNING id`, [tenantId],
    )
    await pool.query(
      `INSERT INTO song_chordpro_charts (song_id, tenant_id, name, source)
       VALUES ($1, $2, 'Chart', '{title: Test}')`,
      [rows[0].id, tenantId],
    )
  }

  it('an artist downgrade purges the personal workspace and leaves bands alone', async () => {
    const { bandTenantId, personalTenantId, userId } = await ownBothKinds()
    await seedChart(bandTenantId)
    await seedChart(personalTenantId)

    // Band gold keeps chordpro; the artist side loses it on the way to the floor.
    await billing.createSubscription({ userId, planSlug: 'gold' })
    const artistSub = await billing.createSubscription({
      userId, planSlug: 'artist_bronze', status: 'canceled',
      pending_purge_manifest: { features: ['chordpro', 'song_files'] },
    })

    await purgeSvc.executeDowngradePurge(pool, artistSub.id)

    expect(await chartCount(personalTenantId)).toBe(0)
    expect(await chartCount(bandTenantId)).toBe(1)
  })
})

describe('complimentary grants are per ladder', () => {
  it('grants an artist plan to a user who already holds a band subscription', async () => {
    await billing.createSubscription({ userId: seed.userB.id, planSlug: 'gold' })
    const grant = await adminSvc.grantComplimentary(pool, {
      userId: seed.userB.id, planId: await planId('artist_gold'),
    })
    expect(grant.error).toBeUndefined()
    expect(grant.subscription.audience).toBe('artist')
  })

  it('still refuses a second grant on the same ladder', async () => {
    await billing.createSubscription({ userId: seed.userB.id, planSlug: 'gold' })
    const grant = await adminSvc.grantComplimentary(pool, {
      userId: seed.userB.id, planId: await planId('silver'),
    })
    expect(grant.error.body.code).toBe('already_subscribed')
  })
})

describe('tenant isolation', () => {
  it("another user's tenants never enter the purge or blocker scope", async () => {
    const { personalTenantId, userId } = await ownBothKinds()
    // userB owns tenantB, which must be invisible to userA's artist downgrade.
    await billing.setTenantOwner(seed.tenantB.id, seed.userB.id)

    const limitRepo = await import('../../../server/repositories/limitRepository.js')
    const scoped = await limitRepo.listOwnedTenants(pool, userId, ['personal'])
    expect(scoped.map((t) => t.id)).toEqual([personalTenantId])
  })
})
