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

function asUser(user, tenant, req) {
  return req
    .set('x-test-user-id', String(user.id))
    .set('x-test-tenant-id', String(tenant.id))
}

async function addMember(tenantId, name) {
  const { rows: [member] } = await pool.query(
    `INSERT INTO band_members (tenant_id, name, position)
     VALUES ($1, $2, 'lead') RETURNING id`,
    [tenantId, name],
  )
  return member
}

async function addParticipant(kind, tenantId, optionId, memberId) {
  const table = kind === 'gig' ? 'gig_participants' : 'rehearsal_participants'
  const parentColumn = kind === 'gig' ? 'gig_id' : 'rehearsal_id'
  await pool.query(
    `INSERT INTO ${table} (tenant_id, ${parentColumn}, band_member_id)
     VALUES ($1, $2, $3)`,
    [tenantId, optionId, memberId],
  )
}

function votePath(kind, optionId, memberId) {
  const collection = kind === 'gig' ? 'gigs' : 'rehearsals'
  return `/api/${collection}/${optionId}/participants/${memberId}`
}

async function vote(kind, optionId, memberId, value, expectedStatus = 200) {
  return asUser(
    seed.userA,
    seed.tenantA,
    request(app).patch(votePath(kind, optionId, memberId)).send({ vote: value }),
  ).expect(expectedStatus)
}

async function notificationRows(type, sourceType, sourceId) {
  const { rows } = await pool.query(
    `SELECT user_id, tenant_id, type, title, body, url, source_type, source_id
     FROM notifications
     WHERE type = $1 AND source_type = $2 AND source_id = $3
     ORDER BY user_id`,
    [type, sourceType, sourceId],
  )
  return rows
}

describe.sequential('option response notifications', () => {
  describe.each([
    { kind: 'gig', option: () => seed.gigA, label: 'Alpha Gig', url: () => `/gigs/${seed.gigA.id}` },
    { kind: 'rehearsal', option: () => seed.rehearsalA, label: '2026-06-10', url: () => `/rehearsals/${seed.rehearsalA.id}` },
  ])('$kind option response notifications', ({ kind, option, label, url }) => {
  it("notifies planning organizers only for the first 'no'", async () => {
    const first = seed.memberA
    const second = await addMember(seed.tenantA.id, 'Second lead')
    await addParticipant(kind, seed.tenantA.id, option().id, first.id)
    await addParticipant(kind, seed.tenantA.id, option().id, second.id)

    await vote(kind, option().id, first.id, 'no')
    await vote(kind, option().id, first.id, 'yes')
    await vote(kind, option().id, second.id, 'no')

    const rows = await notificationRows('option-member-unavailable', kind, option().id)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.user_id)).toEqual([seed.userA.id, seed.superUser.id].sort((a, b) => a - b))
    expect(rows.every((row) => row.tenant_id === seed.tenantA.id)).toBe(true)
    expect(rows[0]).toMatchObject({
      title: `One or more band members aren't available for option ${label}`,
      url: url(),
    })
    expect(rows.some((row) => row.user_id === seed.userB.id)).toBe(false)
  })

  it('notifies whenever all required participants transition from pending to responded', async () => {
    const first = seed.memberA
    const second = await addMember(seed.tenantA.id, 'Second lead')
    await addParticipant(kind, seed.tenantA.id, option().id, first.id)
    await addParticipant(kind, seed.tenantA.id, option().id, second.id)

    await vote(kind, option().id, first.id, 'yes')
    expect(await notificationRows('option-all-responded', kind, option().id)).toHaveLength(0)

    await vote(kind, option().id, second.id, 'yes')
    expect(await notificationRows('option-all-responded', kind, option().id)).toHaveLength(2)

    // The option remains complete while an existing answer changes.
    await vote(kind, option().id, second.id, 'no')
    expect(await notificationRows('option-all-responded', kind, option().id)).toHaveLength(2)

    // A newly required member makes it incomplete; their response completes it again.
    const third = await addMember(seed.tenantA.id, 'Third lead')
    await addParticipant(kind, seed.tenantA.id, option().id, third.id)
    await vote(kind, option().id, third.id, 'yes')

    const rows = await notificationRows('option-all-responded', kind, option().id)
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({
      title: `All required band members have responded for option ${label}`,
      url: url(),
    })
  })
  })

  it('keeps notification-triggering vote writes tenant-isolated', async () => {
    await addParticipant('gig', seed.tenantB.id, seed.gigB.id, seed.memberB.id)

    await asUser(
      seed.userA,
      seed.tenantA,
      request(app)
        .patch(votePath('gig', seed.gigB.id, seed.memberB.id))
        .send({ vote: 'no' }),
    ).expect(404)

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notifications
       WHERE type IN ('option-member-unavailable', 'option-all-responded')`,
    )
    expect(rows[0].n).toBe(0)
  })
})
