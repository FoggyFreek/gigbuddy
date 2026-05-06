import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pool from '../../../server/db/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '../../../server/db/migrations')

export { pool }

export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      run_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM migrations WHERE filename = $1',
      [file],
    )
    if (rows.length > 0) continue
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO migrations (filename) VALUES ($1)', [file])
  }
}

// Wipe all test-relevant data. Preserves the schema and the `migrations` table.
export async function truncateAll() {
  await pool.query(`
    TRUNCATE
      gig_participants, gig_tasks, gigs,
      rehearsal_participants, rehearsals,
      band_events, availability_slots,
      band_members,
      profile_links,
      email_templates, venues, contacts, share_photos,
      memberships,
      tenant_invites,
      push_subscriptions,
      tenants,
      users
    RESTART IDENTITY CASCADE
  `)
}

// Seed two tenants with one approved member-user each + a super admin who is
// tenant_admin in both. Plus one row per tenant in every tenant-owned table
// for isolation assertions.
export async function seedTwoTenants() {
  const { rows: tenants } = await pool.query(
    `INSERT INTO tenants (slug, band_name)
     VALUES ('alpha', 'Alpha Band'), ('beta', 'Beta Band')
     RETURNING id, slug`,
  )
  const [tenantA, tenantB] = tenants

  const { rows: users } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES
       ('sub-a', 'a@test.local', 'Alpha User', 'approved', false),
       ('sub-b', 'b@test.local', 'Beta User',  'approved', false),
       ('sub-su','su@test.local','Super User','approved', true)
     RETURNING id, email`,
  )
  const [userA, userB, superUser] = users

  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
     VALUES
       ($1, $4, 'tenant_admin', 'approved', NOW()),
       ($2, $5, 'tenant_admin', 'approved', NOW()),
       ($3, $4, 'tenant_admin', 'approved', NOW()),
       ($3, $5, 'tenant_admin', 'approved', NOW())`,
    [userA.id, userB.id, superUser.id, tenantA.id, tenantB.id],
  )

  const { rows: members } = await pool.query(
    `INSERT INTO band_members (tenant_id, name, position, sort_order, user_id)
     VALUES
       ($1, 'Alpha Member', 'lead', 0, $3),
       ($2, 'Beta Member',  'lead', 0, $4)
     RETURNING id, tenant_id`,
    [tenantA.id, tenantB.id, userA.id, userB.id],
  )
  const memberA = members.find((m) => m.tenant_id === tenantA.id)
  const memberB = members.find((m) => m.tenant_id === tenantB.id)

  const { rows: gigs } = await pool.query(
    `INSERT INTO gigs (tenant_id, event_date, event_description)
     VALUES
       ($1, '2026-06-01', 'Alpha Gig'),
       ($2, '2026-06-02', 'Beta Gig')
     RETURNING id, tenant_id`,
    [tenantA.id, tenantB.id],
  )
  const gigA = gigs.find((g) => g.tenant_id === tenantA.id)
  const gigB = gigs.find((g) => g.tenant_id === tenantB.id)

  const { rows: tasks } = await pool.query(
    `INSERT INTO gig_tasks (tenant_id, gig_id, title)
     VALUES ($1, $3, 'Alpha task'), ($2, $4, 'Beta task')
     RETURNING id, tenant_id`,
    [tenantA.id, tenantB.id, gigA.id, gigB.id],
  )

  const { rows: rehearsals } = await pool.query(
    `INSERT INTO rehearsals (tenant_id, proposed_date)
     VALUES ($1, '2026-06-10'), ($2, '2026-06-11')
     RETURNING id, tenant_id`,
    [tenantA.id, tenantB.id],
  )
  const rehearsalA = rehearsals.find((r) => r.tenant_id === tenantA.id)
  const rehearsalB = rehearsals.find((r) => r.tenant_id === tenantB.id)

  const { rows: bandEvents } = await pool.query(
    `INSERT INTO band_events (tenant_id, title, start_date, end_date)
     VALUES ($1, 'Alpha event', '2026-07-01', '2026-07-01'),
            ($2, 'Beta event',  '2026-07-02', '2026-07-02')
     RETURNING id, tenant_id`,
    [tenantA.id, tenantB.id],
  )

  const { rows: slots } = await pool.query(
    `INSERT INTO availability_slots (tenant_id, band_member_id, start_date, end_date, status, reason)
     VALUES ($1, $3, '2026-08-01', '2026-08-05', 'unavailable', 'Alpha vacation'),
            ($2, $4, '2026-08-10', '2026-08-12', 'unavailable', 'Beta vacation')
     RETURNING id, tenant_id`,
    [tenantA.id, tenantB.id, memberA.id, memberB.id],
  )

  const { rows: emailTemplates } = await pool.query(
    `INSERT INTO email_templates (tenant_id, name, subject, body_html)
     VALUES ($1, 'Alpha tpl', 'Hello A', '<p>A</p>'),
            ($2, 'Beta tpl',  'Hello B', '<p>B</p>')
     RETURNING id, tenant_id`,
    [tenantA.id, tenantB.id],
  )

  const { rows: venues } = await pool.query(
    `INSERT INTO venues (tenant_id, category, name)
     VALUES ($1, 'venue', 'Alpha Hall'),
            ($2, 'venue', 'Beta Hall')
     RETURNING id, tenant_id`,
    [tenantA.id, tenantB.id],
  )

  const { rows: contacts } = await pool.query(
    `INSERT INTO contacts (tenant_id, name, category)
     VALUES ($1, 'Alpha Contact', 'press'),
            ($2, 'Beta Contact',  'press')
     RETURNING id, tenant_id`,
    [tenantA.id, tenantB.id],
  )

  const { rows: sharePhotos } = await pool.query(
    `INSERT INTO share_photos (tenant_id, object_key, content_type, label, sort_order)
     VALUES ($1, 'tenants/${tenantA.id}/share/alpha.jpg', 'image/jpeg', 'A photo', 0),
            ($2, 'tenants/${tenantB.id}/share/beta.jpg',  'image/jpeg', 'B photo', 0)
     RETURNING id, tenant_id, object_key`,
    [tenantA.id, tenantB.id],
  )

  return {
    tenantA, tenantB,
    userA, userB, superUser,
    memberA, memberB,
    gigA, gigB,
    tasks,
    rehearsalA, rehearsalB,
    bandEvents,
    slots,
    emailTemplates,
    venues,
    contacts,
    sharePhotos,
  }
}
