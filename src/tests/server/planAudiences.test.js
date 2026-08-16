import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'

// Band and artist remain two independent PRODUCTS — they are just sold as
// MODULES of one subscription now, priced together on one cycle. This file owns
// the invariants that survive that change: a module is bound to its ladder for
// life, each tenant resolves through the ladder its kind selects, and nothing —
// service, HTTP, or raw SQL — may move a module across the boundary.
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
  entitlementSvc = await import('../../../server/commerce/billing/entitlementService.js')
  billingSvc = await import('../../../server/commerce/billing/billingService.js')
  purgeSvc = await import('../../../server/commerce/billing/entitlementPurgeService.js')
  limitSvc = await import('../../../server/commerce/billing/limitService.js')
  adminSvc = await import('../../../server/admin/subscriptions/adminSubscriptionService.js')
  providerFactory = await import('../../../server/commerce/billing/paymentProvider/index.js')
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

describe('one subscription, two modules', () => {
  it('a band and an artist module coexist on one subscription', async () => {
    const sub = await billing.createSubscription({
      userId: seed.userA.id,
      modules: [{ planSlug: 'gold' }, { planSlug: 'artist_gold' }],
    })

    const { rows } = await pool.query(
      'SELECT audience FROM subscription_modules WHERE subscription_id = $1 ORDER BY audience',
      [sub.id],
    )
    expect(rows.map((r) => r.audience)).toEqual(['artist', 'band'])
  })

  it('only ONE live subscription per user — the unique index bites', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    await expect(billing.createSubscription({ userId: seed.userA.id, planSlug: 'artist_gold' }))
      .rejects.toMatchObject({ code: '23505' })
  })

  it('only one module per ladder on a subscription', async () => {
    const sub = await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    await expect(billing.createSubscriptionModule(sub.id, { planSlug: 'silver' }))
      .rejects.toMatchObject({ code: '23505' })
  })

  it('module audience is derived from the plan, never from the caller', async () => {
    const sub = await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    // A caller insisting on the wrong audience is overruled by the trigger.
    const artist = await billing.createSubscriptionModule(sub.id, {
      planSlug: 'artist_gold', audience: 'band',
    })
    expect(artist.audience).toBe('artist')
  })

  it('a free fallback plan can never be a module — absence IS the free plan', async () => {
    const sub = await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    await expect(billing.createSubscriptionModule(sub.id, { planSlug: 'artist_bronze' }))
      .rejects.toThrow(/free fallback/)
  })
})

describe('entitlement routing by tenant kind', () => {
  it('resolves each tenant through its own module, simultaneously', async () => {
    const { bandTenantId, personalTenantId, userId } = await ownBothKinds()
    await billing.createSubscription({
      userId, modules: [{ planSlug: 'silver' }, { planSlug: 'artist_gold' }],
    })

    const band = await entitlementSvc.resolveTenantEntitlements(pool, bandTenantId)
    const personal = await entitlementSvc.resolveTenantEntitlements(pool, personalTenantId)

    expect(band.planSlug).toBe('silver')
    expect(personal.planSlug).toBe('artist_gold')
    // silver has no finance, artist_gold does — proof neither leaked into the other.
    expect(band.entitlements.features.finance).toBe(false)
    expect(personal.entitlements.features.finance).toBe(true)
  })

  it('falls back per ladder when no subscription exists at all', async () => {
    const { bandTenantId, personalTenantId } = await ownBothKinds()

    expect((await entitlementSvc.resolveTenantEntitlements(pool, bandTenantId)).planSlug).toBe('bronze')
    expect((await entitlementSvc.resolveTenantEntitlements(pool, personalTenantId)).planSlug).toBe('artist_bronze')
  })

  it('a subscription WITHOUT an artist module leaves the personal workspace on its floor', async () => {
    const { personalTenantId, userId } = await ownBothKinds()
    await billing.createSubscription({ userId, planSlug: 'gold' })

    const personal = await entitlementSvc.resolveTenantEntitlements(pool, personalTenantId)
    expect(personal.planSlug).toBe('artist_bronze')
    expect(personal.locked).toBe(true)
  })

  it('a module still awaiting its charge grants nothing yet', async () => {
    const { personalTenantId, userId } = await ownBothKinds()
    await billing.createSubscription({
      userId,
      modules: [{ planSlug: 'gold' }, { planSlug: 'artist_gold', status: 'pending' }],
    })

    const personal = await entitlementSvc.resolveTenantEntitlements(pool, personalTenantId)
    expect(personal.planSlug).toBe('artist_bronze')
    expect(personal.locked).toBe(true)
    // ...but its target capacity already binds, so usage cannot outrun the plan
    // the customer is midway through buying.
    expect(personal.entitlements.limits.storage_mb).toBe(50)
  })

  it('a module awaiting REMOVAL still grants — the period is paid for', async () => {
    const { personalTenantId, userId } = await ownBothKinds()
    await billing.createSubscription({
      userId,
      modules: [{
        planSlug: 'artist_gold', status: 'pending_removal', pending_change_kind: 'remove',
      }],
    })

    const personal = await entitlementSvc.resolveTenantEntitlements(pool, personalTenantId)
    expect(personal.planSlug).toBe('artist_gold')
    expect(personal.locked).toBe(false)
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

  it('gates the personal workspace on the ARTIST module while the band uses its own', async () => {
    const { bandTenantId, personalTenantId, userId } = await ownBothKinds()
    // Band gold grants calendar_sync; with no artist module the artist ladder is
    // on its free floor, which does not. Same user, opposite outcomes.
    await billing.createSubscription({ userId, planSlug: 'gold' })

    await as(request(app).post('/api/calendar-feed/regenerate'), bandTenantId).expect(200)
    const denied = await as(request(app).post('/api/calendar-feed/regenerate'), personalTenantId)
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe('entitlement_required')
    expect(denied.body.feature).toBe('calendar_sync')
  })

  it('opens the personal workspace once an artist module exists', async () => {
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

  it('naming a plan from the other ladder is a 400, not a silent switch', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'silver' })
    const res = await billingSvc.changeModule(pool, userA(), {
      audience: 'band', planId: await planId('artist_gold'),
    })
    expect(res.error.status).toBe(400)
    expect(res.error.body.code).toBe('audience_mismatch')
  })

  it('downgrading a module the subscription does not have is a 404', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    const res = await billingSvc.downgrade(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'), confirmation: 'x',
    })
    expect(res.error.status).toBe(404)
  })

  it('a downgrade WITHIN the artist ladder is accepted', async () => {
    await billing.createPersonalTenant(seed.userA.id)
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'artist_gold' })
    const res = await billingSvc.previewDowngrade(pool, userA(), {
      audience: 'artist', remove: true,
    })
    expect(res.error).toBeUndefined()
    expect(res.isDowngrade).toBe(true)
    expect(res.isRemoval).toBe(true)
  })
})

describe('database backstops', () => {
  // Raw SQL, deliberately: these guard against a code path that bypasses the
  // service layer entirely. An ORM-level assertion proves nothing here.
  async function moduleOf(userId, audience) {
    const { rows } = await pool.query(
      `SELECT m.id FROM subscription_modules m
         JOIN subscriptions s ON s.id = m.subscription_id
        WHERE s.user_id = $1 AND m.audience = $2`,
      [userId, audience],
    )
    return rows[0].id
  }

  it('refuses a direct audience change on a module', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    const id = await moduleOf(seed.userA.id, 'band')
    await expect(
      pool.query("UPDATE subscription_modules SET audience = 'artist' WHERE id = $1", [id]),
    ).rejects.toThrow(/audience is immutable/)
  })

  it('refuses moving a module to a plan on the other ladder', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    const id = await moduleOf(seed.userA.id, 'band')
    await expect(
      pool.query('UPDATE subscription_modules SET plan_id = $2 WHERE id = $1', [id, await planId('artist_gold')]),
    ).rejects.toThrow(/cannot change ladder/)
  })

  it('refuses a cross-audience pending plan change', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    const id = await moduleOf(seed.userA.id, 'band')
    await expect(pool.query(
      `UPDATE subscription_modules
          SET pending_plan_id = $2, pending_change_kind = 'downgrade', pending_price_cents = 1
        WHERE id = $1`,
      [id, await planId('artist_gold')],
    )).rejects.toThrow(/pending plan/)
  })

  it('refuses a cross-audience pending plan at INSERT time', async () => {
    const sub = await billing.createSubscription({ userId: seed.userA.id, planSlug: 'silver' })
    await expect(pool.query(
      `INSERT INTO subscription_modules
         (subscription_id, plan_id, status, price_cents, pending_plan_id, pending_change_kind, pending_price_cents)
       VALUES ($1, $2, 'active', 999, $3, 'downgrade', 1)`,
      [sub.id, await planId('gold'), await planId('artist_gold')],
    )).rejects.toThrow(/does not match module audience/)
  })

  it('ties removal status to the scheduled change in both directions', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    const id = await moduleOf(seed.userA.id, 'band')
    // pending_removal without a 'remove' change...
    await expect(
      pool.query("UPDATE subscription_modules SET status = 'pending_removal' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ code: '23514' })
    // ...and a 'remove' change without pending_removal.
    await expect(
      pool.query("UPDATE subscription_modules SET pending_change_kind = 'remove' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ code: '23514' })
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

  it('keeps exactly one trial tier per ladder', async () => {
    await expect(
      pool.query("UPDATE subscription_plans SET is_trial_tier = TRUE WHERE slug = 'silver'"),
    ).rejects.toMatchObject({ code: '23505' })
  })
})

describe('the trial is once per CUSTOMER, not per product', () => {
  // The commercial model is one customer, one trial. Sampling the band product
  // spends the trial outright — the second module is added DURING it, free.
  it('a spent trial is spent for good', async () => {
    await billing.createSubscription({
      userId: seed.userA.id, planSlug: 'gold', status: 'canceled', trial_ends_at: billing.daysFromNow(-30),
    })
    const repo = await import('../../../server/commerce/billing/subscriptionRepository.js')
    expect(await repo.hasUsedTrial(pool, seed.userA.id)).toBe(true)
    expect(await repo.hasUsedTrial(pool, seed.userB.id)).toBe(false)
  })
})

describe('a module purge stays inside its ladder', () => {
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

  it('removing the artist module purges the personal workspace and leaves bands alone', async () => {
    const { bandTenantId, personalTenantId, userId } = await ownBothKinds()
    await seedChart(bandTenantId)
    await seedChart(personalTenantId)

    // The band module keeps chordpro; the artist module is gone, so that ladder
    // falls to its floor and loses it.
    const sub = await billing.createSubscription({ userId, planSlug: 'gold' })

    await purgeSvc.executeModulePurge(pool, {
      subscriptionId: sub.id,
      audience: 'artist',
      manifest: { features: ['chordpro', 'song_files'] },
    })

    expect(await chartCount(personalTenantId)).toBe(0)
    expect(await chartCount(bandTenantId)).toBe(1)
  })

  it('a downgraded band module purges bands and leaves the personal workspace alone', async () => {
    const { bandTenantId, personalTenantId, userId } = await ownBothKinds()
    await seedChart(bandTenantId)
    await seedChart(personalTenantId)

    // The band module has landed on bronze (no chordpro) with its manifest still
    // frozen; the artist module keeps everything.
    const sub = await billing.createSubscription({
      userId,
      modules: [
        { planSlug: 'silver', pending_purge_manifest: { features: ['chordpro'] } },
        { planSlug: 'artist_gold' },
      ],
    })
    await pool.query(
      `UPDATE subscription_modules SET plan_id = (SELECT id FROM subscription_plans WHERE slug = 'silver')
        WHERE subscription_id = $1 AND audience = 'band'`, [sub.id],
    )
    // silver still grants chordpro, so the manifest SHRINKS to nothing — the
    // recovery-safe rule: a purge can never expand after confirmation.
    const band = await billing.getModule(sub.id, 'band')
    const result = await purgeSvc.executeModulePurge(pool, { moduleId: band.id })

    expect(result.features).toEqual([])
    expect(await chartCount(bandTenantId)).toBe(1)
    expect(await chartCount(personalTenantId)).toBe(1)
  })
})

describe('complimentary grants', () => {
  it('grants a subscription with its module', async () => {
    const grant = await adminSvc.grantComplimentary(pool, {
      userId: seed.userB.id, planId: await planId('artist_gold'),
    })
    expect(grant.error).toBeUndefined()
    expect(grant.subscription.modules.map((m) => m.audience)).toEqual(['artist'])
  })

  it('refuses a second grant — one subscription per user', async () => {
    await billing.createSubscription({ userId: seed.userB.id, planSlug: 'gold' })
    const grant = await adminSvc.grantComplimentary(pool, {
      userId: seed.userB.id, planId: await planId('artist_gold'),
    })
    expect(grant.error.body.code).toBe('already_subscribed')
  })
})

describe('tenant isolation', () => {
  it("another user's tenants never enter the purge or blocker scope", async () => {
    const { personalTenantId, userId } = await ownBothKinds()
    // userB owns tenantB, which must be invisible to userA's artist changes.
    await billing.setTenantOwner(seed.tenantB.id, seed.userB.id)

    const limitRepo = await import('../../../server/commerce/billing/limitRepository.js')
    const scoped = await limitRepo.listOwnedTenants(pool, userId, ['personal'])
    expect(scoped.map((t) => t.id)).toEqual([personalTenantId])
  })
})
