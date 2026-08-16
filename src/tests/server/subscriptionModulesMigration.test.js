import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Migration 181's legacy section runs exactly once, against data the
// already-migrated test template no longer has a shape for. These tests
// reconstruct the pre-181 subscriptions table, seed the rows a real database
// carries, and replay the migration — which is written to be re-runnable for
// exactly this reason.
//
// What is being defended: a surviving subscription must come out the far side
// owning a MODULE. Without the back-fill the DROP COLUMNs leave a live row with
// no plan, no price and no overrides — it grants nothing, yet still occupies the
// user's one live slot and answers `already_subscribed` to a trial attempt.
// A development database hit exactly that, on eleven complimentary grants.
//
// The schema is mutated here (the legacy columns come back), so this file stands
// alone; every replay ends with the migration's own DROP COLUMNs, which is what
// puts the schema back for anything sharing this database.

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  'server/db/migrations/181_subscription_modules.sql',
)

// The pre-181 subscriptions table, as migrations 101/160/166 left it.
const LEGACY_SHAPE = `
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES subscription_plans(id),
  ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'band',
  ADD COLUMN IF NOT EXISTS entitlement_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pending_plan_id INTEGER REFERENCES subscription_plans(id),
  ADD COLUMN IF NOT EXISTS pending_change_kind TEXT,
  ADD COLUMN IF NOT EXISTS pending_billing_interval TEXT,
  ADD COLUMN IF NOT EXISTS pending_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS pending_purge_manifest JSONB,
  ADD COLUMN IF NOT EXISTS pending_limits_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS downgrade_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS downgrade_schedule_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS superseded_mollie_subscription_id TEXT;
DROP INDEX IF EXISTS subscriptions_one_live_per_user_idx;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN
  ('pending_mandate','pending_activation','trialing','active','past_due','canceled'));
UPDATE subscription_plans SET is_trial_tier = FALSE;
`

let pool, runMigrations, truncateAll, migrationSql
let catalog = []
let plans = {}
let userSeq = 0

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  migrationSql = await readFile(MIGRATION_PATH, 'utf8')
  await runMigrations()
  const { rows } = await pool.query('SELECT id, slug FROM subscription_plans ORDER BY id')
  catalog = rows
})

beforeEach(async () => {
  await truncateAll()
  // These tests rename and add plans to reproduce catalogs seen in the field,
  // and truncateAll does not reseed subscription_plans — so put the pristine
  // catalog back rather than leaking one test's drift into the next.
  await pool.query('DELETE FROM subscription_plans WHERE id <> ALL($1::int[])',
    [catalog.map((p) => p.id)])
  await pool.query(
    `UPDATE subscription_plans p SET slug = c.slug
       FROM unnest($1::int[], $2::text[]) AS c(id, slug)
      WHERE p.id = c.id AND p.slug IS DISTINCT FROM c.slug`,
    [catalog.map((p) => p.id), catalog.map((p) => p.slug)])
  const { rows } = await pool.query('SELECT id, slug, audience, is_fallback FROM subscription_plans')
  plans = Object.fromEntries(rows.map((p) => [p.slug, p]))
  await pool.query(LEGACY_SHAPE)
})

afterAll(async () => {
  // Leave the schema as the migration defines it for anything sharing this
  // database. A test that ended in a refusal rolled its replay back, so put the
  // legacy shape on unconditionally and let a clean replay take it away again.
  await truncateAll()
  await pool.query(LEGACY_SHAPE)
  await pool.query(migrationSql)
  await pool.end()
})

async function createUser() {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (email, name) VALUES ($1, 'Legacy') RETURNING id`,
    [`legacy-${userSeq++}-${Date.now()}@test.local`],
  )
  return user
}

// A pre-181 subscription: plan, price and audience on the SUBSCRIPTION row.
async function legacySubscription({ planSlug, ...overrides }) {
  const plan = plans[planSlug]
  const row = {
    user_id: (await createUser()).id,
    plan_id: plan.id,
    audience: plan.audience,
    status: 'active',
    price_cents: 0,
    ...overrides,
  }
  const cols = Object.keys(row)
  const { rows: [sub] } = await pool.query(
    `INSERT INTO subscriptions (${cols.join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(row),
  )
  return sub
}

async function replay() {
  await pool.query(migrationSql)
}

async function moduleFor(subscriptionId) {
  const { rows: [row] } = await pool.query(
    `SELECT m.*, p.slug FROM subscription_modules m
       JOIN subscription_plans p ON p.id = m.plan_id
      WHERE m.subscription_id = $1`,
    [subscriptionId],
  )
  return row ?? null
}

async function statusOf(id) {
  const { rows: [row] } = await pool.query('SELECT status FROM subscriptions WHERE id = $1', [id])
  return row.status
}

describe('migration 181 — legacy subscription back-fill', () => {
  it('gives a paying subscription a module carrying plan, price and overrides', async () => {
    const sub = await legacySubscription({
      planSlug: 'gold',
      billing_interval: 'month',
      price_cents: 1499,
      entitlement_overrides: { features: { finance: true } },
      current_period_end: new Date(Date.now() + 20 * 864e5),
      mollie_subscription_id: 'sub_legacy',
    })

    await replay()

    expect(await moduleFor(sub.id)).toMatchObject({
      audience: 'band',
      slug: 'gold',
      status: 'active',
      price_cents: 1499,
      is_starter: true,
      entitlement_overrides: { features: { finance: true } },
    })
    expect(await statusOf(sub.id)).toBe('active')
  })

  it('carries a scheduled downgrade onto the module, manifest and snapshot intact', async () => {
    const sub = await legacySubscription({
      planSlug: 'gold',
      billing_interval: 'month',
      price_cents: 1499,
      pending_plan_id: plans.silver.id,
      pending_change_kind: 'downgrade',
      pending_billing_interval: 'month',
      pending_price_cents: 699,
      pending_purge_manifest: { features: ['chordpro'] },
      pending_limits_snapshot: { members: 5 },
      downgrade_confirmed_at: new Date(),
    })

    await replay()

    const module = await moduleFor(sub.id)
    expect(module).toMatchObject({
      pending_plan_id: plans.silver.id,
      pending_change_kind: 'downgrade',
      pending_price_cents: 699,
      pending_purge_manifest: { features: ['chordpro'] },
      pending_limits_snapshot: { members: 5 },
    })
    expect(module.downgrade_confirmed_at).not.toBeNull()
  })

  it('back-fills a complimentary grant — the row a database really carries', async () => {
    const sub = await legacySubscription({
      planSlug: 'artist_gold',
      price_cents: 0,
      is_complimentary: true,
    })

    await replay()

    expect(await moduleFor(sub.id)).toMatchObject({
      audience: 'artist',
      slug: 'artist_gold',
      status: 'active',
      price_cents: 0,
    })
  })

  it('cancels a subscription parked on the free floor instead of stranding it', async () => {
    // Absence of a module IS the free plan, so the row has nothing to represent —
    // and left live it would block the user's trial forever.
    const sub = await legacySubscription({ planSlug: 'bronze', price_cents: 0 })

    await replay()

    expect(await statusOf(sub.id)).toBe('canceled')
    expect(await moduleFor(sub.id)).toBeNull()
  })

  it('converts pending_mandate to pending_activation with a non-granting module', async () => {
    const sub = await legacySubscription({
      planSlug: 'gold',
      status: 'pending_mandate',
      billing_interval: 'year',
      price_cents: 14900,
      mollie_first_payment_id: 'tr_legacy',
    })

    await replay()

    expect(await statusOf(sub.id)).toBe('pending_activation')
    expect(await moduleFor(sub.id)).toMatchObject({ status: 'pending', slug: 'gold' })
  })

  it('leaves canceled history alone', async () => {
    const sub = await legacySubscription({
      planSlug: 'gold',
      status: 'canceled',
      price_cents: 1499,
      canceled_at: new Date(),
      cancel_reason: 'user_requested',
    })

    await replay()

    expect(await moduleFor(sub.id)).toBeNull()
    expect(await statusOf(sub.id)).toBe('canceled')
  })
})

describe('migration 181 — trial tier designation', () => {
  it('finds the artist tier under the slug this catalog actually uses', async () => {
    // isValidSlug rejects the underscore, so 'artist_gold' was hand-renamed in
    // the field. Keying on the pristine slug alone leaves the artist ladder with
    // no trial tier and every artist trial 409s `trial_tier_missing`.
    await pool.query("UPDATE subscription_plans SET slug = 'artistgold' WHERE slug = 'artist_gold'")

    await replay()

    const { rows } = await pool.query(
      'SELECT slug, audience FROM subscription_plans WHERE is_trial_tier ORDER BY audience')
    expect(rows).toEqual([
      { slug: 'artistgold', audience: 'artist' },
      { slug: 'gold', audience: 'band' },
    ])
  })

  it('designates one tier per audience when the catalog carries both spellings', async () => {
    await pool.query(
      `INSERT INTO subscription_plans (slug, name, audience, monthly_price_cents, yearly_price_cents,
         entitlements, sort_order)
       SELECT 'artistgold', 'Artist Gold (renamed)', 'artist', monthly_price_cents,
              yearly_price_cents, entitlements, sort_order
         FROM subscription_plans WHERE slug = 'artist_gold'`)

    await replay()

    const { rows } = await pool.query(
      "SELECT count(*)::int AS c FROM subscription_plans WHERE is_trial_tier AND audience = 'artist'")
    expect(rows[0].c).toBe(1)
  })

  it('refuses to migrate a catalog where no trial tier can be designated', async () => {
    await pool.query("UPDATE subscription_plans SET slug = 'band_premium' WHERE slug = 'gold'")

    await expect(replay()).rejects.toThrow(/no trial tier could be designated for audience\(s\) band/)
  })
})

describe('migration 181 — preflight refusals', () => {
  it('refuses a user holding two live subscriptions', async () => {
    // Exactly what the old model sold: one live subscription per AUDIENCE.
    // Two provider schedules cannot be merged into one cycle in SQL.
    const first = await legacySubscription({
      planSlug: 'gold', billing_interval: 'month', price_cents: 1499, mollie_subscription_id: 'sub_band',
    })
    await pool.query(
      `INSERT INTO subscriptions (user_id, plan_id, audience, status, billing_interval, price_cents,
         mollie_subscription_id)
       VALUES ($1, $2, 'artist', 'active', 'month', 499, 'sub_artist')`,
      [first.user_id, plans.artist_gold.id])

    await expect(replay()).rejects.toThrow(/hold more than one live subscription/)
  })

  it('refuses a billing-interval change in flight', async () => {
    await legacySubscription({
      planSlug: 'gold',
      billing_interval: 'month',
      price_cents: 1499,
      pending_plan_id: plans.gold.id,
      pending_change_kind: 'interval',
      pending_billing_interval: 'year',
      pending_price_cents: 14900,
    })

    await expect(replay()).rejects.toThrow(/billing-interval change in flight/)
  })

  it('refuses a downgrade-to-free riding the cancel path', async () => {
    await legacySubscription({
      planSlug: 'gold',
      billing_interval: 'month',
      price_cents: 1499,
      cancel_at_period_end: true,
      pending_purge_manifest: { features: ['finance'] },
      pending_limits_snapshot: { members: 5 },
    })

    await expect(replay()).rejects.toThrow(/downgrade-to-free riding the cancel path/)
  })

  it('leaves the schema completely untouched when it refuses', async () => {
    // The file is one implicit transaction, so a refusal rolls back every
    // statement before it — the previous container keeps serving a schema it
    // still understands.
    const sub = await legacySubscription({
      planSlug: 'gold', billing_interval: 'month', price_cents: 1499,
      pending_plan_id: plans.gold.id, pending_change_kind: 'interval',
      pending_billing_interval: 'year', pending_price_cents: 14900,
    })

    await expect(replay()).rejects.toThrow()

    const { rows: [cols] } = await pool.query(
      `SELECT count(*)::int AS c FROM information_schema.columns
        WHERE table_name = 'subscriptions'
          AND column_name IN ('plan_id', 'price_cents', 'audience')`)
    expect(cols.c).toBe(3)
    const { rows: [{ still_there }] } = await pool.query(
      `SELECT (SELECT plan_id FROM subscriptions WHERE id = $1) IS NOT NULL AS still_there`, [sub.id])
    expect(still_there).toBe(true)
  })
})
