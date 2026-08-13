import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))

const DATE = '2026-08-13'
const NEXT_DATE = '2026-08-14'

const eventCases = [
  {
    label: 'gig',
    path: '/api/gigs',
    body: { event_date: DATE, event_description: 'Late show' },
    startDateField: 'event_date',
  },
  {
    label: 'rehearsal',
    path: '/api/rehearsals',
    body: { proposed_date: DATE, location: 'Late rehearsal' },
    startDateField: 'proposed_date',
  },
  {
    label: 'band event',
    path: '/api/band-events',
    body: { start_date: DATE, end_date: DATE, title: 'Late event' },
    startDateField: 'start_date',
  },
]

describe('planning event end dates', () => {
  for (const eventCase of eventCases) {
    it(`lands an overnight ${eventCase.label} end time on the next date`, async () => {
      const response = await asUserA(request(app).post(eventCase.path).send({
        ...eventCase.body,
        start_time: '22:00',
        end_time: '02:00',
      })).expect(201)

      expect(response.body).toMatchObject({
        [eventCase.startDateField]: DATE,
        end_date: NEXT_DATE,
        start_time: '22:00:00',
        end_time: '02:00:00',
      })
    })

    it(`allows ${eventCase.label} durations up to 23:59 and rejects 24 hours`, async () => {
      const maximum = await asUserA(request(app).post(eventCase.path).send({
        ...eventCase.body,
        start_time: '22:00',
        end_time: '21:59',
      })).expect(201)
      expect(maximum.body.end_date).toBe(NEXT_DATE)

      const fullDay = await asUserA(request(app).post(eventCase.path).send({
        ...eventCase.body,
        start_time: '22:00',
        end_time: '22:00',
      })).expect(400)
      expect(fullDay.body.error).toBe('end_time must be after start_time')
    })
  }

  it('recalculates a gig end date on a partial time update', async () => {
    const created = await asUserA(request(app).post('/api/gigs').send({
      event_date: DATE,
      event_description: 'Late show',
      start_time: '22:00',
    })).expect(201)

    const overnight = await asUserA(request(app).patch(`/api/gigs/${created.body.id}`).send({
      end_time: '02:00',
    })).expect(200)
    expect(overnight.body.end_date).toBe(NEXT_DATE)

    const sameDay = await asUserA(request(app).patch(`/api/gigs/${created.body.id}`).send({
      end_time: '23:00',
    })).expect(200)
    expect(sameDay.body.end_date).toBe(DATE)
  })

  it('does not allow an overnight update to cross tenant boundaries', async () => {
    await asUserA(request(app).patch(`/api/gigs/${seed.gigB.id}`).send({
      start_time: '22:00',
      end_time: '02:00',
    })).expect(404)
  })
})
