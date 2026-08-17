import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'

// Downgrading or removing a module is the one flow that DELETES data, so every
// branch runs on informed consent first and no data loss before the target plan
// is real. With one shared cycle a downgrade is now just a scheduled change to
// the same subscription's amount — there is no replacement subscription, and no
// repoint race to survive.

// The integrations purge calls removeMolliePaymentLink, which talks to the
// real Mollie API with the tenant's key. Fake just that function: an unpaid
// link is removed (columns cleared), a paid link 409s and stays — the exact
// contract the purge's retain-vs-delete decision depends on.
vi.mock('../../../server/finance/invoices/molliePaymentLinkService.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    removeMolliePaymentLink: vi.fn(async ({ pool, invoice, tenantId, invoiceId }) => {
      if (invoice.status === 'paid') {
        return { error: { status: 409, body: { error: 'Payment link has a paid payment', code: 'payment_link_paid' } } }
      }
      await pool.query(
        'UPDATE invoices SET mollie_payment_link_id = NULL, mollie_payment_link_url = NULL WHERE id = $1 AND tenant_id = $2',
        [invoiceId, tenantId],
      )
      return { invoice: null }
    }),
  }
})

let pool, runMigrations, truncateAll, seedTwoTenants, billingHelpers
let billingSvc, ingestion, tasks, saga, purgeSvc, providerFactory, entSvc, songSvc, guards, credSvc
let seed, fake

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  billingHelpers = await import('./_billing.js')
  billingSvc = await import('../../../server/commerce/billing/billingService.js')
  ingestion = await import('../../../server/commerce/billing/paymentIngestionService.js')
  tasks = await import('../../../server/commerce/billing/jobs/billingTasks.js')
  saga = await import('../../../server/commerce/billing/billingSaga.js')
  purgeSvc = await import('../../../server/commerce/billing/entitlementPurgeService.js')
  entSvc = await import('../../../server/entitlements/entitlementResolver.js')
  songSvc = await import('../../../server/music/songs/songService.js')
  guards = await import('../../../server/entitlements/featureGuards.js')
  credSvc = await import('../../../server/platform/integrations/integrationCredentialService.js')
  providerFactory = await import('../../../server/commerce/billing/paymentProvider/providerFactory.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 999, yearly_price_cents = 9999 WHERE slug = 'silver'")
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 1999, yearly_price_cents = 19999 WHERE slug = 'gold'")
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 1000, yearly_price_cents = 10000 WHERE slug = 'artist_gold'")
  entSvc.clearEntitlementCaches()
  fake = new FakeProvider()
  providerFactory.setPaymentProviderForTests(fake)
})

afterAll(async () => {
  providerFactory.resetPaymentProvider()
  await pool.end()
})

const MB = 1024 * 1024
const userA = () => ({ id: seed.userA.id, email: 'a@test.local', name: 'Alpha User' })

async function planId(slug) {
  const { rows } = await pool.query('SELECT id FROM subscription_plans WHERE slug = $1', [slug])
  return rows[0].id
}
async function subRow(subId) {
  const { rows } = await pool.query('SELECT * FROM subscriptions WHERE id = $1', [subId])
  return rows[0]
}
async function moduleRow(subId, audience) {
  return billingHelpers.getModule(subId, audience)
}
async function paymentIdOf(subId, kind) {
  const { rows } = await pool.query(
    'SELECT mollie_payment_id FROM subscription_payments WHERE subscription_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1',
    [subId, kind],
  )
  return rows[0]?.mollie_payment_id ?? null
}
async function countRows(sql, params) {
  const { rows } = await pool.query(sql, params)
  return rows[0].n
}
const chartCount = (tid) => countRows('SELECT COUNT(*)::int n FROM song_chordpro_charts WHERE tenant_id = $1', [tid])
const fileCount = (tid) => countRows(
  'SELECT (SELECT COUNT(*) FROM song_documents WHERE tenant_id = $1)::int + (SELECT COUNT(*) FROM song_recordings WHERE tenant_id = $1)::int AS n', [tid])
const cleanupCount = (tid) => countRows('SELECT COUNT(*)::int n FROM storage_cleanup_queue WHERE tenant_id = $1', [tid])

// Storage usage is measured from tenant_statistics, not a column on tenants.
async function setTenantStorage(tenantId, bytes) {
  await pool.query(
    `INSERT INTO tenant_statistics (tenant_id, storage_bytes) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET storage_bytes = EXCLUDED.storage_bytes`,
    [tenantId, bytes],
  )
}

// Mutate one plan's entitlements JSONB in the catalog.
async function setPlanEntitlements(slug, mutate) {
  const { rows } = await pool.query('SELECT entitlements FROM subscription_plans WHERE slug = $1', [slug])
  const ent = rows[0].entitlements
  mutate(ent)
  await pool.query('UPDATE subscription_plans SET entitlements = $2 WHERE slug = $1', [slug, ent])
}

// trial → checkout → the combined payment settles → an active subscription.
async function convert(slug = 'gold', { second = null } = {}) {
  const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
  const subId = trial.subscription.id
  if (slug !== 'gold') {
    await billingSvc.changeModule(pool, userA(), {
      audience: 'band', planId: await planId(slug),
    })
  }
  if (second) {
    await billingSvc.changeModule(pool, userA(), { audience: 'artist', planId: await planId('artist_gold') })
  }
  const checkout = await billingSvc.checkout(pool, userA(), { interval: 'month' })
  const verificationId = await paymentIdOf(subId, 'mandate_verification')
  fake.settlePayment(verificationId, 'paid')
  await ingestion.ingestProviderPayment(subId, verificationId)
  const scheduled = await subRow(subId)
  const payId = fake.addRecurringCharge(
    scheduled.mollie_subscription_id, `cst_${fake.custSeq}`, checkout.totalCents,
    { status: 'paid', paidAt: new Date() },
  )
  await ingestion.ingestProviderPayment(subId, payId)
  return subId
}

// The period boundary arrives: age the subscription and let the recurring
// charge settle, which is what makes a scheduled change real.
async function renew(subId, amountCents) {
  const row = await subRow(subId)
  await pool.query(
    'UPDATE subscriptions SET current_period_start = $2, current_period_end = $3 WHERE id = $1',
    [subId, new Date(Date.now() - 40 * 86400000), new Date(Date.now() - 10 * 86400000)],
  )
  const chargeId = fake.addRecurringCharge(row.mollie_subscription_id, 'cst_1', amountCents)
  await ingestion.ingestProviderPayment(subId, chargeId)
  return chargeId
}

// Purgeable data across every category on a tenant, plus integration credentials.
async function seedTenantData(tenantId) {
  const { rows: [song] } = await pool.query(
    'INSERT INTO songs (tenant_id, title, cover_image_path) VALUES ($1, $2, $3) RETURNING id',
    [tenantId, 'Song', `tenants/${tenantId}/song_covers/cover1.webp`])
  await pool.query(
    "INSERT INTO song_chordpro_charts (song_id, tenant_id, name, source) VALUES ($1, $2, 'Chart', '{title: X}')",
    [song.id, tenantId])
  await pool.query(
    `INSERT INTO song_documents (song_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, 'd.pdf', 'application/pdf', 10)`,
    [song.id, tenantId, `tenants/${tenantId}/song_documents/doc1.pdf`])
  await pool.query(
    `INSERT INTO song_recordings (song_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, 'r.mp3', 'audio/mpeg', 10)`,
    [song.id, tenantId, `tenants/${tenantId}/song_recordings/rec1.mp3`])
  await pool.query(
    `UPDATE tenants SET accent_color = '#ff0000', logo_path = $2, banner_path = $3 WHERE id = $1`,
    [tenantId, `tenants/${tenantId}/logo/logo1.png`, `tenants/${tenantId}/banner/banner1.png`])
  await pool.query(
    `INSERT INTO dashboard_tiles (tenant_id, type, image_path, caption)
     VALUES ($1, 'memory_tile', $2, 'Best night')`,
    [tenantId, `tenants/${tenantId}/memory/memory1.jpg`])
  await credSvc.setIntegrationCredential(pool, tenantId, 'mollie_api_key', 'test_dummykey1234567890')
  await credSvc.setIntegrationCredential(pool, tenantId, 'bandsintown_app_id', 'bit_app_id')
  return song.id
}

async function insertLinkedInvoice(tenantId, number, status) {
  const { rows } = await pool.query(
    `INSERT INTO invoices (tenant_id, invoice_number, issue_date, customer_name,
        subtotal_cents, tax_cents, total_cents, status, mollie_payment_link_id)
     VALUES ($1, $2, '2026-06-01', 'Cust', 1000, 210, 1210, $3, $4) RETURNING id`,
    [tenantId, number, status, `pl_${number}`])
  return rows[0].id
}

const setOwner = (tenantId, userId) => billingHelpers.setTenantOwner(tenantId, userId)

describe('preview', () => {
  it('lists purgeable features, never finance, for a gold → silver downgrade', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await convert('gold')
    const res = await billingSvc.previewDowngrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'),
    })
    expect(res.isDowngrade).toBe(true)
    // gold → silver loses custom_slug (not purgeable) and finance (never purged).
    expect(res.features).not.toContain('finance')
  })

  it('previews a REMOVAL against the free floor', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await convert('gold')
    const res = await billingSvc.previewDowngrade(pool, userA(), { audience: 'band', remove: true })
    expect(res.isRemoval).toBe(true)
    expect(res.features.sort()).toEqual(['chordpro', 'customization', 'integrations', 'song_files'])
    expect(res.limitsSnapshot.storage_mb).toBe(50) // the bronze floor
  })

  it('an entitlement override keeps a feature out of the preview and the manifest', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    const subId = await convert('gold')
    const band = await moduleRow(subId, 'band')
    await pool.query(
      `UPDATE subscription_modules SET entitlement_overrides = '{"features":{"chordpro":true}}'::jsonb WHERE id = $1`,
      [band.id])

    const res = await billingSvc.previewDowngrade(pool, userA(), { audience: 'band', remove: true })
    expect(res.features).not.toContain('chordpro')
  })

  it('reports storage and bands blockers against the target limits', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await setTenantStorage(seed.tenantA.id, 400 * MB)
    await convert('gold')

    const res = await billingSvc.previewDowngrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'),
    })
    const storage = res.blockers.find((b) => b.limit === 'storage_mb')
    expect(storage).toMatchObject({ tenantId: seed.tenantA.id, target: 150 })
  })

  it('archived owned tenants count against storage blockers but not the band cap', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await setOwner(seed.tenantB.id, seed.userA.id)
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantB.id])
    await setTenantStorage(seed.tenantB.id, 400 * MB)
    await convert('gold')

    const res = await billingSvc.previewDowngrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'),
    })
    // The archived band is over silver's storage — it could be unarchived onto it.
    expect(res.blockers.some((b) => b.tenantId === seed.tenantB.id && b.limit === 'storage_mb')).toBe(true)
    // ...but only ACTIVE bands count toward the band cap, and silver allows 3.
    expect(res.blockers.some((b) => b.limit === 'bands')).toBe(false)
  })

  it('measures each owned tenant separately against the member limit', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await setOwner(seed.tenantB.id, seed.userA.id)
    // Both bands already carry two approved memberships (the owner and the
    // super admin), so a limit of 2 fits them as they stand.
    await setPlanEntitlements('silver', (ent) => { ent.limits.members = 2 })
    // Only the second band's ROSTER goes over. Roster rows and approved
    // memberships are independent counters and the larger one must fit, so
    // this blocks on 3 roster members while the first band stays clear at 2
    // approved memberships.
    await pool.query(
      `INSERT INTO band_members (tenant_id, name, position, sort_order)
       VALUES ($1, 'Second', 'lead', 1), ($1, 'Third', 'lead', 2)`,
      [seed.tenantB.id])
    await convert('gold')

    const res = await billingSvc.previewDowngrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'),
    })
    expect(res.blockers.filter((b) => b.limit === 'members')).toEqual([
      { tenantId: seed.tenantB.id, tenantName: expect.any(String), limit: 'members', current: 3, target: 2 },
    ])
  })
})

describe('confirmation', () => {
  it('rejects a phrase mismatch and persists nothing', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    const subId = await convert('gold')
    const res = await billingSvc.downgrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'), confirmation: 'yes please',
    })
    expect(res.error.body.code).toBe('confirmation_mismatch')
    expect((await moduleRow(subId, 'band')).pending_change_kind).toBeNull()
  })

  it('accepts the exact phrase for a removal', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    const subId = await convert('gold')
    const res = await billingSvc.downgrade(pool, userA(), {
      audience: 'band', remove: true, confirmation: 'remove band',
    })
    expect(res.error).toBeUndefined()
    expect((await moduleRow(subId, 'band')).status).toBe('pending_removal')
  })

  it('rejects a non-downgrade target with not_a_downgrade', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await convert('silver')
    const res = await billingSvc.downgrade(pool, userA(), {
      audience: 'band', planId: await planId('gold'), confirmation: 'downgrade to gold',
    })
    expect(res.error.body.code).toBe('not_a_downgrade')
  })

  it('409s over_target_limit with blockers and persists nothing', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await setTenantStorage(seed.tenantA.id, 400 * MB)
    const subId = await convert('gold')

    const res = await billingSvc.downgrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'), confirmation: 'downgrade to silver',
    })
    expect(res.error.status).toBe(409)
    expect(res.error.body.code).toBe('over_target_limit')
    expect(res.error.body.blockers.length).toBeGreaterThan(0)
    expect((await moduleRow(subId, 'band')).pending_change_kind).toBeNull()
  })
})

describe('a scheduled downgrade lands at the period boundary', () => {
  it('freezes the manifest, binds limits immediately, and purges nothing yet', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const subId = await convert('gold')

    await billingSvc.downgrade(pool, userA(), {
      audience: 'band', remove: true, confirmation: 'remove band',
    })

    const band = await moduleRow(subId, 'band')
    expect(band.status).toBe('pending_removal')
    expect(band.pending_purge_manifest.features).toContain('chordpro')
    expect(band.downgrade_confirmed_at).not.toBeNull()

    // The snapshot binds capacity growth NOW, while the features stay granted.
    entSvc.clearEntitlementCaches()
    const resolved = await entSvc.resolveTenantEntitlements(pool, seed.tenantA.id)
    expect(resolved.entitlements.features.chordpro).toBe(true)
    expect(resolved.entitlements.limits.storage_mb).toBe(50)
    // Nothing has been deleted — the customer paid for this period.
    expect(await chartCount(seed.tenantA.id)).toBe(1)
  })

  it('re-prices the next renewal and marks the schedule for replacement', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    const subId = await convert('gold')
    await billingSvc.downgrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'), confirmation: 'downgrade to silver',
    })
    const row = await subRow(subId)
    expect(row.next_total_cents).toBe(999)
    // repairSchedule ran inline, so the provider schedule already charges the
    // lower amount at the boundary — no replacement subscription involved.
    expect(fake.subscriptions.get(row.mollie_subscription_id).amountCents).toBe(999)
  })

  it('applies the plan and runs the purge when the renewal is paid', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const subId = await convert('gold')
    // silver keeps chordpro by default; take it away so there is something to purge.
    await setPlanEntitlements('silver', (e) => { e.features.chordpro = false })

    await billingSvc.downgrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'), confirmation: 'downgrade to silver',
    })
    await renew(subId, 999)

    const band = await moduleRow(subId, 'band')
    expect(band.plan_id).toBe(await planId('silver'))
    expect(band.pending_change_kind).toBeNull()
    expect(band.pending_purge_manifest).toBeNull() // consumed
    expect(await chartCount(seed.tenantA.id)).toBe(0)
  })

  it('deletes the module and purges when a REMOVAL reaches the boundary', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const subId = await convert('gold', { second: 'artist' })
    // Pay for the artist module so both are active.
    const proration = await paymentIdOf(subId, 'proration')
    if (proration) {
      fake.settlePayment(proration, 'paid')
      await ingestion.ingestProviderPayment(subId, proration)
    }

    await billingSvc.downgrade(pool, userA(), {
      audience: 'band', remove: true, confirmation: 'remove band',
    })
    await renew(subId, 1000)

    expect(await moduleRow(subId, 'band')).toBeNull()
    expect(await chartCount(seed.tenantA.id)).toBe(0)
    expect(await fileCount(seed.tenantA.id)).toBe(0)
    expect(await cleanupCount(seed.tenantA.id)).toBeGreaterThan(0)
  })

  it('purges NOTHING while the renewal has not been paid', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const subId = await convert('gold')
    await billingSvc.downgrade(pool, userA(), {
      audience: 'band', remove: true, confirmation: 'remove band',
    })

    // The period ends and the charge FAILS: the customer never got the lower
    // tier, so their data stays (fallback-locked, not deleted).
    const row = await subRow(subId)
    const chargeId = fake.addRecurringCharge(row.mollie_subscription_id, 'cst_1', 0, { status: 'open' })
    fake.settlePayment(chargeId, 'failed')
    await ingestion.ingestProviderPayment(subId, chargeId)

    expect((await subRow(subId)).status).toBe('past_due')
    expect(await chartCount(seed.tenantA.id)).toBe(1)
    expect((await moduleRow(subId, 'band')).pending_purge_manifest).not.toBeNull()
  })

  it('an admin plan edit after confirmation can only SHRINK the purge', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const subId = await convert('gold')
    await setPlanEntitlements('silver', (e) => { e.features.chordpro = false })

    await billingSvc.downgrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'), confirmation: 'downgrade to silver',
    })
    // The admin gives chordpro back to silver BEFORE the boundary.
    await setPlanEntitlements('silver', (e) => { e.features.chordpro = true })
    entSvc.clearEntitlementCaches()

    await renew(subId, 999)
    // The frozen manifest still named chordpro, but it is granted now, so it
    // survives. A purge never expands after confirmation.
    expect(await chartCount(seed.tenantA.id)).toBe(1)
  })

  it('resuming a cancelled subscription is independent of a module manifest', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    const subId = await convert('gold')
    await billingSvc.downgrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'), confirmation: 'downgrade to silver',
    })
    await billingSvc.cancelSubscription(pool, seed.userA.id, {})
    expect((await subRow(subId)).cancel_at_period_end).toBe(true)
    await billingSvc.resumeSubscription(pool, seed.userA.id)
    expect((await subRow(subId)).cancel_at_period_end).toBe(false)
    // The scheduled downgrade is untouched by the cancel/resume round trip.
    expect((await moduleRow(subId, 'band')).pending_change_kind).toBe('downgrade')
  })
})

describe('trial downgrades are immediate', () => {
  it('removing a module during a trial purges right away', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })
    await billingSvc.changeModule(pool, userA(), {
      audience: 'artist', planId: await planId('artist_gold'),
    })

    const res = await billingSvc.downgrade(pool, userA(), {
      audience: 'band', remove: true, confirmation: 'remove band',
    })
    expect(res.immediate).toBe(true)
    expect(await moduleRow(trial.subscription.id, 'band')).toBeNull()
    expect(await chartCount(seed.tenantA.id)).toBe(0)
  })

  it('switching to a lower tier during a trial is free and purges what it loses', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    await setPlanEntitlements('silver', (e) => { e.features.chordpro = false })
    const trial = await billingSvc.startTrial(pool, userA(), { audience: 'band' })

    const res = await billingSvc.downgrade(pool, userA(), {
      audience: 'band', planId: await planId('silver'), confirmation: 'downgrade to silver',
    })
    expect(res.immediate).toBe(true)
    const band = await moduleRow(trial.subscription.id, 'band')
    expect(band.plan_id).toBe(await planId('silver'))
    expect(await chartCount(seed.tenantA.id)).toBe(0)
    expect(fake.calls.filter((c) => c === 'createRecurringPayment')).toEqual([]) // free
  })
})

describe('the purge safety net', () => {
  it('finishes a manifest whose inline purge never ran', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const subId = await convert('silver')
    // A module already on its target plan, with the manifest still frozen —
    // exactly the state a crash between the change and the purge leaves.
    await setPlanEntitlements('silver', (e) => { e.features.chordpro = false })
    entSvc.clearEntitlementCaches()
    const band = await moduleRow(subId, 'band')
    await pool.query(
      `UPDATE subscription_modules SET pending_purge_manifest = '{"features":["chordpro"]}'::jsonb WHERE id = $1`,
      [band.id])

    await tasks.reconcilePendingPurges(pool)

    expect(await chartCount(seed.tenantA.id)).toBe(0)
    expect((await moduleRow(subId, 'band')).pending_purge_manifest).toBeNull()
  })

  it('is idempotent — a replayed purge is inert', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const subId = await convert('silver')
    await setPlanEntitlements('silver', (e) => { e.features.chordpro = false })
    entSvc.clearEntitlementCaches()
    const band = await moduleRow(subId, 'band')
    await pool.query(
      `UPDATE subscription_modules SET pending_purge_manifest = '{"features":["chordpro"]}'::jsonb WHERE id = $1`,
      [band.id])

    await purgeSvc.executeModulePurge(pool, { moduleId: band.id })
    const second = await purgeSvc.executeModulePurge(pool, { moduleId: band.id })
    expect(second).toEqual({ purged: false, reason: 'no_manifest' })
  })
})

describe('integrations purge — mollie key retention', () => {
  it('paid links remaining → key retained, hidden from the public status', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    await insertLinkedInvoice(seed.tenantA.id, 'INV-1', 'paid')
    const subId = await convert('gold')

    await billingSvc.downgrade(pool, userA(), {
      audience: 'band', remove: true, confirmation: 'remove band',
    })
    await renew(subId, 0)

    const { rows } = await pool.query(
      'SELECT mollie_api_key_retained_at FROM tenant_integrations WHERE tenant_id = $1', [seed.tenantA.id])
    expect(rows[0].mollie_api_key_retained_at).not.toBeNull()
  })

  it('zero links → key deleted outright', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const subId = await convert('gold')

    await billingSvc.downgrade(pool, userA(), {
      audience: 'band', remove: true, confirmation: 'remove band',
    })
    await renew(subId, 0)

    const { rows } = await pool.query(
      'SELECT mollie_api_key_retained_at FROM tenant_integrations WHERE tenant_id = $1', [seed.tenantA.id])
    expect(rows[0].mollie_api_key_retained_at).toBeNull()
    // Deleted outright, so neither the ordinary accessor nor the retained one
    // can still reach the value.
    expect(await credSvc.loadIntegrationCredential(pool, seed.tenantA.id, 'mollie_api_key')).toBeNull()
    expect(await credSvc.loadRetainedIntegrationCredential(pool, seed.tenantA.id, 'mollie_api_key')).toBeNull()
  })
})

describe('feature-write guard', () => {
  it('blocks a purgeable-feature write once the feature is durably lost', async () => {
    await setOwner(seed.tenantA.id, seed.userA.id)
    const songId = await seedTenantData(seed.tenantA.id)
    const subId = await convert('gold')
    await billingSvc.downgrade(pool, userA(), {
      audience: 'band', remove: true, confirmation: 'remove band',
    })
    await renew(subId, 0)
    entSvc.clearEntitlementCaches()

    await expect(guards.withFeatureWriteGuard(pool, seed.tenantA.id, 'chordpro', async () => {
      await pool.query(
        "INSERT INTO song_chordpro_charts (song_id, tenant_id, name, source) VALUES ($1, $2, 'X', '{}')",
        [songId, seed.tenantA.id])
    })).rejects.toThrow()
  })

  it('passes for an ownerless tenant (enforcement skipped)', async () => {
    const songId = await seedTenantData(seed.tenantA.id)
    await guards.withFeatureWriteGuard(pool, seed.tenantA.id, 'chordpro', async () => {
      await pool.query(
        "INSERT INTO song_chordpro_charts (song_id, tenant_id, name, source) VALUES ($1, $2, 'Y', '{}')",
        [songId, seed.tenantA.id])
    })
    // The write went through: an ownerless tenant skips enforcement entirely.
    expect(await chartCount(seed.tenantA.id)).toBe(2)
    expect(songSvc).toBeDefined()
  })
})

describe('cancelRemoteSubscription lookup failures', () => {
  it('a transient status-lookup error still issues the idempotent cancel', async () => {
    const subId = await convert('gold')
    const row = await subRow(subId)
    const providerSubId = row.mollie_subscription_id
    // The lookup fails; the cancel must still go out, because a failed lookup
    // must never be read as "already canceled".
    const originalGet = fake.getSchedule.bind(fake)
    fake.getSchedule = async () => { throw new Error('boom') }

    await saga.cancelRemoteSubscription(pool, row)
    fake.getSchedule = originalGet

    expect(fake.subscriptions.get(providerSubId).status).toBe('canceled')
  })
})
