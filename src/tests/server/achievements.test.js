import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let clearAchievementCache
let ACHIEVEMENT_DEFINITIONS, CATEGORIES
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const svcMod = await import('../../../server/services/achievementService.js')
  const defMod = await import('../../../server/achievements/definitions.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  clearAchievementCache = svcMod.clearAchievementCache
  ACHIEVEMENT_DEFINITIONS = defMod.ACHIEVEMENT_DEFINITIONS
  CATEGORIES = defMod.CATEGORIES
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  clearAchievementCache()
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

async function getAchievements(as = asUserA) {
  const res = await as(request(app).get('/api/achievements')).expect(200)
  return res.body
}

const byKey = (list, key) => list.find((a) => a.key === key)

async function unlockedRowsFor(tenantId) {
  const { rows } = await pool.query(
    `SELECT achievement_key, unlocked_at FROM tenant_achievements WHERE tenant_id = $1`,
    [tenantId],
  )
  return rows
}

// Seed helpers -----------------------------------------------------------

async function addMember(tenantId, name, position) {
  await pool.query(
    `INSERT INTO band_members (tenant_id, name, position) VALUES ($1, $2, $3)`,
    [tenantId, name, position],
  )
}

async function satisfyAllProfileGoals(tenantId, redeemedByUserId) {
  await pool.query(
    `UPDATE tenants SET
       bio = 'We play loud',
       logo_path = 'tenants/x/logo/a.png',
       logo_dark_path = 'tenants/x/logo/b.png',
       avatar_path = 'tenants/x/avatar/a.png',
       banner_path = 'tenants/x/banner/a.png',
       instagram_handle = 'alphaband'
     WHERE id = $1`,
    [tenantId],
  )
  await addMember(tenantId, 'Optional Olly', 'optional')
  await addMember(tenantId, 'Sub Sally', 'sub')
  await pool.query(
    `INSERT INTO tenant_invites (code, tenant_id, role, created_by_user_id, expires_at, used_by_user_id, used_at)
     VALUES ('ACHTEST1', $1, 'member', $2, NOW() + INTERVAL '1 day', $2, NOW())`,
    [tenantId, redeemedByUserId],
  )
}

function journalPayload(overrides = {}) {
  return {
    entry_date: '2026-06-15',
    description: 'gig revenue',
    lines: [{
      description: 'gig fee', account_code: '41000', vat_rate: 0,
      side: 'credit', amount_cents: 50000, balancing_account_code: '11000',
    }],
    ...overrides,
  }
}

async function postApprovedJournal(overrides) {
  const create = await asUserA(request(app).post('/api/journal'))
    .send(journalPayload(overrides)).expect(201)
  await asUserA(request(app).post(`/api/journal/${create.body.id}/approve`)).send().expect(200)
  return create.body
}

async function addPersonalSetlistNote(tenantId, userId) {
  await pool.query(
    `WITH song AS (
       INSERT INTO songs (tenant_id, title) VALUES ($1, 'High Note') RETURNING id
     ), setlist AS (
       INSERT INTO setlists (tenant_id, name) VALUES ($1, 'Achievement Set') RETURNING id
     ), set_group AS (
       INSERT INTO setlist_sets (setlist_id, tenant_id, name)
       SELECT id, $1, 'Set 1' FROM setlist RETURNING id
     ), item AS (
       INSERT INTO setlist_items (set_id, tenant_id, item_type, song_id)
       SELECT set_group.id, $1, 'song', song.id FROM set_group, song RETURNING id
     )
     INSERT INTO setlist_item_notes (setlist_item_id, tenant_id, user_id, note)
     SELECT id, $1, $2, 'Watch the bridge' FROM item`,
    [tenantId, userId],
  )
}

// ============================================================

describe('GET /api/achievements', () => {
  it('returns every definition with shape and unlocks the baseline set for a fresh tenant', async () => {
    const list = await getAchievements()
    expect(list).toHaveLength(ACHIEVEMENT_DEFINITIONS.length)
    for (const a of list) {
      expect(a).toEqual({
        key: expect.any(String),
        category: expect.any(String),
        cheers: expect.any(Number),
        unlocked_at: a.unlocked_at === null ? null : expect.any(String),
      })
    }
    // Seeded tenant already has a rehearsal + band event; welcome is always true.
    expect(byKey(list, 'welcome_to_the_giggle').unlocked_at).not.toBeNull()
    expect(byKey(list, 'first_rehearsal_last_excuse').unlocked_at).not.toBeNull()
    expect(byKey(list, 'calendar_rock').unlocked_at).not.toBeNull()
    // The seeded gig is an option — not "actually happening" yet.
    expect(byKey(list, 'this_ones_actually_happening').unlocked_at).toBeNull()
    expect(byKey(list, 'fully_plugged_in').unlocked_at).toBeNull()
  })

  it('unlocks and persists when a goal is met', async () => {
    await getAchievements() // baseline
    await pool.query(`UPDATE gigs SET status = 'confirmed' WHERE tenant_id = $1`, [seed.tenantA.id])
    const list = await getAchievements()
    expect(byKey(list, 'this_ones_actually_happening').unlocked_at).not.toBeNull()
    const rows = await unlockedRowsFor(seed.tenantA.id)
    expect(rows.map((r) => r.achievement_key)).toContain('this_ones_actually_happening')
  })

  it('does not unlock tenant B achievements from tenant A data (tenant isolation)', async () => {
    await pool.query(`UPDATE gigs SET status = 'confirmed' WHERE tenant_id = $1`, [seed.tenantA.id])
    const listA = await getAchievements(asUserA)
    expect(byKey(listA, 'this_ones_actually_happening').unlocked_at).not.toBeNull()

    const listB = await getAchievements(asUserB)
    expect(byKey(listB, 'this_ones_actually_happening').unlocked_at).toBeNull()
    const rowsB = await unlockedRowsFor(seed.tenantB.id)
    expect(rowsB.map((r) => r.achievement_key)).not.toContain('this_ones_actually_happening')
  })

  it('keeps an unlock permanent after the qualifying data disappears', async () => {
    await pool.query(`UPDATE gigs SET status = 'confirmed' WHERE tenant_id = $1`, [seed.tenantA.id])
    const before = byKey(await getAchievements(), 'this_ones_actually_happening')
    expect(before.unlocked_at).not.toBeNull()

    await pool.query(`DELETE FROM gigs WHERE tenant_id = $1`, [seed.tenantA.id])
    clearAchievementCache()
    const after = byKey(await getAchievements(), 'this_ones_actually_happening')
    expect(after.unlocked_at).toBe(before.unlocked_at)
  })

  it('is idempotent: repeated reads keep one row and one timestamp per unlock', async () => {
    const first = byKey(await getAchievements(), 'welcome_to_the_giggle')
    clearAchievementCache()
    const second = byKey(await getAchievements(), 'welcome_to_the_giggle')
    expect(second.unlocked_at).toBe(first.unlocked_at)
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tenant_achievements
        WHERE tenant_id = $1 AND achievement_key = 'welcome_to_the_giggle'`,
      [seed.tenantA.id],
    )
    expect(rows[0].n).toBe(1)
  })

  it('unlocks the profile meta-achievement in the same pass as its last prerequisite', async () => {
    await satisfyAllProfileGoals(seed.tenantA.id, seed.userB.id)
    const list = await getAchievements()
    const profileKeys = ACHIEVEMENT_DEFINITIONS
      .filter((d) => d.category === 'profile')
      .map((d) => d.key)
    for (const key of profileKeys) {
      expect(byKey(list, key).unlocked_at, key).not.toBeNull()
    }
    expect(byKey(list, 'fully_plugged_in').unlocked_at).not.toBeNull()
  })

  it('counts only completed months for finance goals and ignores voided ledger entries', async () => {
    // Revenue booked in the CURRENT month must not unlock (month not complete).
    await postApprovedJournal({ entry_date: '2026-07-01' })
    clearAchievementCache()
    let list = await getAchievements()
    expect(byKey(list, 'black_ink_sabbath').unlocked_at).toBeNull()

    // Revenue in a completed month, but voided → still locked.
    const journal = await postApprovedJournal({ entry_date: '2026-06-15' })
    const { rows: [txn] } = await pool.query(
      `SELECT id FROM ledger_transactions
        WHERE tenant_id = $1 AND source_type = 'journal' AND source_id = $2`,
      [seed.tenantA.id, journal.id],
    )
    await asUserA(request(app).post(`/api/ledger/${txn.id}/void`))
      .send({ reason: 'test void' }).expect(200)
    clearAchievementCache()
    list = await getAchievements()
    expect(byKey(list, 'black_ink_sabbath').unlocked_at).toBeNull()

    // A live completed-month revenue posting unlocks it.
    await postApprovedJournal({ entry_date: '2026-05-15' })
    clearAchievementCache()
    list = await getAchievements()
    expect(byKey(list, 'black_ink_sabbath').unlocked_at).not.toBeNull()
  })

  it('unlocks the personal-note and configured-integration achievements', async () => {
    await getAchievements() // baseline
    await addPersonalSetlistNote(seed.tenantA.id, seed.userA.id)
    await pool.query(
      `UPDATE tenants SET
         bandsintown_app_id_encrypted = '{}'::jsonb,
         shopify_client_id = 'client-id',
         mollie_api_key_encrypted = '{}'::jsonb
       WHERE id = $1`,
      [seed.tenantA.id],
    )

    let list = await getAchievements()
    expect(byKey(list, 'my_personal_high_note').unlocked_at).not.toBeNull()
    expect(byKey(list, 'took_this_band_to_town').unlocked_at).not.toBeNull()
    expect(byKey(list, 'power_to_the_payments').unlocked_at).not.toBeNull()
    // A single Shopify field does not make the integration usable.
    expect(byKey(list, 'sync_that_chop_shop').unlocked_at).toBeNull()

    await pool.query(
      `UPDATE tenants SET
         shopify_client_secret_encrypted = '{}'::jsonb,
         shopify_shop_domain = 'achievement.myshopify.com'
       WHERE id = $1`,
      [seed.tenantA.id],
    )
    list = await getAchievements()
    expect(byKey(list, 'sync_that_chop_shop').unlocked_at).not.toBeNull()
  })

  it('does not unlock note or integration achievements from another tenant\'s data', async () => {
    await addPersonalSetlistNote(seed.tenantA.id, seed.userA.id)
    await pool.query(
      `UPDATE tenants SET
         bandsintown_app_id_encrypted = '{}'::jsonb,
         shopify_client_id = 'client-id',
         shopify_client_secret_encrypted = '{}'::jsonb,
         shopify_shop_domain = 'achievement.myshopify.com',
         mollie_api_key_encrypted = '{}'::jsonb
       WHERE id = $1`,
      [seed.tenantA.id],
    )

    const list = await getAchievements(asUserB)
    for (const key of [
      'my_personal_high_note',
      'took_this_band_to_town',
      'sync_that_chop_shop',
      'power_to_the_payments',
    ]) {
      expect(byKey(list, key).unlocked_at, key).toBeNull()
    }
  })

  it('suppresses notifications on the baseline pass but notifies later unlocks', async () => {
    await getAchievements() // baseline: unlocks welcome/rehearsal/event, no pings
    let { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'achievement-unlocked'`,
    )
    expect(rows[0].n).toBe(0)

    await addMember(seed.tenantA.id, 'Second', 'lead')
    await addMember(seed.tenantA.id, 'Third', 'lead')
    const list = await getAchievements()
    expect(byKey(list, 'three_chords_three_humans').unlocked_at).not.toBeNull()
    ;({ rows } = await pool.query(
      `SELECT user_id, tenant_id, title, url FROM notifications WHERE type = 'achievement-unlocked'`,
    ))
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.every((r) => r.tenant_id === seed.tenantA.id)).toBe(true)
    expect(rows[0].title).toContain('Three Chords, Three Humans')
    expect(rows[0].url).toBe('/achievements')
  })

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/achievements')
    expect([401, 403]).toContain(res.status)
  })
})

describe('achievement definitions registry', () => {
  it('defines the new achievements with their canonical titles and cheers', () => {
    expect(ACHIEVEMENT_DEFINITIONS.filter((d) => [
      'my_personal_high_note',
      'took_this_band_to_town',
      'sync_that_chop_shop',
      'power_to_the_payments',
    ].includes(d.key)).map(({ key, title, cheers }) => ({ key, title, cheers }))).toEqual([
      { key: 'took_this_band_to_town', title: 'Took This Band to Town', cheers: 3 },
      { key: 'power_to_the_payments', title: 'Power to the Payments', cheers: 3 },
      { key: 'sync_that_chop_shop', title: 'Sync That Chop Shop', cheers: 3 },
      { key: 'my_personal_high_note', title: 'My Personal High Note', cheers: 1 },
    ])
  })

  it('has unique keys, valid categories, and cheers between 1 and 10', () => {
    const keys = ACHIEVEMENT_DEFINITIONS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const d of ACHIEVEMENT_DEFINITIONS) {
      expect(CATEGORIES, d.key).toContain(d.category)
      expect(Number.isInteger(d.cheers), d.key).toBe(true)
      expect(d.cheers, d.key).toBeGreaterThanOrEqual(1)
      expect(d.cheers, d.key).toBeLessThanOrEqual(10)
      expect(typeof d.test, d.key).toBe('function')
      expect(typeof d.title, d.key).toBe('string')
    }
  })

  it('has en i18n copy for every achievement key', () => {
    const enPath = fileURLToPath(new URL('../../i18n/en/achievements.json', import.meta.url))
    const en = JSON.parse(readFileSync(enPath, 'utf8'))
    for (const d of ACHIEVEMENT_DEFINITIONS) {
      expect(en.items[d.key]?.title, d.key).toBeTruthy()
      expect(en.items[d.key]?.description, d.key).toBeTruthy()
    }
  })
})
