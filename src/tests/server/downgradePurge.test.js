import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'
import { FakeProvider } from './_fakeProvider.js'

// The integrations purge calls removeMolliePaymentLink, which talks to the
// real Mollie API with the tenant's key. Fake just that function: an unpaid
// link is removed (columns cleared), a paid link 409s and stays — the exact
// contract the purge's retain-vs-delete decision depends on.
vi.mock('../../../server/services/molliePaymentLinkService.js', async (importOriginal) => {
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
let billingSvc, ingestion, tasks, saga, providerFactory, entSvc, songSvc, guards, stats, credSvc, profileSvc
let seed, fake

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  billingHelpers = await import('./_billing.js')
  billingSvc = await import('../../../server/services/billingService.js')
  ingestion = await import('../../../server/services/paymentIngestionService.js')
  tasks = await import('../../../server/jobs/billingTasks.js')
  saga = await import('../../../server/services/billingSaga.js')
  entSvc = await import('../../../server/services/entitlementService.js')
  songSvc = await import('../../../server/services/songService.js')
  guards = await import('../../../server/services/featureGuards.js')
  stats = await import('../../../server/services/statisticsService.js')
  credSvc = await import('../../../server/services/integrationCredentialService.js')
  profileSvc = await import('../../../server/services/profileService.js')
  providerFactory = await import('../../../server/billing/paymentProvider/index.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 999, yearly_price_cents = 9999 WHERE slug = 'silver'")
  await pool.query("UPDATE subscription_plans SET monthly_price_cents = 1999, yearly_price_cents = 19999 WHERE slug = 'gold'")
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
async function paymentIdOf(subId, kind) {
  const { rows } = await pool.query(
    'SELECT mollie_payment_id FROM subscription_payments WHERE subscription_id = $1 AND kind = $2 ORDER BY id DESC LIMIT 1',
    [subId, kind],
  )
  return rows[0]?.mollie_payment_id ?? null
}
async function notifCount(userId, type) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int n FROM notifications WHERE user_id = $1 AND type = $2', [userId, type])
  return rows[0].n
}
async function countRows(sql, params) {
  const { rows } = await pool.query(sql, params)
  return rows[0].n
}
const chartCount = (tid) => countRows('SELECT COUNT(*)::int n FROM song_chordpro_charts WHERE tenant_id = $1', [tid])
const fileCount = (tid) => countRows(
  'SELECT (SELECT COUNT(*) FROM song_documents WHERE tenant_id = $1)::int + (SELECT COUNT(*) FROM song_recordings WHERE tenant_id = $1)::int AS n', [tid])
const cleanupCount = (tid) => countRows('SELECT COUNT(*)::int n FROM storage_cleanup_queue WHERE tenant_id = $1', [tid])

// Mutate one plan's entitlements JSONB in the catalog.
async function setPlanEntitlements(slug, mutate) {
  const { rows } = await pool.query('SELECT entitlements FROM subscription_plans WHERE slug = $1', [slug])
  const ent = rows[0].entitlements
  mutate(ent)
  await pool.query('UPDATE subscription_plans SET entitlements = $2 WHERE slug = $1', [slug, ent])
}

// subscribe → mandate paid (trialing) → optional first recurring charge (active)
async function subscribeUser(slug, { activate = true } = {}) {
  const price = slug === 'gold' ? 1999 : 999
  const res = await billingSvc.subscribe(pool, userA(), { planId: await planId(slug), interval: 'month' })
  const subId = res.subscriptionId
  const mandateId = await paymentIdOf(subId, 'mandate_verification')
  fake.settlePayment(mandateId, 'paid')
  await ingestion.ingestProviderPayment(subId, mandateId)
  if (activate) {
    const providerSubId = (await subRow(subId)).mollie_subscription_id
    const chargeId = fake.addRecurringCharge(providerSubId, 'cst_1', price)
    await ingestion.ingestProviderPayment(subId, chargeId)
  }
  return subId
}

// Purgeable data across every category on a tenant, plus the legacy mollie key.
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
    `UPDATE tenants SET accent_color = '#ff0000', logo_path = $2, banner_path = $3,
        memory_image_path = $4, memory_caption = 'Best night',
        mollie_api_key = 'test_dummykey1234567890', bandsintown_app_id = 'bit_app_id' WHERE id = $1`,
    [tenantId, `tenants/${tenantId}/logo/logo1.png`, `tenants/${tenantId}/banner/banner1.png`,
      `tenants/${tenantId}/memory/memory1.jpg`])
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
  it('lists purgeable features, never finance, for a gold → bronze downgrade', async () => {
    await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    const res = await billingSvc.previewDowngrade(pool, userA(), { planId: await planId('bronze'), interval: 'month' })
    expect(res.isDowngrade).toBe(true)
    expect(res.isFreeFallback).toBe(true)
    expect(res.features).toEqual(['integrations', 'customization', 'song_files', 'chordpro'])
    expect(res.features).not.toContain('finance')
    expect(res.limitsSnapshot.storage_mb).toBe(50)
    expect(res.blockers).toEqual([])
  })

  it('an entitlement override keeps a feature out of the preview and the manifest', async () => {
    const subId = await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    await pool.query(
      `UPDATE subscriptions SET entitlement_overrides = '{"features":{"song_files":true}}' WHERE id = $1`, [subId])
    const res = await billingSvc.previewDowngrade(pool, userA(), { planId: await planId('bronze'), interval: 'month' })
    expect(res.features).not.toContain('song_files')
    expect(res.features).toContain('chordpro')
  })

  it('reports storage and bands blockers against the target limits', async () => {
    await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    await setOwner(seed.tenantB.id, seed.userA.id)
    await pool.query(
      'INSERT INTO tenant_statistics (tenant_id, storage_bytes, object_count) VALUES ($1, $2, 3)',
      [seed.tenantA.id, 60 * MB])
    const res = await billingSvc.previewDowngrade(pool, userA(), { planId: await planId('bronze'), interval: 'month' })
    const limits = res.blockers.map((b) => b.limit)
    expect(limits).toContain('bands') // 2 owned > bronze 1
    expect(limits).toContain('storage_mb') // 60MB > bronze 50MB
  })

  it('archived owned tenants count against member/storage blockers but not the band cap', async () => {
    await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    await setOwner(seed.tenantB.id, seed.userA.id)
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantB.id])
    await pool.query(
      'INSERT INTO tenant_statistics (tenant_id, storage_bytes, object_count) VALUES ($1, $2, 3)',
      [seed.tenantB.id, 60 * MB])
    const res = await billingSvc.previewDowngrade(pool, userA(), { planId: await planId('bronze'), interval: 'month' })
    // An archived band can be unarchived onto the lower plan, so its usage must
    // block; archiving IS the documented way to satisfy the band cap itself.
    expect(res.blockers.map((b) => `${b.tenantId}:${b.limit}`)).toContain(`${seed.tenantB.id}:storage_mb`)
    expect(res.blockers.map((b) => b.limit)).not.toContain('bands') // 1 active ≤ bronze 1
  })

  it('rejects an inactive target plan (404) and a NULL-priced interval (plan_not_priced)', async () => {
    await subscribeUser('gold')
    await pool.query("UPDATE subscription_plans SET is_active = FALSE WHERE slug = 'silver'")
    const inactive = await billingSvc.previewDowngrade(pool, userA(), { planId: await planId('silver'), interval: 'month' })
    expect(inactive.error.status).toBe(404)

    await pool.query("UPDATE subscription_plans SET is_active = TRUE, yearly_price_cents = NULL WHERE slug = 'silver'")
    const unpriced = await billingSvc.previewDowngrade(pool, userA(), { planId: await planId('silver'), interval: 'year' })
    expect(unpriced.error.status).toBe(400)
    expect(unpriced.error.body.code).toBe('plan_not_priced')
  })
})

describe('downgrade validation', () => {
  it('rejects a confirmation phrase mismatch and persists nothing', async () => {
    const subId = await subscribeUser('gold')
    const res = await billingSvc.downgrade(pool, userA(), {
      planId: await planId('bronze'), interval: 'month', confirmation: 'downgrade to silver',
    })
    expect(res.error.status).toBe(400)
    expect(res.error.body.code).toBe('confirmation_mismatch')
    const row = await subRow(subId)
    expect(row.pending_purge_manifest).toBeNull()
    expect(row.cancel_at_period_end).toBe(false)
  })

  it('rejects a non-downgrade target with not_a_downgrade', async () => {
    await subscribeUser('gold')
    // Same plan, other interval: an interval switch, not a downgrade.
    const res = await billingSvc.downgrade(pool, userA(), {
      planId: await planId('gold'), interval: 'year', confirmation: 'downgrade to gold',
    })
    expect(res.error.status).toBe(400)
    expect(res.error.body.code).toBe('not_a_downgrade')
  })

  it('409s over_target_limit with blockers and persists nothing', async () => {
    const subId = await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    await pool.query(
      'INSERT INTO tenant_statistics (tenant_id, storage_bytes, object_count) VALUES ($1, $2, 3)',
      [seed.tenantA.id, 60 * MB])
    const res = await billingSvc.downgrade(pool, userA(), {
      planId: await planId('bronze'), interval: 'month', confirmation: 'downgrade to bronze',
    })
    expect(res.error.status).toBe(409)
    expect(res.error.body.code).toBe('over_target_limit')
    expect(res.error.body.blockers.length).toBeGreaterThan(0)
    expect((await subRow(subId)).pending_purge_manifest).toBeNull()
  })

  it('409s while another plan change is pending', async () => {
    await subscribeUser('silver')
    await billingSvc.changePlan(pool, userA(), { planId: await planId('gold'), interval: 'month' })
    const res = await billingSvc.downgrade(pool, userA(), {
      planId: await planId('bronze'), interval: 'month', confirmation: 'downgrade to bronze',
    })
    expect(res.error.status).toBe(409)
    expect(res.error.body.code).toBe('plan_change_in_progress')
  })
})

describe('free-fallback (bronze) downgrade', () => {
  it('schedules cancel-at-period-end with a frozen manifest and binds limits immediately', async () => {
    const subId = await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const providerSubId = (await subRow(subId)).mollie_subscription_id

    const res = await billingSvc.downgrade(pool, userA(), {
      planId: await planId('bronze'), interval: 'month', confirmation: 'Downgrade to Bronze  ',
    })
    expect(res.scheduled).toBe(true)
    expect(res.immediate).toBe(false)

    const row = await subRow(subId)
    expect(row.cancel_at_period_end).toBe(true)
    expect(row.pending_plan_id).toBeNull() // fallback path never sets a pending change
    expect(row.pending_purge_manifest.features).toEqual(['integrations', 'customization', 'song_files', 'chordpro'])
    expect(row.downgrade_confirmed_at).not.toBeNull()
    expect(fake.subscriptions.get(providerSubId).status).toBe('canceled')

    // Nothing purged yet; capacity growth already bound to the bronze snapshot.
    expect(await chartCount(seed.tenantA.id)).toBe(1)
    const resolved = await entSvc.resolveTenantEntitlements(pool, seed.tenantA.id)
    expect(resolved.entitlements.limits.storage_mb).toBe(50)
    expect(resolved.entitlements.features.song_files).toBe(true) // features stay until period end
    expect(await notifCount(seed.userA.id, 'billing-downgrade-scheduled')).toBe(1)
  })

  it('purges exactly the manifest at period end; finance and other tenants survive', async () => {
    const subId = await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    await seedTenantData(seed.tenantB.id) // ownerless neighbour tenant — must be untouched
    await billingHelpers.createFinanceData(seed.tenantA.id)

    await billingSvc.downgrade(pool, userA(), {
      planId: await planId('bronze'), interval: 'month', confirmation: 'downgrade to bronze',
    })
    await pool.query("UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '1 hour' WHERE id = $1", [subId])
    await tasks.reconcileCancelAtPeriodEnd(pool)

    const row = await subRow(subId)
    expect(row.status).toBe('canceled')
    expect(row.pending_purge_manifest).toBeNull() // consumed

    expect(await chartCount(seed.tenantA.id)).toBe(0)
    expect(await fileCount(seed.tenantA.id)).toBe(0)
    expect(await cleanupCount(seed.tenantA.id)).toBe(5) // doc + recording + banner + memory image + song cover queued for S3
    const { rows: [tenant] } = await pool.query(
      'SELECT accent_color, logo_path, banner_path, memory_image_path, memory_caption, mollie_api_key, bandsintown_app_id FROM tenants WHERE id = $1', [seed.tenantA.id])
    expect(tenant.accent_color).toBeNull()
    expect(tenant.banner_path).toBeNull()
    expect(tenant.memory_image_path).toBeNull()
    expect(tenant.memory_caption).toBeNull()
    // Song covers are customization data and are purged with it.
    const { rows: [coverSong] } = await pool.query(
      'SELECT cover_image_path FROM songs WHERE tenant_id = $1', [seed.tenantA.id])
    expect(coverSong.cover_image_path).toBeNull()
    // Band logos are settable on every plan and are never purged.
    expect(tenant.logo_path).toBe(`tenants/${seed.tenantA.id}/logo/logo1.png`)
    expect(tenant.mollie_api_key).toBeNull() // no payment links → key deleted
    expect(tenant.bandsintown_app_id).toBeNull()

    // Finance is never purged; the other tenant is untouched.
    expect(await countRows('SELECT COUNT(*)::int n FROM ledger_transactions WHERE tenant_id = $1', [seed.tenantA.id])).toBe(1)
    expect(await chartCount(seed.tenantB.id)).toBe(1)
    expect(await fileCount(seed.tenantB.id)).toBe(2)
  })

  it('archived owned tenants are purged too — their data and secrets do not survive unarchive', async () => {
    const subId = await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    await setOwner(seed.tenantB.id, seed.userA.id)
    await seedTenantData(seed.tenantB.id)
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantB.id])

    await billingSvc.downgrade(pool, userA(), {
      planId: await planId('bronze'), interval: 'month', confirmation: 'downgrade to bronze',
    })
    await pool.query("UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '1 hour' WHERE id = $1", [subId])
    await tasks.reconcileCancelAtPeriodEnd(pool)

    expect(await chartCount(seed.tenantB.id)).toBe(0)
    expect(await fileCount(seed.tenantB.id)).toBe(0)
    expect(await cleanupCount(seed.tenantB.id)).toBe(5)
    const { rows: [tenant] } = await pool.query(
      'SELECT accent_color, logo_path, banner_path, memory_image_path, mollie_api_key, bandsintown_app_id FROM tenants WHERE id = $1', [seed.tenantB.id])
    expect(tenant.accent_color).toBeNull()
    expect(tenant.banner_path).toBeNull()
    expect(tenant.memory_image_path).toBeNull()
    expect(tenant.logo_path).toBe(`tenants/${seed.tenantB.id}/logo/logo1.png`) // logos survive the purge
    expect(tenant.mollie_api_key).toBeNull()
    expect(tenant.bandsintown_app_id).toBeNull()
  })

  it('resume before period end clears the manifest and snapshot', async () => {
    const subId = await subscribeUser('gold')
    await billingSvc.downgrade(pool, userA(), {
      planId: await planId('bronze'), interval: 'month', confirmation: 'downgrade to bronze',
    })
    const res = await billingSvc.resumeSubscription(pool, seed.userA.id)
    expect(res.resumed).toBe(true)
    const row = await subRow(subId)
    expect(row.cancel_at_period_end).toBe(false)
    expect(row.pending_purge_manifest).toBeNull()
    expect(row.pending_limits_snapshot).toBeNull()
  })
})

describe('paid-lower downgrade', () => {
  // Make gold → silver lose song_files + chordpro so the purge has real work.
  async function confirmPaidDowngrade() {
    await setPlanEntitlements('silver', (ent) => {
      ent.features.song_files = false
      ent.features.chordpro = false
    })
    const subId = await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    const songId = await seedTenantData(seed.tenantA.id)
    const oldProviderSubId = (await subRow(subId)).mollie_subscription_id
    const res = await billingSvc.downgrade(pool, userA(), {
      planId: await planId('silver'), interval: 'month', confirmation: 'downgrade to silver',
    })
    expect(res.scheduled).toBe(true)
    return { subId, songId, oldProviderSubId }
  }

  it('confirm repoints to a replacement subscription and cancels the old one', async () => {
    const { subId, oldProviderSubId } = await confirmPaidDowngrade()
    const row = await subRow(subId)
    expect(row.pending_change_kind).toBe('downgrade')
    expect(row.pending_purge_manifest.features).toEqual(['song_files', 'chordpro'])
    expect(row.downgrade_schedule_pending).toBe(false) // inline saga finished
    expect(row.superseded_mollie_subscription_id).toBeNull()
    expect(row.mollie_subscription_id).not.toBe(oldProviderSubId)
    expect(fake.subscriptions.get(oldProviderSubId).status).toBe('canceled')
    expect(fake.subscriptions.get(row.mollie_subscription_id).status).toBe('active')
    // Plan and data unchanged until the replacement pays.
    expect(row.plan_id).toBe(await planId('gold'))
    expect(await chartCount(seed.tenantA.id)).toBe(1)
  })

  it('a late old-schedule charge is recorded only — no activation, no period advance [B6]', async () => {
    const { subId, oldProviderSubId } = await confirmPaidDowngrade()
    const before = await subRow(subId)
    // Simulate the pre-repoint window too: superseded still set and current id = old id.
    await pool.query(
      'UPDATE subscriptions SET mollie_subscription_id = $2, superseded_mollie_subscription_id = $2, downgrade_schedule_pending = TRUE WHERE id = $1',
      [subId, oldProviderSubId])
    const lateId = fake.addRecurringCharge(oldProviderSubId, 'cst_1', 1999, { paidAt: new Date(Date.now() + 60_000) })
    await ingestion.ingestProviderPayment(subId, lateId)
    const row = await subRow(subId)
    expect(row.plan_id).toBe(await planId('gold'))
    expect(row.pending_change_kind).toBe('downgrade')
    expect(new Date(row.current_period_end).getTime()).toBe(new Date(before.current_period_end).getTime())
    expect(await chartCount(seed.tenantA.id)).toBe(1)
  })

  it('period end flips to pending_activation without purging', async () => {
    const { subId } = await confirmPaidDowngrade()
    await pool.query("UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '1 hour' WHERE id = $1", [subId])
    await tasks.reconcilePendingDowngrades(pool)
    const row = await subRow(subId)
    expect(row.status).toBe('pending_activation')
    expect(row.pending_activation_at).not.toBeNull()
    expect(row.pending_purge_manifest).not.toBeNull()
    expect(await chartCount(seed.tenantA.id)).toBe(1)
    // Fallback-locked while waiting: the resolver denies paid access.
    const resolved = await entSvc.resolveTenantEntitlements(pool, seed.tenantA.id)
    expect(resolved.locked).toBe(true)
  })

  it('a failed replacement charge is NOT terminal; a later paid retry activates exactly once [P1-3/R1]', async () => {
    const { subId } = await confirmPaidDowngrade()
    const replacementId = (await subRow(subId)).mollie_subscription_id
    await pool.query("UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '1 hour' WHERE id = $1", [subId])
    await tasks.reconcilePendingDowngrades(pool)

    // First attempt fails → stay pending_activation, manifest kept, notified.
    const failId = fake.addRecurringCharge(replacementId, 'cst_1', 999, { status: 'failed' })
    await ingestion.ingestProviderPayment(subId, failId)
    let row = await subRow(subId)
    expect(row.status).toBe('pending_activation')
    expect(row.pending_purge_manifest).not.toBeNull()
    expect(await notifCount(seed.userA.id, 'billing-payment-failed')).toBe(1)

    // Later retry pays → activate + purge, exactly once.
    const paidId = fake.addRecurringCharge(replacementId, 'cst_1', 999)
    await ingestion.ingestProviderPayment(subId, paidId)
    await ingestion.ingestProviderPayment(subId, paidId) // replay is inert
    row = await subRow(subId)
    expect(row.status).toBe('active')
    expect(row.plan_id).toBe(await planId('silver'))
    expect(row.price_cents).toBe(999)
    expect(row.pending_change_kind).toBeNull()
    expect(row.pending_purge_manifest).toBeNull()
    expect(await notifCount(seed.userA.id, 'billing-plan-changed')).toBe(1)
    // Purge ran: song files + charts gone, customization (kept by silver) intact.
    expect(await chartCount(seed.tenantA.id)).toBe(0)
    expect(await fileCount(seed.tenantA.id)).toBe(0)
    const { rows: [tenant] } = await pool.query('SELECT accent_color FROM tenants WHERE id = $1', [seed.tenantA.id])
    expect(tenant.accent_color).toBe('#ff0000')
  })

  it('a paid charge from an unrelated subscription never activates the downgrade [R1]', async () => {
    const { subId } = await confirmPaidDowngrade()
    fake.subscriptions.set('sub_foreign', { id: 'sub_foreign', status: 'active', nextPaymentDate: null })
    const strayId = fake.addRecurringCharge('sub_foreign', 'cst_1', 999)
    await ingestion.ingestProviderPayment(subId, strayId)
    const row = await subRow(subId)
    expect(row.plan_id).toBe(await planId('gold'))
    expect(row.pending_change_kind).toBe('downgrade')
    expect(await chartCount(seed.tenantA.id)).toBe(1)
  })

  it('exhausted retries finalize the failed downgrade: state cleared, NOTHING purged [R9]', async () => {
    const { subId } = await confirmPaidDowngrade()
    const replacementId = (await subRow(subId)).mollie_subscription_id
    await pool.query("UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '9 days' WHERE id = $1", [subId])
    await tasks.reconcilePendingDowngrades(pool)
    await pool.query("UPDATE subscriptions SET pending_activation_at = NOW() - INTERVAL '8 days' WHERE id = $1", [subId])

    await tasks.reconcileStaleSignups(pool)
    const row = await subRow(subId)
    expect(row.status).toBe('canceled')
    expect(row.cancel_reason).toBe('payment_failed')
    expect(row.pending_change_kind).toBeNull()
    expect(row.pending_purge_manifest).toBeNull()
    expect(row.pending_limits_snapshot).toBeNull()
    expect(row.downgrade_schedule_pending).toBe(false)
    expect(row.superseded_mollie_subscription_id).toBeNull()
    expect(fake.subscriptions.get(replacementId).status).toBe('canceled')
    // Data intact — the customer never received the lower tier.
    expect(await chartCount(seed.tenantA.id)).toBe(1)
    expect(await fileCount(seed.tenantA.id)).toBe(2)
  })

  it('a resumed saga cancels the OLD subscription, never the replacement [B2]', async () => {
    const { subId, oldProviderSubId } = await confirmPaidDowngrade()
    const replacementId = (await subRow(subId)).mollie_subscription_id
    // Simulate a crash after create but before the atomic repoint: the durable
    // marker and superseded id are still set.
    await pool.query(
      'UPDATE subscriptions SET downgrade_schedule_pending = TRUE, superseded_mollie_subscription_id = $2 WHERE id = $1',
      [subId, oldProviderSubId])
    await saga.scheduleDowngradeReplacement(pool, subId)
    const row = await subRow(subId)
    expect(row.mollie_subscription_id).toBe(replacementId)
    expect(row.downgrade_schedule_pending).toBe(false)
    expect(row.superseded_mollie_subscription_id).toBeNull()
    expect(fake.subscriptions.get(replacementId).status).toBe('active') // never canceled
    expect(fake.subscriptions.get(oldProviderSubId).status).toBe('canceled')
    // The create op was skipped on its idempotency key — only one replacement exists.
    expect([...fake.subscriptions.keys()].filter((id) => fake.subscriptions.get(id).status === 'active')).toEqual([replacementId])
  })

  it('an admin plan edit after confirmation can only SHRINK the purge [R7]', async () => {
    const { subId } = await confirmPaidDowngrade() // manifest = [song_files, chordpro]
    // Admin re-enables chordpro on silver (purge shrinks) and turns
    // customization off (purge must NOT expand to it — not in the manifest).
    await setPlanEntitlements('silver', (ent) => {
      ent.features.chordpro = true
      ent.features.customization = false
    })
    const replacementId = (await subRow(subId)).mollie_subscription_id
    const paidId = fake.addRecurringCharge(replacementId, 'cst_1', 999)
    await ingestion.ingestProviderPayment(subId, paidId)

    expect(await fileCount(seed.tenantA.id)).toBe(0) // song_files: still off → purged
    expect(await chartCount(seed.tenantA.id)).toBe(1) // chordpro: back on → spared
    const { rows: [tenant] } = await pool.query('SELECT accent_color FROM tenants WHERE id = $1', [seed.tenantA.id])
    expect(tenant.accent_color).toBe('#ff0000') // customization: not in the manifest → untouched
  })

  it('a user cancel racing the schedule saga cancels the replacement and never repoints', async () => {
    await setPlanEntitlements('silver', (ent) => { ent.features.chordpro = false })
    const subId = await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    const oldProviderSubId = (await subRow(subId)).mollie_subscription_id

    // The user cancels while the saga is between its two remote calls: the old
    // subscription is already canceled and the replacement is being created.
    const realCreate = fake.createSubscription.bind(fake)
    let cancelRes
    fake.createSubscription = async (args) => {
      fake.createSubscription = realCreate
      cancelRes = await billingSvc.cancelSubscription(pool, seed.userA.id)
      return realCreate(args)
    }
    const res = await billingSvc.downgrade(pool, userA(), {
      planId: await planId('silver'), interval: 'month', confirmation: 'downgrade to silver',
    })
    expect(res.scheduled).toBe(true)
    expect(cancelRes.canceled).toBe(true)

    const row = await subRow(subId)
    expect(row.cancel_at_period_end).toBe(true)
    expect(row.pending_change_kind).toBeNull()
    expect(row.mollie_subscription_id).toBe(oldProviderSubId) // never repointed
    // Every provider subscription is canceled — the replacement must not charge.
    for (const s of fake.subscriptions.values()) expect(s.status).toBe('canceled')
  })

  it('a replacement first charge that beats the saga repoint still activates the downgrade', async () => {
    const { subId, oldProviderSubId } = await confirmPaidDowngrade()
    const replacementId = (await subRow(subId)).mollie_subscription_id
    // Rewind local state to the pre-repoint window (crash after the remote
    // create): current id and superseded id are both still the old schedule.
    await pool.query(
      'UPDATE subscriptions SET mollie_subscription_id = $2, superseded_mollie_subscription_id = $2, downgrade_schedule_pending = TRUE WHERE id = $1',
      [subId, oldProviderSubId])

    const paidId = fake.addRecurringCharge(replacementId, 'cst_1', 999)
    await ingestion.ingestProviderPayment(subId, paidId)

    const row = await subRow(subId)
    expect(row.status).toBe('active')
    expect(row.plan_id).toBe(await planId('silver'))
    expect(row.mollie_subscription_id).toBe(replacementId) // activation repointed
    expect(row.downgrade_schedule_pending).toBe(false)
    expect(row.superseded_mollie_subscription_id).toBeNull()
    expect(row.pending_purge_manifest).toBeNull()
    expect(await chartCount(seed.tenantA.id)).toBe(0) // purge ran

    // The resumed saga is a no-op and never cancels the replacement.
    await saga.scheduleDowngradeReplacement(pool, subId)
    expect(fake.subscriptions.get(replacementId).status).toBe('active')
  })

  it('user cancel while the downgrade is pending clears all downgrade state', async () => {
    const { subId } = await confirmPaidDowngrade()
    const res = await billingSvc.cancelSubscription(pool, seed.userA.id)
    expect(res.canceled).toBe(true)
    const row = await subRow(subId)
    expect(row.pending_change_kind).toBeNull()
    expect(row.pending_purge_manifest).toBeNull()
    expect(row.downgrade_schedule_pending).toBe(false)
    expect(row.superseded_mollie_subscription_id).toBeNull()
  })
})

describe('trial downgrades [B3]', () => {
  it('trial → bronze cancels immediately and executes the manifest', async () => {
    const subId = await subscribeUser('gold', { activate: false }) // trialing
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const res = await billingSvc.downgrade(pool, userA(), {
      planId: await planId('bronze'), interval: 'month', confirmation: 'downgrade to bronze',
    })
    expect(res.immediate).toBe(true)
    const row = await subRow(subId)
    expect(row.status).toBe('canceled')
    expect(row.pending_purge_manifest).toBeNull() // consumed by the immediate purge
    expect(await chartCount(seed.tenantA.id)).toBe(0)
    expect(await fileCount(seed.tenantA.id)).toBe(0)
  })

  it('trial → paid lower switches free, recreates the schedule, and purges lost features', async () => {
    await setPlanEntitlements('silver', (ent) => { ent.features.song_files = false })
    const subId = await subscribeUser('gold', { activate: false })
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    const res = await billingSvc.downgrade(pool, userA(), {
      planId: await planId('silver'), interval: 'month', confirmation: 'downgrade to silver',
    })
    expect(res.immediate).toBe(true)
    const row = await subRow(subId)
    expect(row.status).toBe('trialing')
    expect(row.plan_id).toBe(await planId('silver'))
    expect(row.price_cents).toBe(999)
    expect(row.mollie_schedule_stale).toBe(false) // repaired post-commit
    expect(row.pending_purge_manifest).toBeNull()
    expect(await fileCount(seed.tenantA.id)).toBe(0) // song_files purged
    expect(await chartCount(seed.tenantA.id)).toBe(1) // chordpro kept by silver
  })
})

describe('integrations purge — mollie key retention [B4]', () => {
  async function bronzeAndFinalize(subId) {
    await billingSvc.downgrade(pool, userA(), {
      planId: await planId('bronze'), interval: 'month', confirmation: 'downgrade to bronze',
    })
    await pool.query("UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '1 hour' WHERE id = $1", [subId])
    await tasks.reconcileCancelAtPeriodEnd(pool)
  }

  it('paid links remaining → key retained: public status absent, internal accessor still works', async () => {
    const subId = await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    await insertLinkedInvoice(seed.tenantA.id, 'INV-PAID-1', 'paid')
    await insertLinkedInvoice(seed.tenantA.id, 'INV-OPEN-1', 'sent')
    await bronzeAndFinalize(subId)

    const { rows: [tenant] } = await pool.query(
      'SELECT mollie_api_key, mollie_api_key_retained_at FROM tenants WHERE id = $1', [seed.tenantA.id])
    expect(tenant.mollie_api_key).toBe('test_dummykey1234567890') // value kept
    expect(tenant.mollie_api_key_retained_at).not.toBeNull()

    // Unpaid link was removed; the paid one stays.
    expect(await countRows(
      'SELECT COUNT(*)::int n FROM invoices WHERE tenant_id = $1 AND mollie_payment_link_id IS NOT NULL',
      [seed.tenantA.id])).toBe(1)

    const status = await profileSvc.getMollieKeyStatus(pool, seed.tenantA.id)
    expect(status.isSet).toBe(false) // public: absent
    expect(await credSvc.loadIntegrationCredential(pool, seed.tenantA.id, 'mollie_api_key')).toBeNull()
    expect(await credSvc.loadRetainedIntegrationCredential(pool, seed.tenantA.id, 'mollie_api_key'))
      .toBe('test_dummykey1234567890')

    // Storing a new key clears the retention marker.
    await pool.query('UPDATE tenants SET owner_user_id = NULL WHERE id = $1', [seed.tenantA.id]) // lift the gate for the set
    entSvc.clearEntitlementCaches()
    const set = await profileSvc.setMollieKeyValue(pool, seed.tenantA.id, { key: 'test_abcdefghijklmnopqrstuvwxyz12345' })
    expect(set.status.isSet).toBe(true)
    const { rows: [after] } = await pool.query(
      'SELECT mollie_api_key_retained_at FROM tenants WHERE id = $1', [seed.tenantA.id])
    expect(after.mollie_api_key_retained_at).toBeNull()
  })

  it('zero links → key deleted outright', async () => {
    const subId = await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    await seedTenantData(seed.tenantA.id)
    await insertLinkedInvoice(seed.tenantA.id, 'INV-OPEN-2', 'sent') // unpaid only
    await bronzeAndFinalize(subId)

    const { rows: [tenant] } = await pool.query(
      'SELECT mollie_api_key, mollie_api_key_encrypted, mollie_api_key_retained_at FROM tenants WHERE id = $1',
      [seed.tenantA.id])
    expect(tenant.mollie_api_key).toBeNull()
    expect(tenant.mollie_api_key_encrypted).toBeNull()
    expect(tenant.mollie_api_key_retained_at).toBeNull()
  })
})

describe('feature-write guard [B7]', () => {
  it('blocks a purgeable-feature write after the feature is durably lost, queuing the orphan object', async () => {
    const subId = await subscribeUser('gold')
    await setOwner(seed.tenantA.id, seed.userA.id)
    const songId = await seedTenantData(seed.tenantA.id)
    await billingSvc.downgrade(pool, userA(), {
      planId: await planId('bronze'), interval: 'month', confirmation: 'downgrade to bronze',
    })
    await pool.query("UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '1 hour' WHERE id = $1", [subId])
    await tasks.reconcileCancelAtPeriodEnd(pool)
    entSvc.clearEntitlementCaches()

    // Service-level: the chart insert re-checks in-transaction and aborts.
    await expect(songSvc.createSongChart(pool, seed.tenantA.id, songId, { name: 'x', source: '{title: y}' }))
      .rejects.toMatchObject({ code: 'entitlement_required', status: 403 })
    expect(await chartCount(seed.tenantA.id)).toBe(0)

    // Guard-level with an already-uploaded object: enqueue instead of orphan.
    const fn = vi.fn()
    const orphanKey = `tenants/${seed.tenantA.id}/song_documents/orphan.pdf`
    await expect(guards.withFeatureWriteGuard(pool, seed.tenantA.id, 'song_files', fn, { orphanKey }))
      .rejects.toMatchObject({ code: 'entitlement_required' })
    expect(fn).not.toHaveBeenCalled()
    expect(await countRows(
      'SELECT COUNT(*)::int n FROM storage_cleanup_queue WHERE object_key = $1 AND release_reservation = TRUE',
      [orphanKey])).toBe(1)
  })

  it('passes for an ownerless tenant (enforcement skipped)', async () => {
    const result = await guards.withFeatureWriteGuard(pool, seed.tenantB.id, 'song_files', async () => 'ok')
    expect(result).toBe('ok')
  })
})

describe('storage limit binding [B5]', () => {
  it('an in-lock limit resolver sees the committed snapshot, not the pre-downgrade limit', async () => {
    await setPlanEntitlements('silver', (ent) => { ent.limits.storage_mb = 150 })
    await subscribeUser('gold') // gold: 500 MB
    await setOwner(seed.tenantA.id, seed.userA.id)
    await pool.query(
      'INSERT INTO tenant_statistics (tenant_id, storage_bytes, object_count) VALUES ($1, $2, 1)',
      [seed.tenantA.id, 140 * MB])

    const resolver = async (client) => {
      const resolved = await entSvc.resolveTenantEntitlements(client, seed.tenantA.id)
      const mb = resolved?.entitlements.limits.storage_mb ?? null
      return mb === null ? null : mb * MB
    }

    // Before the downgrade: 140 + 20 fits inside gold's 500 MB.
    expect(await stats.reserveStorageUsage(seed.tenantA.id, 20 * MB, resolver)).toBe(true)
    await pool.query('UPDATE tenant_statistics SET storage_bytes = $2 WHERE tenant_id = $1', [seed.tenantA.id, 140 * MB])

    await billingSvc.downgrade(pool, userA(), {
      planId: await planId('silver'), interval: 'month', confirmation: 'downgrade to silver',
    })
    // After the snapshot commits, the same reservation resolves the bound 150 MB limit.
    expect(await stats.reserveStorageUsage(seed.tenantA.id, 20 * MB, resolver)).toBe(false)
  })
})

describe('cancelRemoteSubscription lookup failures [P1-4]', () => {
  it('a transient status-lookup error still issues the idempotent cancel', async () => {
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'gold', mollie_subscription_id: 'sub_z',
    })
    fake.subscriptions.set('sub_z', { id: 'sub_z', status: 'active', nextPaymentDate: null })
    await pool.query('UPDATE users SET mollie_customer_id = $2 WHERE id = $1', [seed.userA.id, 'cst_1'])

    fake.failNextWith = { retryable: true } // getSubscription blips
    await saga.cancelRemoteSubscription(pool, s)
    expect(fake.subscriptions.get('sub_z').status).toBe('canceled')
    const { rows: [op] } = await pool.query(
      "SELECT status FROM billing_operations WHERE op_type = 'cancel_subscription' AND subscription_id = $1", [s.id])
    expect(op.status).toBe('succeeded')
  })

  it('a failing cancel call is retryable, then succeeds on the next attempt — never double-marked', async () => {
    const s = await billingHelpers.createSubscription({
      userId: seed.userA.id, planSlug: 'gold', mollie_subscription_id: 'sub_y',
    })
    fake.subscriptions.set('sub_y', { id: 'sub_y', status: 'active', nextPaymentDate: null })
    await pool.query('UPDATE users SET mollie_customer_id = $2 WHERE id = $1', [seed.userA.id, 'cst_1'])

    const realCancel = fake.cancelSubscription.bind(fake)
    fake.cancelSubscription = async () => { throw new Error('network down') }
    await expect(saga.cancelRemoteSubscription(pool, s)).rejects.toThrow('network down')
    let { rows: [op] } = await pool.query(
      "SELECT status FROM billing_operations WHERE op_type = 'cancel_subscription' AND subscription_id = $1", [s.id])
    expect(op.status).toBe('failed_retryable')
    expect(fake.subscriptions.get('sub_y').status).toBe('active') // NOT treated as canceled

    fake.cancelSubscription = realCancel
    await saga.cancelRemoteSubscription(pool, s)
    expect(fake.subscriptions.get('sub_y').status).toBe('canceled')
  })
})
