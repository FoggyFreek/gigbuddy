import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { seedDefaultPlans } from '../../../server/db/defaultPlans.js'

let app, pool, runMigrations, truncateAll, seedTwoTenants
let clearEntitlementCaches
let billing
let patchMember
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  app = appMod.createTestApp()
  const entMod = await import('../../../server/commerce/billing/entitlementService.js')
  clearEntitlementCaches = entMod.clearEntitlementCaches
  const rosterMod = await import('../../../server/people/roster/bandMemberService.js')
  patchMember = rosterMod.patchMember
  billing = await import('./_billing.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query('DELETE FROM subscription_plans')
  await seedDefaultPlans(pool)
  clearEntitlementCaches()
})

afterAll(async () => {
  await pool.end()
})

const asUserA = (req) =>
  req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
const asUserB = (req) =>
  req
    .set('x-test-user-id', String(seed.userB.id))
    .set('x-test-tenant-id', String(seed.tenantB.id))
const asSuper = (req) =>
  req
    .set('x-test-user-id', String(seed.superUser.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))

function createBody(slug = 'my-band', overrides = {}) {
  return { slug, band_name: 'My Band', country_code: 'nl', ...overrides }
}

describe('POST /api/tenants (self-service creation)', () => {
  it('creates an owned, seeded tenant with the creator as tenant_admin', async () => {
    const res = await asUserA(request(app).post('/api/tenants').send(createBody())).expect(201)
    expect(res.body.owner_user_id).toBe(seed.userA.id)
    expect(res.body.slug).toBe('my-band')

    const { rows: [membership] } = await pool.query(
      'SELECT role, status FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [seed.userA.id, res.body.id],
    )
    expect(membership).toEqual({ role: 'tenant_admin', status: 'approved' })

    const { rows: [accounts] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM chart_of_accounts WHERE tenant_id = $1',
      [res.body.id],
    )
    expect(accounts.count).toBeGreaterThan(0)

    const { rows: [stats] } = await pool.query(
      'SELECT 1 FROM tenant_statistics WHERE tenant_id = $1',
      [res.body.id],
    )
    expect(stats).toBeTruthy()
  })

  it('validates slug and band_name', async () => {
    await asUserA(request(app).post('/api/tenants').send({ slug: 'Bad Slug!', band_name: 'X', country_code: 'nl' })).expect(400)
    await asUserA(request(app).post('/api/tenants').send({ slug: 'ok-slug', country_code: 'nl' })).expect(400)
  })

  it('409s on a duplicate slug', async () => {
    await asUserA(request(app).post('/api/tenants').send(createBody('alpha'))).expect(409)
  })

  // The accounting country decides the bookkeeping jurisdiction and is immutable
  // afterwards, so it must be supplied rather than silently defaulting to nl.
  it('requires an accounting country and creates nothing without one', async () => {
    const { rows: [before] } = await pool.query('SELECT COUNT(*)::int AS count FROM tenants')

    let res = await asUserA(request(app).post('/api/tenants')
      .send({ slug: 'no-country', band_name: 'No Country' })).expect(400)
    expect(res.body.error).toBe('country_code_required')

    res = await asUserA(request(app).post('/api/tenants')
      .send({ slug: 'bad-country', band_name: 'Bad Country', country_code: 'zz' })).expect(400)
    expect(res.body.error).toBe('invalid_country_code')

    const { rows: [after] } = await pool.query('SELECT COUNT(*)::int AS count FROM tenants')
    expect(after.count).toBe(before.count)
  })

  it('creates the accounting profile in the same transaction as the tenant', async () => {
    const res = await asUserA(request(app).post('/api/tenants')
      .send(createBody('de-band', { country_code: 'de' }))).expect(201)

    const { rows: [profile] } = await pool.query(
      'SELECT * FROM tenant_accounting_profiles WHERE tenant_id = $1', [res.body.id],
    )
    expect(profile).toMatchObject({
      country_code: 'de',
      base_currency: 'EUR',
      profile_source: 'tenant_creation',
      profile_status: 'incomplete',
    })
    // The regime is not echoed onto the tenant payload any more.
    expect(res.body).not.toHaveProperty('vat_country')
  })

  it('seeds the chart of accounts with the requested country\'s labels', async () => {
    const nl = await asUserA(request(app).post('/api/tenants')
      .send(createBody('nl-band', { country_code: 'nl' }))).expect(201)
    const de = await asUserB(request(app).post('/api/tenants')
      .send(createBody('de-band', { country_code: 'de' }))).expect(201)

    const receivable = async (tenantId) => (await pool.query(
      `SELECT name, default_name, name_is_customized
         FROM chart_of_accounts WHERE tenant_id = $1 AND code = '11200'`,
      [tenantId],
    )).rows[0]

    expect(await receivable(nl.body.id)).toEqual({
      name: 'Debiteuren', default_name: 'Debiteuren', name_is_customized: false,
    })
    // No pack for de, so the English base — never another country's labels.
    expect(await receivable(de.body.id)).toEqual({
      name: 'Accounts Receivable', default_name: 'Accounts Receivable', name_is_customized: false,
    })

    // The profile records which registry revision produced those labels.
    const packVersion = async (tenantId) => (await pool.query(
      'SELECT pack_version FROM tenant_accounting_profiles WHERE tenant_id = $1',
      [tenantId],
    )).rows[0].pack_version
    expect(await packVersion(nl.body.id)).toBe('nl-pack-2026.1')
    expect(await packVersion(de.body.id)).toBe('de-pack-2026.1')
  })

  it('a generated slug keeps the requested country through every retry', async () => {
    await asUserA(request(app).post('/api/tenants')
      .send({ band_name: 'Retry Band', country_code: 'fr' })).expect(201)
    // Different user: bronze caps userA at one band.
    const res = await asUserB(request(app).post('/api/tenants')
      .send({ band_name: 'Retry Band', country_code: 'gb' })).expect(201)

    expect(res.body.slug).toBe('retry-band-2')
    const { rows: [profile] } = await pool.query(
      'SELECT country_code, base_currency FROM tenant_accounting_profiles WHERE tenant_id = $1',
      [res.body.id],
    )
    expect(profile).toEqual({ country_code: 'gb', base_currency: 'GBP' })
  })

  it('enforces the band cap (no subscription → fallback bronze: 1 band)', async () => {
    await asUserA(request(app).post('/api/tenants').send(createBody('band-one'))).expect(201)
    const res = await asUserA(request(app).post('/api/tenants').send(createBody('band-two'))).expect(409)
    expect(res.body.code).toBe('band_limit_reached')
    expect(res.body.limit).toBe(1)
  })

  it('gold owners create unlimited bands', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'gold' })
    for (const slug of ['band-one', 'band-two', 'band-three']) {
      await asUserA(request(app).post('/api/tenants').send(createBody(slug))).expect(201)
    }
  })

  it('a pending-downgrade snapshot binds the band cap immediately', async () => {
    await billing.createSubscription({
      userId: seed.userA.id,
      planSlug: 'gold',
      pending_limits_snapshot: { bands: 1 },
    })
    await asUserA(request(app).post('/api/tenants').send(createBody('band-one'))).expect(201)
    const res = await asUserA(request(app).post('/api/tenants').send(createBody('band-two'))).expect(409)
    expect(res.body.code).toBe('band_limit_reached')
  })

  it('archived tenants do not count toward the cap', async () => {
    const first = await asUserA(request(app).post('/api/tenants').send(createBody('band-one'))).expect(201)
    await asUserA(request(app).post(`/api/tenants/${first.body.id}/archive`)).expect(200)
    await asUserA(request(app).post('/api/tenants').send(createBody('band-two'))).expect(201)
  })
})

describe('POST /api/tenants/personal (artist workspace)', () => {
  const personalBody = (overrides = {}) => ({ country_code: 'nl', ...overrides })

  // In the caller's own workspace, x-test-tenant-id must point at it.
  const inWorkspace = (req, tenantId) =>
    req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(tenantId))

  it('creates a single-member sole-trader workspace named after the user', async () => {
    const res = await asUserA(request(app).post('/api/tenants/personal').send(personalBody()))
      .expect(201)
    expect(res.body.kind).toBe('personal')
    expect(res.body.display_name).toBe('Alpha User')
    expect(res.body.owner_user_id).toBe(seed.userA.id)

    const { rows: memberships } = await pool.query(
      'SELECT user_id, role, status FROM memberships WHERE tenant_id = $1', [res.body.id],
    )
    expect(memberships).toEqual([
      { user_id: seed.userA.id, role: 'tenant_admin', status: 'approved' },
    ])

    const { rows: roster } = await pool.query(
      `SELECT name, roles, color, sort_order, position, user_id
         FROM band_members WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [res.body.id],
    )
    expect(roster).toEqual([{
      name: 'Alpha User',
      roles: [],
      color: null,
      sort_order: 0,
      position: 'lead',
      user_id: seed.userA.id,
    }])

    const { rows: [accounts] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM chart_of_accounts WHERE tenant_id = $1', [res.body.id],
    )
    expect(accounts.count).toBeGreaterThan(0)
  })

  it('records the accounting profile as a sole trader in the requested country', async () => {
    const res = await asUserA(request(app).post('/api/tenants/personal')
      .send(personalBody({ country_code: 'de' }))).expect(201)

    const { rows: [profile] } = await pool.query(
      'SELECT * FROM tenant_accounting_profiles WHERE tenant_id = $1', [res.body.id],
    )
    expect(profile).toMatchObject({
      country_code: 'de',
      legal_form: 'sole_trader',
      profile_source: 'tenant_creation',
    })
  })

  it('is idempotent: a second attempt returns the first workspace', async () => {
    const first = await asUserA(request(app).post('/api/tenants/personal').send(personalBody()))
      .expect(201)
    // A different country on the retry must not create (or move) anything.
    const second = await asUserA(request(app).post('/api/tenants/personal')
      .send(personalBody({ country_code: 'fr' }))).expect(200)
    expect(second.body.id).toBe(first.body.id)

    const { rows: [count] } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM tenants WHERE kind = 'personal'",
    )
    expect(count.count).toBe(1)
  })

  it('two concurrent creates still yield exactly one workspace', async () => {
    const [a, b] = await Promise.all([
      asUserA(request(app).post('/api/tenants/personal').send(personalBody())),
      asUserA(request(app).post('/api/tenants/personal').send(personalBody())),
    ])
    expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true)
    expect(a.body.id).toBe(b.body.id)
  })

  it('does not count toward the band cap', async () => {
    // Bronze fallback allows one band. The workspace must not consume it…
    await asUserA(request(app).post('/api/tenants/personal').send(personalBody())).expect(201)
    await asUserA(request(app).post('/api/tenants').send(createBody('still-allowed'))).expect(201)
    // …and the band cap still bites afterwards.
    const res = await asUserA(request(app).post('/api/tenants').send(createBody('one-too-many')))
      .expect(409)
    expect(res.body.code).toBe('band_limit_reached')
  })

  // An artist subscription says nothing about how many bands you may own: the
  // band cap reads the BAND ladder, where this user is still on the free floor.
  // artist_gold's `bands: 0` is vestigial.
  it('an artist plan leaves the band allowance to the band ladder', async () => {
    await billing.createSubscription({ userId: seed.userA.id, planSlug: 'artist_gold' })
    await asUserA(request(app).post('/api/tenants/personal').send(personalBody())).expect(201)
    // Bronze (the band floor) still grants one band…
    await asUserA(request(app).post('/api/tenants').send(createBody('still-allowed'))).expect(201)
    // …and its cap, not the artist plan's, is what finally bites.
    const res = await asUserA(request(app).post('/api/tenants').send(createBody('one-too-many')))
      .expect(409)
    expect(res.body.code).toBe('band_limit_reached')
    expect(res.body.limit).toBe(1)
  })

  it('requires an accounting country', async () => {
    const res = await asUserA(request(app).post('/api/tenants/personal').send({})).expect(400)
    expect(res.body.error).toBe('country_code_required')
  })

  it('403s with tenant_onboarding_disabled when the platform switch is off', async () => {
    await asSuper(
      request(app).patch('/api/admin/platform-settings/tenant-onboarding')
        .send({ tenantOnboardingEnabled: false }),
    ).expect(200)

    const res = await asUserA(request(app).post('/api/tenants/personal').send(personalBody()))
      .expect(403)
    expect(res.body.code).toBe('tenant_onboarding_disabled')

    const { rows: [count] } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM tenants WHERE kind = 'personal'",
    )
    expect(count.count).toBe(0)
  })

  it('exposes only the fixed member roles inside the workspace', async () => {
    const ws = await asUserA(request(app).post('/api/tenants/personal').send(personalBody()))
      .expect(201)

    const invite = await inWorkspace(request(app).post('/api/invites'), ws.body.id)
      .send({ role: 'member' }).expect(403)
    expect(invite.body.code).toBe('tenant_kind_not_supported')

    const roster = await inWorkspace(request(app).get('/api/band-members'), ws.body.id).expect(200)
    expect(roster.body).toHaveLength(1)
    expect(roster.body[0]).toMatchObject({ name: 'Alpha User', user_id: seed.userA.id, roles: [] })

    const updated = await inWorkspace(
      request(app).patch(`/api/band-members/${roster.body[0].id}`), ws.body.id,
    ).send({ roles: ['Lead Vocals', 'Piano'] }).expect(200)
    expect(updated.body.roles).toEqual(['Lead Vocals', 'Piano'])

    const forbiddenPatch = await inWorkspace(
      request(app).patch(`/api/band-members/${roster.body[0].id}`), ws.body.id,
    ).send({ name: 'Not the profile name' }).expect(403)
    expect(forbiddenPatch.body.code).toBe('tenant_kind_not_supported')

    const createMember = await inWorkspace(request(app).post('/api/band-members'), ws.body.id)
      .send({ name: 'Second artist' }).expect(403)
    expect(createMember.body.code).toBe('tenant_kind_not_supported')

    const deleteMember = await inWorkspace(
      request(app).delete(`/api/band-members/${roster.body[0].id}`), ws.body.id,
    ).expect(403)
    expect(deleteMember.body.code).toBe('tenant_kind_not_supported')

    await inWorkspace(
      request(app).patch(`/api/band-members/${seed.memberB.id}`), ws.body.id,
    ).send({ roles: ['Drums'] }).expect(404)

    await inWorkspace(request(app).get('/api/setlists'), ws.body.id).expect(403)
    await inWorkspace(request(app).get('/api/profile/bandsintown-key'), ws.body.id).expect(403)
    await inWorkspace(request(app).get('/api/profile/shopify-client-id'), ws.body.id).expect(403)
    const profileField = await inWorkspace(request(app).patch('/api/profile'), ws.body.id)
      .send({ bandsintown_artist_id: 'artist-123' }).expect(403)
    expect(profileField.body.code).toBe('tenant_kind_not_supported')
    await inWorkspace(
      request(app).patch(`/api/users/${seed.userB.id}/membership`), ws.body.id,
    ).send({ status: 'approved' }).expect(403)

    // Planning and the books are exactly the point of the workspace.
    await inWorkspace(request(app).get('/api/gigs'), ws.body.id).expect(200)
  })

  it('keeps the fixed member name synchronized with the artist profile', async () => {
    const ws = await asUserA(request(app).post('/api/tenants/personal').send(personalBody()))
      .expect(201)

    await inWorkspace(request(app).patch('/api/profile'), ws.body.id)
      .send({ band_name: 'Alpha Artist' }).expect(200)

    const { rows: [tenant] } = await pool.query(
      'SELECT band_name, display_name FROM tenants WHERE id = $1', [ws.body.id],
    )
    expect(tenant).toEqual({ band_name: 'Alpha Artist', display_name: 'Alpha Artist' })

    const roster = await inWorkspace(request(app).get('/api/band-members'), ws.body.id).expect(200)
    expect(roster.body).toHaveLength(1)
    expect(roster.body[0].name).toBe('Alpha Artist')
  })

  it('waits for the personal tenant lock before locking its fixed member', async () => {
    const ws = await asUserA(request(app).post('/api/tenants/personal').send(personalBody()))
      .expect(201)
    const { rows: [member] } = await pool.query(
      'SELECT id FROM band_members WHERE tenant_id = $1 AND deleted_at IS NULL', [ws.body.id],
    )

    const tenantLocker = await pool.connect()
    const rolesClient = await pool.connect()
    let rolesWrite
    let lockError = null
    try {
      await tenantLocker.query('BEGIN')
      await tenantLocker.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [ws.body.id])
      const { rows: [{ pid }] } = await rolesClient.query('SELECT pg_backend_pid() AS pid')

      rolesWrite = patchMember(
        { connect: async () => rolesClient },
        ws.body.id,
        member.id,
        { roles: ['Piano'] },
        seed.userA.id,
        'personal',
      )

      for (let attempt = 0; attempt < 100; attempt++) {
        const { rows: [activity] } = await pool.query(
          'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid],
        )
        if (activity?.wait_event_type === 'Lock') break
        if (attempt === 99) throw new Error('roles update did not wait for the tenant lock')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      try {
        await pool.query(
          'SELECT id FROM band_members WHERE id = $1 FOR UPDATE NOWAIT', [member.id],
        )
      } catch (err) {
        lockError = err
      }
    } finally {
      await tenantLocker.query('ROLLBACK')
      tenantLocker.release()
    }

    const result = await rolesWrite
    expect(lockError).toBeNull()
    expect(result.member.roles).toEqual(['Piano'])
  })

  it('does not lock a band tenant row for ordinary roster writes', async () => {
    const tenantLocker = await pool.connect()
    const memberWriter = await pool.connect()
    const writeErrors = []
    try {
      await tenantLocker.query('BEGIN')
      await tenantLocker.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [seed.tenantA.id])

      await memberWriter.query('BEGIN')
      await memberWriter.query("SET LOCAL lock_timeout = '100ms'")
      try {
        await memberWriter.query(
          `UPDATE band_members SET roles = ARRAY['Piano']::TEXT[] WHERE id = $1`,
          [seed.memberA.id],
        )
      } catch (err) {
        writeErrors.push(err)
      }
      try {
        await memberWriter.query('DELETE FROM band_members WHERE id = $1', [seed.memberA.id])
      } catch (err) {
        writeErrors.push(err)
      }
    } finally {
      await memberWriter.query('ROLLBACK')
      await tenantLocker.query('ROLLBACK')
      memberWriter.release()
      tenantLocker.release()
    }

    expect(writeErrors).toEqual([])
  })

  it('uses the fixed member as the sole participant in every personal event', async () => {
    const ws = await asUserA(request(app).post('/api/tenants/personal').send(personalBody()))
      .expect(201)
    const { rows: [member] } = await pool.query(
      'SELECT id FROM band_members WHERE tenant_id = $1 AND deleted_at IS NULL', [ws.body.id],
    )

    const gig = await inWorkspace(request(app).post('/api/gigs'), ws.body.id)
      .send({ event_date: '2027-06-01', event_description: 'Solo gig' }).expect(201)
    const rehearsal = await inWorkspace(request(app).post('/api/rehearsals'), ws.body.id)
      .send({ proposed_date: '2027-06-02' }).expect(201)
    const bandEvent = await inWorkspace(request(app).post('/api/band-events'), ws.body.id)
      .send({ title: 'Studio day', start_date: '2027-06-03' }).expect(201)

    const participantQueries = [
      ['gig_participants', 'gig_id', gig.body.id],
      ['rehearsal_participants', 'rehearsal_id', rehearsal.body.id],
      ['band_event_participants', 'band_event_id', bandEvent.body.id],
    ]
    for (const [table, eventColumn, eventId] of participantQueries) {
      const { rows } = await pool.query(
        `SELECT band_member_id FROM ${table} WHERE ${eventColumn} = $1`, [eventId],
      )
      expect(rows).toEqual([{ band_member_id: member.id }])
    }

    const removals = [
      `/api/gigs/${gig.body.id}/participants/${member.id}`,
      `/api/rehearsals/${rehearsal.body.id}/participants/${member.id}`,
      `/api/band-events/${bandEvent.body.id}/participants/${member.id}`,
    ]
    for (const path of removals) {
      const res = await inWorkspace(request(app).delete(path), ws.body.id).expect(409)
      expect(res.body.code).toBe('last_participant')
    }
  })

  it('does not remove the last participant from band events either', async () => {
    const gig = await asUserA(request(app).post('/api/gigs'))
      .send({ event_date: '2027-07-01', event_description: 'Band gig' }).expect(201)
    const rehearsal = await asUserA(request(app).post('/api/rehearsals'))
      .send({ proposed_date: '2027-07-02' }).expect(201)
    const bandEvent = await asUserA(request(app).post('/api/band-events'))
      .send({ title: 'Band day', start_date: '2027-07-03' }).expect(201)

    const removals = [
      `/api/gigs/${gig.body.id}/participants/${seed.memberA.id}`,
      `/api/rehearsals/${rehearsal.body.id}/participants/${seed.memberA.id}`,
      `/api/band-events/${bandEvent.body.id}/participants/${seed.memberA.id}`,
    ]
    for (const path of removals) {
      const res = await asUserA(request(app).delete(path)).expect(409)
      expect(res.body.code).toBe('last_participant')
    }
  })

  it('serializes concurrent participant removals so one participant remains', async () => {
    const optional = await asUserA(request(app).post('/api/band-members'))
      .send({ name: 'Optional player', position: 'optional', roles: [] }).expect(201)
    const cases = [
      {
        create: () => asUserA(request(app).post('/api/gigs'))
          .send({ event_date: '2027-08-01', event_description: 'Concurrent gig' }),
        resource: 'gigs',
      },
      {
        create: () => asUserA(request(app).post('/api/rehearsals'))
          .send({ proposed_date: '2027-08-02' }),
        resource: 'rehearsals',
      },
      {
        create: () => asUserA(request(app).post('/api/band-events'))
          .send({ title: 'Concurrent event', start_date: '2027-08-03' }),
        resource: 'band-events',
      },
    ]

    for (const eventCase of cases) {
      const created = await eventCase.create().expect(201)
      await asUserA(request(app).post(`/api/${eventCase.resource}/${created.body.id}/participants`))
        .send({ band_member_id: optional.body.id }).expect(201)

      const responses = await Promise.all([
        asUserA(request(app).delete(
          `/api/${eventCase.resource}/${created.body.id}/participants/${seed.memberA.id}`,
        )),
        asUserA(request(app).delete(
          `/api/${eventCase.resource}/${created.body.id}/participants/${optional.body.id}`,
        )),
      ])
      expect(responses.map((response) => response.status).sort()).toEqual([204, 409])
      expect(responses.find((response) => response.status === 409).body.code).toBe('last_participant')
    }
  })

  it('enforces exactly one active owner-linked member at the database boundary', async () => {
    const ws = await asUserA(request(app).post('/api/tenants/personal').send(personalBody()))
      .expect(201)
    const { rows: [member] } = await pool.query(
      'SELECT id FROM band_members WHERE tenant_id = $1 AND deleted_at IS NULL', [ws.body.id],
    )

    await expect(pool.query(
      `INSERT INTO band_members (tenant_id, name, position, sort_order)
       VALUES ($1, 'Extra', 'lead', 1)`, [ws.body.id],
    )).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(
      'UPDATE band_members SET user_id = NULL WHERE id = $1', [member.id],
    )).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(
      `UPDATE band_members SET name = 'Detached artist' WHERE id = $1`, [member.id],
    )).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(
      'UPDATE band_members SET tenant_id = $2 WHERE id = $1', [member.id, seed.tenantB.id],
    )).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(
      'UPDATE band_members SET deleted_at = NOW() WHERE id = $1', [member.id],
    )).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(
      'DELETE FROM band_members WHERE id = $1', [member.id],
    )).rejects.toMatchObject({ code: '23514' })
  })

  it('refuses even a super admin adding a second member', async () => {
    const ws = await asUserA(request(app).post('/api/tenants/personal').send(personalBody()))
      .expect(201)

    const res = await asSuper(
      request(app).post(`/api/admin/tenants/${ws.body.id}/memberships`)
        .send({ userId: seed.userB.id, role: 'contributor' }),
    ).expect(403)
    expect(res.body.code).toBe('tenant_kind_not_supported')

    await asSuper(
      request(app).post(`/api/admin/tenants/${ws.body.id}/admins`).send({ userId: seed.userB.id }),
    ).expect(403)
  })

  it('keeps the workspace invisible to everyone but its owner', async () => {
    const ws = await asUserA(request(app).post('/api/tenants/personal').send(personalBody()))
      .expect(201)

    // No membership exists for anyone else, so the tenant can't be activated…
    const { rows } = await pool.query(
      'SELECT user_id FROM memberships WHERE tenant_id = $1', [ws.body.id],
    )
    expect(rows.map((r) => r.user_id)).toEqual([seed.userA.id])

    // …and asking for it as the active tenant is refused, not served.
    await request(app).get('/api/gigs')
      .set('x-test-user-id', String(seed.userB.id))
      .set('x-test-tenant-id', String(ws.body.id))
      .expect(403)

    // Owner-scoped management stays 404 for a non-owner (existence not leaked).
    await asUserB(request(app).post(`/api/tenants/${ws.body.id}/archive`)).expect(404)
  })
})

describe('tenant onboarding platform setting', () => {
  it('defaults to enabled', async () => {
    const res = await asUserA(request(app).get('/api/tenants/onboarding-status')).expect(200)
    expect(res.body).toEqual({ tenantOnboardingEnabled: true })
  })

  it('is super-admin managed', async () => {
    await asUserA(
      request(app)
        .patch('/api/admin/platform-settings/tenant-onboarding')
        .send({ tenantOnboardingEnabled: false }),
    ).expect(403)

    const disabled = await asSuper(
      request(app)
        .patch('/api/admin/platform-settings/tenant-onboarding')
        .send({ tenantOnboardingEnabled: false }),
    ).expect(200)
    expect(disabled.body).toEqual({ tenantOnboardingEnabled: false })

    const enabled = await asSuper(
      request(app)
        .patch('/api/admin/platform-settings/tenant-onboarding')
        .send({ tenantOnboardingEnabled: true }),
    ).expect(200)
    expect(enabled.body).toEqual({ tenantOnboardingEnabled: true })
  })

  it('blocks self-service tenant creation without writing tenant data', async () => {
    await asSuper(
      request(app)
        .patch('/api/admin/platform-settings/tenant-onboarding')
        .send({ tenantOnboardingEnabled: false }),
    ).expect(200)

    const { rows: [before] } = await pool.query('SELECT COUNT(*)::int AS count FROM tenants')
    const res = await asUserA(request(app).post('/api/tenants').send(createBody('blocked-band'))).expect(403)
    expect(res.body.code).toBe('tenant_onboarding_disabled')

    const { rows: [after] } = await pool.query('SELECT COUNT(*)::int AS count FROM tenants')
    expect(after.count).toBe(before.count)
  })

  it('does not block super-admin tenant creation', async () => {
    await asSuper(
      request(app)
        .patch('/api/admin/platform-settings/tenant-onboarding')
        .send({ tenantOnboardingEnabled: false }),
    ).expect(200)

    const created = await asSuper(
      request(app).post('/api/admin/tenants').send({ slug: 'admin-created', band_name: 'Admin Created', country_code: 'nl' }),
    ).expect(201)
    expect(created.body.slug).toBe('admin-created')
  })
})

describe('POST /api/tenants (server-generated slug)', () => {
  it('generates a slug from band_name when slug is omitted', async () => {
    const res = await asUserA(
      request(app).post('/api/tenants').send({ band_name: 'Thé Bänd!!', country_code: 'nl' }),
    ).expect(201)
    expect(res.body.slug).toBe('the-band')
    expect(res.body.band_name).toBe('Thé Bänd!!')
  })

  it('suffixes -2 when the generated slug is taken', async () => {
    await asUserA(request(app).post('/api/tenants').send({ band_name: 'The Band', country_code: 'nl' })).expect(201)
    // Different user (bronze bands:1 caps userA at one band).
    const res = await asUserB(
      request(app).post('/api/tenants').send({ band_name: 'The Band', country_code: 'nl' }),
    ).expect(201)
    expect(res.body.slug).toBe('the-band-2')
  })

  it('two users creating the same name concurrently get distinct slugs', async () => {
    const [a, b] = await Promise.all([
      asUserA(request(app).post('/api/tenants').send({ band_name: 'Race Band', country_code: 'nl' })),
      asUserB(request(app).post('/api/tenants').send({ band_name: 'Race Band', country_code: 'nl' })),
    ])
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect([a.body.slug, b.body.slug].sort()).toEqual(['race-band', 'race-band-2'])
  })

  it('truncates a long band name so the suffixed slug stays valid', async () => {
    const longName = 'X'.repeat(80)
    const first = await asUserA(request(app).post('/api/tenants').send({ band_name: longName, country_code: 'nl' })).expect(201)
    expect(first.body.slug.length).toBeLessThanOrEqual(64)
    const second = await asUserB(request(app).post('/api/tenants').send({ band_name: longName, country_code: 'nl' })).expect(201)
    expect(second.body.slug.length).toBeLessThanOrEqual(64)
    expect(second.body.slug).toMatch(/-2$/)
  })

  it('an all-symbols band name falls back to "band"', async () => {
    const res = await asUserA(
      request(app).post('/api/tenants').send({ band_name: '!!! ***', country_code: 'nl' }),
    ).expect(201)
    expect(res.body.slug).toBe('band')
  })

  it('a supplied slug is still validated and still conflicts', async () => {
    await asUserA(request(app).post('/api/tenants').send({ slug: 'Bad Slug!', band_name: 'X', country_code: 'nl' })).expect(400)
    await asUserA(request(app).post('/api/tenants').send({ slug: 'alpha', band_name: 'X', country_code: 'nl' })).expect(409)
  })

  it('onboarding: true records the onboarding tenant pointer; a plain create does not', async () => {
    const res = await asUserA(
      request(app).post('/api/tenants').send({ band_name: 'Onboard Band', onboarding: true, country_code: 'nl' }),
    ).expect(201)
    const { rows: [rowA] } = await pool.query(
      'SELECT onboarding_tenant_id FROM users WHERE id = $1', [seed.userA.id],
    )
    expect(rowA.onboarding_tenant_id).toBe(res.body.id)

    await asUserB(request(app).post('/api/tenants').send({ band_name: 'Plain Band', country_code: 'nl' })).expect(201)
    const { rows: [rowB] } = await pool.query(
      'SELECT onboarding_tenant_id FROM users WHERE id = $1', [seed.userB.id],
    )
    expect(rowB.onboarding_tenant_id).toBeNull()
  })
})

describe('GET /api/tenants/owned', () => {
  it('lists only the tenants the caller owns', async () => {
    const created = await asUserA(request(app).post('/api/tenants').send(createBody())).expect(201)
    const res = await asUserA(request(app).get('/api/tenants/owned')).expect(200)
    expect(res.body.map((t) => t.id)).toEqual([created.body.id])
    const other = await asUserB(request(app).get('/api/tenants/owned')).expect(200)
    expect(other.body).toEqual([])
  })
})

describe('archive / unarchive', () => {
  let ownedId

  beforeEach(async () => {
    const res = await asUserA(request(app).post('/api/tenants').send(createBody())).expect(201)
    ownedId = res.body.id
  })

  it('owner can archive and unarchive', async () => {
    const archived = await asUserA(request(app).post(`/api/tenants/${ownedId}/archive`)).expect(200)
    expect(archived.body.archived_at).not.toBeNull()
    const restored = await asUserA(request(app).post(`/api/tenants/${ownedId}/unarchive`)).expect(200)
    expect(restored.body.archived_at).toBeNull()
  })

  it('non-owners get 404, not 403 (existence is not leaked)', async () => {
    await asUserB(request(app).post(`/api/tenants/${ownedId}/archive`)).expect(404)
    await asUserB(request(app).post(`/api/tenants/${ownedId}/unarchive`)).expect(404)
    // Even a super admin uses the admin endpoints, not the owner ones.
    await asSuper(request(app).post(`/api/tenants/${ownedId}/archive`)).expect(404)
  })

  it('unarchive re-checks the band cap (archiving is not a parking loophole)', async () => {
    // Bronze fallback: 1 active band. Park the first, create a second.
    await asUserA(request(app).post(`/api/tenants/${ownedId}/archive`)).expect(200)
    await asUserA(request(app).post('/api/tenants').send(createBody('band-two'))).expect(201)
    // Swapping the first back in would make 2 active → 409.
    const res = await asUserA(request(app).post(`/api/tenants/${ownedId}/unarchive`)).expect(409)
    expect(res.body.code).toBe('band_limit_reached')
  })

  it('unarchives a personal workspace even when the band allowance is full', async () => {
    const workspace = await asUserA(
      request(app).post('/api/tenants/personal').send({ country_code: 'nl' }),
    ).expect(201)
    await asUserA(request(app).post(`/api/tenants/${workspace.body.id}/archive`)).expect(200)

    const restored = await asUserA(
      request(app).post(`/api/tenants/${workspace.body.id}/unarchive`),
    ).expect(200)
    expect(restored.body).toMatchObject({ id: workspace.body.id, kind: 'personal', archived_at: null })
  })
})

describe('admin owner assignment (PATCH /api/admin/tenants/:id)', () => {
  it('assigns and detaches an owner', async () => {
    const res = await asSuper(
      request(app).patch(`/api/admin/tenants/${seed.tenantA.id}`).send({ owner_user_id: seed.userA.id }),
    ).expect(200)
    expect(res.body.owner_user_id).toBe(seed.userA.id)

    const detached = await asSuper(
      request(app).patch(`/api/admin/tenants/${seed.tenantA.id}`).send({ owner_user_id: null }),
    ).expect(200)
    expect(detached.body.owner_user_id).toBeNull()
  })

  it('rejects invalid owners', async () => {
    await asSuper(
      request(app).patch(`/api/admin/tenants/${seed.tenantA.id}`).send({ owner_user_id: 999999 }),
    ).expect(400)
    await asSuper(
      request(app).patch(`/api/admin/tenants/${seed.tenantA.id}`).send({ owner_user_id: 'abc' }),
    ).expect(400)
  })

  it('is super-admin only', async () => {
    await asUserA(
      request(app).patch(`/api/admin/tenants/${seed.tenantA.id}`).send({ owner_user_id: seed.userA.id }),
    ).expect(403)
  })
})
