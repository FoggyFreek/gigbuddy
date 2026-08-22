import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pool from '../../../server/db/index.js'
import { seedTenantAccounting } from '../../../server/db/defaultChartOfAccounts.js'
import { createAccountingProfileForTenant } from '../../../server/finance/accounting-profile/accountingProfileService.js'
import { TERMS_VERSION } from '../../../shared/termsVersion.js'
import { assertTestDatabase } from './_databaseGuard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '../../../server/db/migrations')

export { pool }

export async function runMigrations() {
  await assertTestDatabase(pool)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      run_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  // One lookup rather than one per migration: against a template-cloned database
  // every file is already applied, and this runs again for each test file.
  const { rows: appliedRows } = await pool.query('SELECT filename FROM migrations')
  const applied = new Set(appliedRows.map((r) => r.filename))
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO migrations (filename) VALUES ($1)', [file])
  }

  // Test-only fixture accommodation: the terms-enforcement gate
  // (requireCurrentTerms) blocks any tenant-route request whose user hasn't
  // accepted the CURRENT terms version. Real users start with NULL terms and
  // accept via /auth/accept-terms, but the vast majority of backend tests
  // create approved users only to exercise other features. Defaulting the
  // terms columns to "current, accepted now" lets every such user through the
  // gate without per-test boilerplate; a test that needs a stale/blocked user
  // (see authTerms.test.js) clears these columns explicitly. Column DEFAULTs
  // don't take bind params, but TERMS_VERSION is our own constant date string.
  await pool.query(
    `ALTER TABLE users
       ALTER COLUMN terms_accepted_at SET DEFAULT NOW(),
       ALTER COLUMN terms_version SET DEFAULT '${TERMS_VERSION}'`,
  )
}

const TRUNCATE_SQL = `
    TRUNCATE
      gig_tag_links, gig_tags, gig_contacts, gig_participants, gig_tasks, gigs,
      rehearsal_participants, rehearsals,
      band_event_participants, band_events, availability_slots,
      band_members,
      band_profile_claims, my_bands, band_profiles,
      profile_links,
      email_templates, venue_contacts, venues, contact_notes, contacts, share_photos,
      setlist_items, setlist_sets, setlists,
      song_tag_links, song_links, song_documents, song_recordings, song_tags, songs, albums,
      memberships,
      tenant_invites,
      push_subscriptions,
      notifications, notification_type_prefs, notification_tenant_prefs,
      subscription_refunds, subscription_payments, subscription_modules,
      billing_webhook_events, billing_operations, subscriptions, storage_cleanup_queue,
      pricing_rules,
      tenant_statistics,
      tenant_achievements,
      tenants,
      platform_settings,
      users
    RESTART IDENTITY CASCADE
`

const DEADLOCK_DETECTED = '40P01'

// Wipe all test-relevant data. Preserves the schema and the `migrations` table.
//
// TRUNCATE takes ACCESS EXCLUSIVE on every table in the list, in list order. A
// request handler that kicked off work without awaiting it (notifications,
// achievements, storage cleanup) can still hold locks from the *previous* test
// and take them in a different order, which PostgreSQL resolves by killing one
// side. That race predates per-worker databases — parallel load just makes the
// interleaving likely enough to hit. Retrying is correct here: the loser's
// transaction is fully rolled back, so a second attempt starts clean.
export async function truncateAll(attempts = 3) {
  await assertTestDatabase(pool)
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query(TRUNCATE_SQL)
      return
    } catch (err) {
      if (err.code !== DEADLOCK_DETECTED || attempt >= attempts) throw err
    }
  }
}

// The default fixture is deliberately limited to tenant identity and access.
// Domain rows are opt-in through the helpers below.
const CORE_SEED_SQL = `
WITH
  t AS (
    INSERT INTO tenants (slug, band_name, display_name, address_street, address_postal_code, address_city, tax_id)
    VALUES
      ('alpha', 'Alpha Band', 'Alpha Band', 'Alpha Street 1', '1000 AA', 'Amsterdam', 'NL123456789B01'),
      ('beta',  'Beta Band',  'Beta Band',  'Beta Street 2',  '2000 BB', 'Rotterdam', 'NL123456789B02')
    RETURNING id, slug
  ),
  u AS (
    INSERT INTO users (google_sub, email, name, status, is_super_admin)
    VALUES
      ('sub-a',  'a@test.local',  'Alpha User', 'approved', false),
      ('sub-b',  'b@test.local',  'Beta User',  'approved', false),
      ('sub-su', 'su@test.local', 'Super User', 'approved', true)
    RETURNING id, email
  ),
  m AS (
    INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, source)
    SELECT u.id, t.id, 'tenant_admin', 'approved', NOW(), 'owner'
    FROM u, t
    WHERE (u.email = 'a@test.local'  AND t.slug = 'alpha')
       OR (u.email = 'b@test.local'  AND t.slug = 'beta')
       OR  u.email = 'su@test.local'
  )
SELECT
  (SELECT json_agg(row_to_json(t.*)) FROM t) AS tenants,
  (SELECT json_agg(row_to_json(u.*)) FROM u) AS users
`

export async function seedTwoTenants() {
  await assertTestDatabase(pool)
  const { rows: [d] } = await pool.query(CORE_SEED_SQL)

  const tenantA   = d.tenants.find(t => t.slug === 'alpha')
  const tenantB   = d.tenants.find(t => t.slug === 'beta')
  const userA     = d.users.find(u => u.email === 'a@test.local')
  const userB     = d.users.find(u => u.email === 'b@test.local')
  const superUser = d.users.find(u => u.email === 'su@test.local')

  return {
    tenantA, tenantB,
    userA, userB, superUser,
  }
}

export async function seedBandMembers(seed) {
  await assertTestDatabase(pool)
  const { rows: members } = await pool.query(
    `INSERT INTO band_members (tenant_id, name, position, sort_order, user_id)
     VALUES
       ($1, 'Alpha Member', 'lead', 0, $2),
       ($3, 'Beta Member',  'lead', 0, $4)
     RETURNING id, tenant_id`,
    [seed.tenantA.id, seed.userA.id, seed.tenantB.id, seed.userB.id],
  )
  return {
    ...seed,
    memberA: members.find((m) => m.tenant_id === seed.tenantA.id),
    memberB: members.find((m) => m.tenant_id === seed.tenantB.id),
  }
}

export async function seedGigsAndTasks(seed) {
  await assertTestDatabase(pool)
  const { rows: [d] } = await pool.query(
    `WITH
       g AS (
         INSERT INTO gigs (tenant_id, event_date, event_description)
         VALUES
           ($1, '2026-06-01', 'Alpha Gig'),
           ($2, '2026-06-02', 'Beta Gig')
         RETURNING id, tenant_id
       ),
       gt AS (
         INSERT INTO gig_tasks (tenant_id, gig_id, title)
         SELECT tenant_id, id,
           CASE tenant_id WHEN $1 THEN 'Alpha task' ELSE 'Beta task' END
         FROM g
         RETURNING id, tenant_id
       )
     SELECT
       (SELECT json_agg(row_to_json(g.*)) FROM g) AS gigs,
       (SELECT json_agg(row_to_json(gt.*)) FROM gt) AS tasks`,
    [seed.tenantA.id, seed.tenantB.id],
  )
  return {
    ...seed,
    gigA: d.gigs.find((g) => g.tenant_id === seed.tenantA.id),
    gigB: d.gigs.find((g) => g.tenant_id === seed.tenantB.id),
    tasks: d.tasks,
  }
}

export async function seedCalendar(seed) {
  await assertTestDatabase(pool)
  if (!seed.memberA || !seed.memberB) {
    throw new Error('seedCalendar requires seedBandMembers')
  }
  const { rows: [d] } = await pool.query(
    `WITH
       r AS (
         INSERT INTO rehearsals (tenant_id, proposed_date)
         VALUES ($1, '2026-06-10'), ($2, '2026-06-11')
         RETURNING id, tenant_id
       ),
       be AS (
         INSERT INTO band_events (tenant_id, title, start_date, end_date)
         VALUES
           ($1, 'Alpha event', '2026-07-01', '2026-07-01'),
           ($2, 'Beta event',  '2026-07-02', '2026-07-02')
         RETURNING id, tenant_id
       ),
       avail AS (
         INSERT INTO availability_slots
           (tenant_id, band_member_id, start_date, end_date, status, reason)
         VALUES
           ($1, $3, '2026-08-01', '2026-08-05', 'unavailable', 'Alpha vacation'),
           ($2, $4, '2026-08-10', '2026-08-12', 'unavailable', 'Beta vacation')
         RETURNING id, tenant_id
       )
     SELECT
       (SELECT json_agg(row_to_json(r.*)) FROM r) AS rehearsals,
       (SELECT json_agg(row_to_json(be.*)) FROM be) AS band_events,
       (SELECT json_agg(row_to_json(avail.*)) FROM avail) AS slots`,
    [seed.tenantA.id, seed.tenantB.id, seed.memberA.id, seed.memberB.id],
  )
  return {
    ...seed,
    rehearsalA: d.rehearsals.find((r) => r.tenant_id === seed.tenantA.id),
    rehearsalB: d.rehearsals.find((r) => r.tenant_id === seed.tenantB.id),
    bandEvents: d.band_events,
    slots: d.slots,
  }
}

export async function seedContactsAndVenues(seed) {
  await assertTestDatabase(pool)
  const { rows: [d] } = await pool.query(
    `WITH
       v AS (
         INSERT INTO venues (tenant_id, category, name)
         VALUES ($1, 'venue', 'Alpha Hall'), ($2, 'venue', 'Beta Hall')
         RETURNING id, tenant_id, name
       ),
       c AS (
         INSERT INTO contacts (tenant_id, name, category)
         VALUES ($1, 'Alpha Contact', 'press'), ($2, 'Beta Contact', 'press')
         RETURNING id, tenant_id
       )
     SELECT
       (SELECT json_agg(row_to_json(v.*)) FROM v) AS venues,
       (SELECT json_agg(row_to_json(c.*)) FROM c) AS contacts`,
    [seed.tenantA.id, seed.tenantB.id],
  )
  return { ...seed, venues: d.venues, contacts: d.contacts }
}

export async function seedSharePhotos(seed) {
  await assertTestDatabase(pool)
  const { rows } = await pool.query(
    `INSERT INTO share_photos (tenant_id, object_key, content_type, label, sort_order)
     VALUES
       ($1::integer, 'tenants/' || $1::text || '/share/alpha.jpg', 'image/jpeg', 'A photo', 0),
       ($2::integer, 'tenants/' || $2::text || '/share/beta.jpg',  'image/jpeg', 'B photo', 0)
     RETURNING id, tenant_id, object_key`,
    [seed.tenantA.id, seed.tenantB.id],
  )
  return { ...seed, sharePhotos: rows }
}

export async function seedAccountingForTenants(seed) {
  await assertTestDatabase(pool)
  for (const tenant of [seed.tenantA, seed.tenantB]) {
    await seedTenantAccounting(pool, tenant.id)
    await createAccountingProfileForTenant(pool, tenant.id, 'nl')
  }
  return seed
}
