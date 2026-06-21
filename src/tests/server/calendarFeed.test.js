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

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

// The path an external client polls, derived from the absolute subscribe URL.
function feedPath(url) {
  return new URL(url).pathname
}

async function createFeed() {
  const res = await asUserA(request(app).post('/api/calendar-feed/regenerate')).expect(200)
  return res.body
}

describe('calendar feed — management', () => {
  it('GET returns null before a feed exists', async () => {
    const res = await asUserA(request(app).get('/api/calendar-feed')).expect(200)
    expect(res.body).toBeNull()
  })

  it('regenerate creates a feed, GET then describes it', async () => {
    const created = await createFeed()
    expect(created.url).toMatch(/\/api\/public\/calendar\/.+\/feed\.ics$/)

    const res = await asUserA(request(app).get('/api/calendar-feed')).expect(200)
    expect(res.body.url).toBe(created.url)
  })
})

describe('calendar feed — public .ics', () => {
  it('serves the active tenant calendar as text/calendar with a no-store cache header', async () => {
    // Give the gig a start time so the feed carries a timed event (and thus a TZID).
    await pool.query('UPDATE gigs SET start_time = $1 WHERE id = $2 AND tenant_id = $3', [
      '20:00',
      seed.gigA.id,
      seed.tenantA.id,
    ])
    const feed = await createFeed()
    const res = await request(app).get(feedPath(feed.url)).expect(200)

    expect(res.headers['content-type']).toMatch(/text\/calendar/)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.text).toContain('BEGIN:VCALENDAR')
    expect(res.text).toContain(`UID:gigbuddy-gig-${seed.gigA.id}@gigbuddy`)
    expect(res.text).toContain(`UID:gigbuddy-rehearsal-${seed.rehearsalA.id}@gigbuddy`)
    // The calendar name is set from the band name.
    expect(res.text).toContain('X-WR-CALNAME:Alpha Band')
    // Timed events reference TZID=Europe/Amsterdam, so a matching VTIMEZONE must
    // be defined exactly once and precede the first VEVENT (strict clients like
    // Google Calendar reject a TZID with no definition).
    expect(res.text.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1)
    expect(res.text).toContain('TZID:Europe/Amsterdam')
    expect(res.text.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(res.text.indexOf('BEGIN:VEVENT'))
    // No content line may exceed 75 octets per RFC 5545 §3.1.
    const enc = new TextEncoder()
    expect(res.text.split('\r\n').filter((l) => enc.encode(l).length > 75)).toEqual([])
  })

  it('contains only the active tenant events (isolation)', async () => {
    const feed = await createFeed()
    const res = await request(app).get(feedPath(feed.url)).expect(200)

    expect(res.text).toContain(`gigbuddy-gig-${seed.gigA.id}@gigbuddy`)
    expect(res.text).not.toContain(`gigbuddy-gig-${seed.gigB.id}@gigbuddy`)
    expect(res.text).not.toContain(`gigbuddy-rehearsal-${seed.rehearsalB.id}@gigbuddy`)
  })

  it('reproduces the in-app exporter rehearsal description (vote count + deep link)', async () => {
    await pool.query(
      `INSERT INTO rehearsal_participants (tenant_id, rehearsal_id, band_member_id, vote, updated_by_user_id)
       VALUES ($1, $2, $3, 'yes', $4)`,
      [seed.tenantA.id, seed.rehearsalA.id, seed.memberA.id, seed.userA.id],
    )
    const feed = await createFeed()
    const res = await request(app).get(feedPath(feed.url)).expect(200)

    expect(res.text).toContain('1/1 yes')
    expect(res.text).toContain(`Open in GigBuddy: `)
    expect(res.text).toContain(`/rehearsals?open=${seed.rehearsalA.id}`)
  })

  it('returns 404 for an unknown token', async () => {
    await request(app).get('/api/public/calendar/not-a-real-token/feed.ics').expect(404)
  })

  it('rotation invalidates the old URL', async () => {
    const first = await createFeed()
    const second = await createFeed()
    expect(second.url).not.toBe(first.url)

    await request(app).get(feedPath(first.url)).expect(404)
    await request(app).get(feedPath(second.url)).expect(200)
  })

  it('revocation invalidates the URL', async () => {
    const feed = await createFeed()
    await asUserA(request(app).delete('/api/calendar-feed')).expect(204)
    await request(app).get(feedPath(feed.url)).expect(404)
  })

  it('returns 404 when the membership is no longer approved', async () => {
    const feed = await createFeed()
    await pool.query(
      `UPDATE memberships SET status = 'rejected' WHERE user_id = $1 AND tenant_id = $2`,
      [seed.userA.id, seed.tenantA.id],
    )
    await request(app).get(feedPath(feed.url)).expect(404)
  })

  it('returns 404 when the tenant is archived', async () => {
    const feed = await createFeed()
    await pool.query('UPDATE tenants SET archived_at = NOW() WHERE id = $1', [seed.tenantA.id])
    await request(app).get(feedPath(feed.url)).expect(404)
  })
})
