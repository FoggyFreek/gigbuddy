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
      song_tag_links, song_links, song_documents, song_recordings, song_tags, songs,
      memberships,
      tenant_invites,
      push_subscriptions,
      notifications, notification_type_prefs, notification_tenant_prefs,
      subscription_payments, billing_operations, subscriptions, storage_cleanup_queue,
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

// All 13 inserts in a single round-trip. Returns one row with json_agg columns.
const SEED_SQL = `
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
  ),
  bm AS (
    INSERT INTO band_members (tenant_id, name, position, sort_order, user_id)
    SELECT t.id,
      CASE t.slug WHEN 'alpha' THEN 'Alpha Member' ELSE 'Beta Member' END,
      'lead', 0, u.id
    FROM t JOIN u ON (t.slug = 'alpha' AND u.email = 'a@test.local')
                  OR (t.slug = 'beta'  AND u.email = 'b@test.local')
    RETURNING id, tenant_id
  ),
  g AS (
    INSERT INTO gigs (tenant_id, event_date, event_description)
    SELECT id,
      CASE slug WHEN 'alpha' THEN '2026-06-01'::date ELSE '2026-06-02'::date END,
      CASE slug WHEN 'alpha' THEN 'Alpha Gig'         ELSE 'Beta Gig'         END
    FROM t
    RETURNING id, tenant_id
  ),
  gt AS (
    INSERT INTO gig_tasks (tenant_id, gig_id, title)
    SELECT g.tenant_id, g.id,
      CASE (SELECT slug FROM t WHERE t.id = g.tenant_id)
        WHEN 'alpha' THEN 'Alpha task' ELSE 'Beta task' END
    FROM g
    RETURNING id, tenant_id
  ),
  r AS (
    INSERT INTO rehearsals (tenant_id, proposed_date)
    SELECT id,
      CASE slug WHEN 'alpha' THEN '2026-06-10'::date ELSE '2026-06-11'::date END
    FROM t
    RETURNING id, tenant_id
  ),
  be AS (
    INSERT INTO band_events (tenant_id, title, start_date, end_date)
    SELECT id,
      CASE slug WHEN 'alpha' THEN 'Alpha event' ELSE 'Beta event' END,
      CASE slug WHEN 'alpha' THEN '2026-07-01'::date ELSE '2026-07-02'::date END,
      CASE slug WHEN 'alpha' THEN '2026-07-01'::date ELSE '2026-07-02'::date END
    FROM t
    RETURNING id, tenant_id
  ),
  avail AS (
    INSERT INTO availability_slots (tenant_id, band_member_id, start_date, end_date, status, reason)
    SELECT bm.tenant_id, bm.id,
      CASE (SELECT slug FROM t WHERE t.id = bm.tenant_id)
        WHEN 'alpha' THEN '2026-08-01'::date ELSE '2026-08-10'::date END,
      CASE (SELECT slug FROM t WHERE t.id = bm.tenant_id)
        WHEN 'alpha' THEN '2026-08-05'::date ELSE '2026-08-12'::date END,
      'unavailable',
      CASE (SELECT slug FROM t WHERE t.id = bm.tenant_id)
        WHEN 'alpha' THEN 'Alpha vacation' ELSE 'Beta vacation' END
    FROM bm
    RETURNING id, tenant_id
  ),
  et AS (
    INSERT INTO email_templates (tenant_id, name, subject, body_html)
    SELECT id,
      CASE slug WHEN 'alpha' THEN 'Alpha tpl' ELSE 'Beta tpl' END,
      CASE slug WHEN 'alpha' THEN 'Hello A'   ELSE 'Hello B'  END,
      CASE slug WHEN 'alpha' THEN '<p>A</p>'  ELSE '<p>B</p>' END
    FROM t
    RETURNING id, tenant_id
  ),
  v AS (
    INSERT INTO venues (tenant_id, category, name)
    SELECT id, 'venue',
      CASE slug WHEN 'alpha' THEN 'Alpha Hall' ELSE 'Beta Hall' END
    FROM t
    RETURNING id, tenant_id, name
  ),
  c AS (
    INSERT INTO contacts (tenant_id, name, category)
    SELECT id,
      CASE slug WHEN 'alpha' THEN 'Alpha Contact' ELSE 'Beta Contact' END,
      'press'
    FROM t
    RETURNING id, tenant_id
  ),
  sp AS (
    INSERT INTO share_photos (tenant_id, object_key, content_type, label, sort_order)
    SELECT id,
      'tenants/' || id || '/share/' || CASE slug WHEN 'alpha' THEN 'alpha.jpg' ELSE 'beta.jpg' END,
      'image/jpeg',
      CASE slug WHEN 'alpha' THEN 'A photo' ELSE 'B photo' END,
      0
    FROM t
    RETURNING id, tenant_id, object_key
  )
SELECT
  (SELECT json_agg(row_to_json(t.*)) FROM t)     AS tenants,
  (SELECT json_agg(row_to_json(u.*)) FROM u)     AS users,
  (SELECT json_agg(row_to_json(bm.*)) FROM bm)   AS members,
  (SELECT json_agg(row_to_json(g.*)) FROM g)     AS gigs,
  (SELECT json_agg(row_to_json(gt.*)) FROM gt)   AS tasks,
  (SELECT json_agg(row_to_json(r.*)) FROM r)     AS rehearsals,
  (SELECT json_agg(row_to_json(be.*)) FROM be)   AS band_events,
  (SELECT json_agg(row_to_json(avail.*)) FROM avail) AS slots,
  (SELECT json_agg(row_to_json(et.*)) FROM et)   AS email_templates,
  (SELECT json_agg(row_to_json(v.*)) FROM v)     AS venues,
  (SELECT json_agg(row_to_json(c.*)) FROM c)     AS contacts,
  (SELECT json_agg(row_to_json(sp.*)) FROM sp)   AS share_photos
`

// Seed two tenants with one approved member-user each + a super admin who is
// tenant_admin in both. Plus one row per tenant in every tenant-owned table
// for isolation assertions.
export async function seedTwoTenants() {
  await assertTestDatabase(pool)
  const { rows: [d] } = await pool.query(SEED_SQL)

  const tenants = d.tenants
  for (const t of tenants) {
    await seedTenantAccounting(pool, t.id)
    await createAccountingProfileForTenant(pool, t.id, 'nl')
  }

  const tenantA   = d.tenants.find(t => t.slug === 'alpha')
  const tenantB   = d.tenants.find(t => t.slug === 'beta')
  const userA     = d.users.find(u => u.email === 'a@test.local')
  const userB     = d.users.find(u => u.email === 'b@test.local')
  const superUser = d.users.find(u => u.email === 'su@test.local')
  const memberA   = d.members.find(m => m.tenant_id === tenantA.id)
  const memberB   = d.members.find(m => m.tenant_id === tenantB.id)
  const gigA      = d.gigs.find(g => g.tenant_id === tenantA.id)
  const gigB      = d.gigs.find(g => g.tenant_id === tenantB.id)
  const rehearsalA = d.rehearsals.find(r => r.tenant_id === tenantA.id)
  const rehearsalB = d.rehearsals.find(r => r.tenant_id === tenantB.id)

  return {
    tenantA, tenantB,
    userA, userB, superUser,
    memberA, memberB,
    gigA, gigB,
    tasks: d.tasks,
    rehearsalA, rehearsalB,
    bandEvents: d.band_events,
    slots: d.slots,
    emailTemplates: d.email_templates,
    venues: d.venues,
    contacts: d.contacts,
    sharePhotos: d.share_photos,
  }
}
