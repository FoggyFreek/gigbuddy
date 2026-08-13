import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => {
  await pool.end()
})

const as = (userId, tenantId = null) => (req) =>
  req
    .set('x-test-user-id', String(userId))
    .set('x-test-tenant-id', tenantId === null ? 'null' : String(tenantId))

async function createUser(email) {
  const { rows } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ($1, $2, $3, 'approved', false) RETURNING *`,
    [`sub-${email}`, email, email.split('@')[0]],
  )
  return rows[0]
}

async function createBand(displayName, {
  joinPolicy = 'request',
  kind = 'band',
  archived = false,
  ownerUserId = kind === 'personal' ? seed.userA.id : null,
} = {}) {
  const { rows: [tenant] } = await pool.query(
    `INSERT INTO tenants
       (slug, band_name, display_name, kind, join_policy, archived_at, created_by_user_id, owner_user_id)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      `t-${Math.random().toString(36).slice(2, 10)}`, displayName, kind, joinPolicy,
      archived ? new Date() : null, seed.userA.id, ownerUserId,
    ],
  )
  return tenant
}

async function membershipOf(userId, tenantId) {
  const { rows } = await pool.query(
    'SELECT status, role, source, request_message FROM memberships WHERE user_id = $1 AND tenant_id = $2',
    [userId, tenantId],
  )
  return rows[0] ?? null
}

describe('GET /api/band-directory/search', () => {
  it('finds only bands that opted in', async () => {
    const artist = await createUser('artist@test.local')
    const open = await createBand('Open Road Band')
    await createBand('Open Secret Band', { joinPolicy: 'invite_only' })

    const res = await as(artist.id)(request(app).get('/api/band-directory/search?q=Open')).expect(200)
    expect(res.body.items.map((b) => b.id)).toEqual([open.id])
    expect(res.body.items[0]).toEqual({
      id: open.id,
      slug: open.slug,
      displayName: 'Open Road Band',
      logoPath: null,
      membershipStatus: 'none',
    })
  })

  // Regression guard for every band that exists today: the column defaults to
  // invite_only, so nobody becomes findable by the migration alone.
  it('never returns a default (invite_only) band', async () => {
    const artist = await createUser('artist@test.local')
    const res = await as(artist.id)(request(app).get('/api/band-directory/search?q=Alpha')).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('never returns a personal workspace, even with join_policy tampered to request', async () => {
    const artist = await createUser('artist@test.local')
    await createBand('Solo Artist Person', { kind: 'personal', joinPolicy: 'request' })

    const res = await as(artist.id)(request(app).get('/api/band-directory/search?q=Solo')).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('never returns archived bands', async () => {
    const artist = await createUser('artist@test.local')
    await createBand('Retired Road Band', { archived: true })
    const res = await as(artist.id)(request(app).get('/api/band-directory/search?q=Retired')).expect(200)
    expect(res.body.items).toEqual([])
  })

  it('rejects a query under 3 characters and bounds the result count', async () => {
    const artist = await createUser('artist@test.local')
    const short = await as(artist.id)(request(app).get('/api/band-directory/search?q=ab')).expect(400)
    expect(short.body.error).toBe('query_too_short')

    for (let i = 0; i < 12; i++) await createBand(`Many Bands ${i}`)
    const res = await as(artist.id)(request(app).get('/api/band-directory/search?q=Many&limit=50')).expect(200)
    expect(res.body.items).toHaveLength(10)
  })

  it('labels a row with the caller\'s own membership status', async () => {
    const artist = await createUser('artist@test.local')
    const band = await createBand('Known Road Band')
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, source)
       VALUES ($1, $2, 'reader', 'pending', 'request')`,
      [artist.id, band.id],
    )

    const res = await as(artist.id)(request(app).get('/api/band-directory/search?q=Known')).expect(200)
    expect(res.body.items[0].membershipStatus).toBe('pending')
  })

  it('is case-insensitive', async () => {
    const artist = await createUser('artist@test.local')
    await createBand('Loud Quiet Loud')
    const res = await as(artist.id)(request(app).get('/api/band-directory/search?q=quiet')).expect(200)
    expect(res.body.items).toHaveLength(1)
  })
})

describe('POST /api/band-directory/join-requests', () => {
  it('creates a pending member request the artist can be asked about', async () => {
    const artist = await createUser('artist@test.local')
    const band = await createBand('Open Road Band')

    const res = await as(artist.id)(
      request(app).post('/api/band-directory/join-requests')
        .send({ tenantId: band.id, requestMessage: 'I play bass, we met at the club.' }),
    ).expect(201)

    expect(res.body).toEqual({
      tenant: { id: band.id, slug: band.slug, displayName: 'Open Road Band' },
      status: 'pending',
    })
    expect(await membershipOf(artist.id, band.id)).toEqual({
      status: 'pending',
      role: 'reader',
      source: 'request',
      request_message: 'I play bass, we met at the club.',
    })
  })

  it('succeeds without a message', async () => {
    const artist = await createUser('artist@test.local')
    const band = await createBand('Open Road Band')
    await as(artist.id)(
      request(app).post('/api/band-directory/join-requests').send({ tenantId: band.id }),
    ).expect(201)
    expect((await membershipOf(artist.id, band.id)).request_message).toBeNull()
  })

  it('fixes the role to the least privileged one even when the client asks for tenant_admin', async () => {
    const artist = await createUser('artist@test.local')
    const band = await createBand('Open Road Band')
    await as(artist.id)(
      request(app).post('/api/band-directory/join-requests')
        .send({ tenantId: band.id, role: 'tenant_admin' }),
    ).expect(201)
    expect((await membershipOf(artist.id, band.id)).role).toBe('reader')
  })

  it('404s for an invite_only band — existence is not leaked', async () => {
    const artist = await createUser('artist@test.local')
    const closed = await createBand('Closed Road Band', { joinPolicy: 'invite_only' })
    await as(artist.id)(
      request(app).post('/api/band-directory/join-requests').send({ tenantId: closed.id }),
    ).expect(404)
    expect(await membershipOf(artist.id, closed.id)).toBeNull()
  })

  it('404s for a nonexistent, archived, or personal target', async () => {
    const artist = await createUser('artist@test.local')
    const archived = await createBand('Retired Road Band', { archived: true })
    const personal = await createBand('Solo Artist', { kind: 'personal' })

    await as(artist.id)(request(app).post('/api/band-directory/join-requests').send({ tenantId: 999999 })).expect(404)
    await as(artist.id)(request(app).post('/api/band-directory/join-requests').send({ tenantId: archived.id })).expect(404)
    await as(artist.id)(request(app).post('/api/band-directory/join-requests').send({ tenantId: personal.id })).expect(404)
  })

  it('is idempotent while pending, and conflicts once approved', async () => {
    const artist = await createUser('artist@test.local')
    const band = await createBand('Open Road Band')

    await as(artist.id)(request(app).post('/api/band-directory/join-requests').send({ tenantId: band.id })).expect(201)
    const again = await as(artist.id)(
      request(app).post('/api/band-directory/join-requests').send({ tenantId: band.id }),
    ).expect(200)
    expect(again.body.status).toBe('pending')

    await pool.query(
      `UPDATE memberships SET status = 'approved' WHERE user_id = $1 AND tenant_id = $2`,
      [artist.id, band.id],
    )
    const conflict = await as(artist.id)(
      request(app).post('/api/band-directory/join-requests').send({ tenantId: band.id }),
    ).expect(409)
    expect(conflict.body.code).toBe('already_member')
  })

  it('keeps a rejected membership rejected — no re-asking on a loop', async () => {
    const artist = await createUser('artist@test.local')
    const band = await createBand('Open Road Band')
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, source)
       VALUES ($1, $2, 'reader', 'rejected', 'request')`,
      [artist.id, band.id],
    )

    await as(artist.id)(
      request(app).post('/api/band-directory/join-requests').send({ tenantId: band.id }),
    ).expect(404)
    expect((await membershipOf(artist.id, band.id)).status).toBe('rejected')
  })

  it('rejects a non-string or over-long message at the boundary', async () => {
    const artist = await createUser('artist@test.local')
    const band = await createBand('Open Road Band')

    const longRes = await as(artist.id)(
      request(app).post('/api/band-directory/join-requests')
        .send({ tenantId: band.id, requestMessage: 'x'.repeat(501) }),
    ).expect(400)
    expect(longRes.body.error).toBe('request_message_too_long')

    await as(artist.id)(
      request(app).post('/api/band-directory/join-requests')
        .send({ tenantId: band.id, requestMessage: { evil: true } }),
    ).expect(400)

    expect(await membershipOf(artist.id, band.id)).toBeNull()
  })

  it('notifies the band admins without carrying the message text', async () => {
    const artist = await createUser('artist@test.local')
    // seed.userA is tenant_admin of tenantA; opt that band into the directory.
    await pool.query(`UPDATE tenants SET join_policy = 'request' WHERE id = $1`, [seed.tenantA.id])

    await as(artist.id)(
      request(app).post('/api/band-directory/join-requests')
        .send({ tenantId: seed.tenantA.id, requestMessage: 'secret note about me' }),
    ).expect(201)

    const { rows } = await pool.query(
      `SELECT type, title, body, url FROM notifications
        WHERE tenant_id = $1 AND type = 'membership-requested'`,
      [seed.tenantA.id],
    )
    // One per admin who can approve; none of them carries the note.
    expect(rows.length).toBeGreaterThan(0)
    expect(JSON.stringify(rows)).not.toContain('secret note')
  })

  it('a pending request consumes no member-cap capacity; approval does', async () => {
    const artist = await createUser('artist@test.local')
    await pool.query(`UPDATE tenants SET join_policy = 'request' WHERE id = $1`, [seed.tenantA.id])

    const before = await pool.query(
      `SELECT COUNT(*)::int AS count FROM memberships WHERE tenant_id = $1 AND status = 'approved'`,
      [seed.tenantA.id],
    )
    await as(artist.id)(
      request(app).post('/api/band-directory/join-requests').send({ tenantId: seed.tenantA.id }),
    ).expect(201)
    const after = await pool.query(
      `SELECT COUNT(*)::int AS count FROM memberships WHERE tenant_id = $1 AND status = 'approved'`,
      [seed.tenantA.id],
    )
    expect(after.rows[0].count).toBe(before.rows[0].count)

    // Approval goes through the ordinary members.manage endpoint, unchanged.
    await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch(`/api/users/${artist.id}/membership`).send({ status: 'approved' }),
    ).expect(200)
    expect((await membershipOf(artist.id, seed.tenantA.id)).status).toBe('approved')
  })
})

describe('the outstanding join-request cap', () => {
  const requestJoin = (artistId, tenantId) =>
    as(artistId)(request(app).post('/api/band-directory/join-requests').send({ tenantId }))

  it('409s with join_request_limit on the fourth outstanding request', async () => {
    const artist = await createUser('artist@test.local')
    const bands = []
    for (let i = 0; i < 4; i++) bands.push(await createBand(`Open Road Band ${i}`))

    for (let i = 0; i < 3; i++) await requestJoin(artist.id, bands[i].id).expect(201)
    const res = await requestJoin(artist.id, bands[3].id).expect(409)
    expect(res.body.code).toBe('join_request_limit')
    expect(res.body.limit).toBe(3)
    // Deliberately outside the *_limit_reached family the billing UI reacts to.
    expect(res.body.code).not.toMatch(/_limit_reached$/)
    expect(await membershipOf(artist.id, bands[3].id)).toBeNull()
  })

  it('does not count pending rows that came from a redeemed invite', async () => {
    const artist = await createUser('artist@test.local')
    const bands = []
    for (let i = 0; i < 4; i++) bands.push(await createBand(`Open Road Band ${i}`))

    // Three admin-created pending rows: an admin's doing, never spam.
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO memberships (user_id, tenant_id, role, status, source)
         VALUES ($1, $2, 'reader', 'pending', 'invite')`,
        [artist.id, bands[i].id],
      )
    }
    await requestJoin(artist.id, bands[3].id).expect(201)
  })

  it('withdrawing frees a slot and re-requesting the same band then succeeds', async () => {
    const artist = await createUser('artist@test.local')
    const bands = []
    for (let i = 0; i < 4; i++) bands.push(await createBand(`Open Road Band ${i}`))
    for (let i = 0; i < 3; i++) await requestJoin(artist.id, bands[i].id).expect(201)

    await requestJoin(artist.id, bands[3].id).expect(409)
    await as(artist.id)(request(app).delete(`/api/band-directory/join-requests/${bands[0].id}`)).expect(204)
    await requestJoin(artist.id, bands[3].id).expect(201)

    // Back at the cap; freeing another slot lets the withdrawn band be re-asked.
    await requestJoin(artist.id, bands[0].id).expect(409)
    await as(artist.id)(request(app).delete(`/api/band-directory/join-requests/${bands[1].id}`)).expect(204)
    await requestJoin(artist.id, bands[0].id).expect(201)
  })

  it('approval and rejection also free a slot', async () => {
    const artist = await createUser('artist@test.local')
    const bands = []
    for (let i = 0; i < 5; i++) bands.push(await createBand(`Open Road Band ${i}`))
    for (let i = 0; i < 3; i++) await requestJoin(artist.id, bands[i].id).expect(201)

    await pool.query(
      `UPDATE memberships SET status = 'approved' WHERE user_id = $1 AND tenant_id = $2`,
      [artist.id, bands[0].id],
    )
    await requestJoin(artist.id, bands[3].id).expect(201)

    await pool.query(
      `UPDATE memberships SET status = 'rejected' WHERE user_id = $1 AND tenant_id = $2`,
      [artist.id, bands[1].id],
    )
    await requestJoin(artist.id, bands[4].id).expect(201)
  })

  // The user-row lock is what makes the check-then-insert atomic; without it
  // both requests count 2 and both commit, landing the artist at 4.
  it('two concurrent requests at the boundary cannot both commit', async () => {
    const artist = await createUser('artist@test.local')
    const bands = []
    for (let i = 0; i < 4; i++) bands.push(await createBand(`Open Road Band ${i}`))
    for (let i = 0; i < 2; i++) await requestJoin(artist.id, bands[i].id).expect(201)

    const [a, b] = await Promise.all([
      requestJoin(artist.id, bands[2].id),
      requestJoin(artist.id, bands[3].id),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 409])

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM memberships
        WHERE user_id = $1 AND status = 'pending' AND source = 'request'`,
      [artist.id],
    )
    expect(rows[0].count).toBe(3)
  })
})

describe('DELETE /api/band-directory/join-requests/:tenantId', () => {
  it('refuses an approved membership — leaving a band is a different operation', async () => {
    const artist = await createUser('artist@test.local')
    const band = await createBand('Open Road Band')
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, source, approved_at)
       VALUES ($1, $2, 'reader', 'approved', 'request', NOW())`,
      [artist.id, band.id],
    )

    await as(artist.id)(request(app).delete(`/api/band-directory/join-requests/${band.id}`)).expect(404)
    expect((await membershipOf(artist.id, band.id)).status).toBe('approved')
  })

  it("refuses another user's row", async () => {
    const artist = await createUser('artist@test.local')
    const other = await createUser('other@test.local')
    const band = await createBand('Open Road Band')
    await as(other.id)(
      request(app).post('/api/band-directory/join-requests').send({ tenantId: band.id }),
    ).expect(201)

    await as(artist.id)(request(app).delete(`/api/band-directory/join-requests/${band.id}`)).expect(404)
    expect(await membershipOf(other.id, band.id)).not.toBeNull()
  })

  it('lists the caller\'s own open requests only', async () => {
    const artist = await createUser('artist@test.local')
    const other = await createUser('other@test.local')
    const mine = await createBand('Mine Road Band')
    const theirs = await createBand('Theirs Road Band')
    await as(artist.id)(request(app).post('/api/band-directory/join-requests').send({ tenantId: mine.id })).expect(201)
    await as(other.id)(request(app).post('/api/band-directory/join-requests').send({ tenantId: theirs.id })).expect(201)

    const res = await as(artist.id)(request(app).get('/api/band-directory/join-requests')).expect(200)
    expect(res.body.items.map((r) => r.tenantId)).toEqual([mine.id])
  })
})

describe('PATCH /api/profile/join-policy', () => {
  it('lets a tenant admin opt the band in and back out', async () => {
    const opened = await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile/join-policy').send({ join_policy: 'request' }),
    ).expect(200)
    expect(opened.body.join_policy).toBe('request')

    const closed = await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile/join-policy').send({ join_policy: 'invite_only' }),
    ).expect(200)
    expect(closed.body.join_policy).toBe('invite_only')
  })

  it('rejects an unknown policy', async () => {
    const res = await as(seed.userA.id, seed.tenantA.id)(
      request(app).patch('/api/profile/join-policy').send({ join_policy: 'public' }),
    ).expect(400)
    expect(res.body.error).toBe('invalid_join_policy')
  })

  it('is refused in a personal workspace', async () => {
    const artist = await createUser('artist@test.local')
    const workspace = await createBand('Solo Artist', {
      kind: 'personal',
      joinPolicy: 'invite_only',
      ownerUserId: artist.id,
    })
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, source, approved_at)
       VALUES ($1, $2, 'tenant_admin', 'approved', 'owner', NOW())`,
      [artist.id, workspace.id],
    )

    const res = await as(artist.id, workspace.id)(
      request(app).patch('/api/profile/join-policy').send({ join_policy: 'request' }),
    ).expect(403)
    expect(res.body.code).toBe('tenant_kind_not_supported')
  })
})
