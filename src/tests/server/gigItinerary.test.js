import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'
import request from 'supertest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

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
  const fixtureDb = await import('./_db.js')
  seed = await fixtureDb.seedBandMembers(seed)
  seed = await fixtureDb.seedGigsAndTasks(seed)
  seed = await fixtureDb.seedContactsAndVenues(seed)
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

function fetchItinerary(gigId, query = '') {
  return asUserA(request(app).get(`/api/gigs/${gigId}/itinerary.pdf${query}`))
    .buffer()
    .parse((res, cb) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
}

async function pdfText(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise
  let text = ''
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent()
    text += `${content.items.map((item) => item.str).join(' ')} `
  }
  return text
}

describe('GET /api/gigs/:id/itinerary.pdf', () => {
  it('returns a downloadable PDF named after the gig', async () => {
    const res = await fetchItinerary(seed.gigA.id).expect(200)

    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition'])
      .toBe('attachment; filename="itinerary-alpha-gig-06012026.pdf"')
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-')
  })

  // event_description is NOT NULL, so an unnamed gig is a blank one.
  it('names an unnamed gig by its date alone', async () => {
    await pool.query(
      `UPDATE gigs SET event_description = '' WHERE id = $1 AND tenant_id = $2`,
      [seed.gigA.id, seed.tenantA.id],
    )

    const res = await fetchItinerary(seed.gigA.id).expect(200)

    expect(res.headers['content-disposition'])
      .toBe('attachment; filename="itinerary-06012026.pdf"')
  })

  it('renders the gig, its tasks and every section of the itinerary', async () => {
    const text = await pdfText((await fetchItinerary(seed.gigA.id).expect(200)).body)

    expect(text).toContain('Alpha Gig')
    expect(text).toContain('1 June 2026')
    expect(text).toContain('Event Information')
    expect(text).toContain('Contact Persons')
    expect(text).toContain('Tasks')
    expect(text).toContain('Alpha task')
  })

  it('includes linked contacts, the timetable and information blocks', async () => {
    const contactA = seed.contacts.find((c) => c.tenant_id === seed.tenantA.id)
    await pool.query(
      `UPDATE contacts SET email = 'alpha@test.local', phone = '+31 6 1111 2222'
        WHERE id = $1 AND tenant_id = $2`,
      [contactA.id, seed.tenantA.id],
    )
    await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/contacts`).send({ contact_id: contactA.id }),
    ).expect(201)
    await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/timetable`)
        .send({ start_time: '17:00', end_time: '18:00', description: 'Get-in' }),
    ).expect(201)
    await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/info-blocks`)
        .send({ label: 'catering', content: 'Vegetarian meals for five.' }),
    ).expect(201)

    const text = await pdfText((await fetchItinerary(seed.gigA.id).expect(200)).body)

    expect(text).toContain('Alpha Contact')
    expect(text).toContain('alpha@test.local')
    expect(text).toContain('+31 6 1111 2222')
    expect(text).toContain('Timetable')
    expect(text).toContain('17:00 – 18:00')
    expect(text).toContain('Get-in')
    expect(text).toContain('Additional Information')
    expect(text).toContain('Catering')
    expect(text).toContain('Vegetarian meals for five.')
  })

  it('resolves the assignee name of an assigned task', async () => {
    await pool.query(
      'UPDATE gig_tasks SET assigned_to = $1, due_date = $2 WHERE gig_id = $3 AND tenant_id = $4',
      [seed.memberA.id, '2026-05-20', seed.gigA.id, seed.tenantA.id],
    )
    const { rows: [member] } = await pool.query(
      'SELECT name FROM band_members WHERE id = $1', [seed.memberA.id],
    )

    const text = await pdfText((await fetchItinerary(seed.gigA.id).expect(200)).body)

    expect(text).toContain(member.name)
    expect(text).toContain('due 20 May 2026')
  })

  it('marks a task with no assignee as unassigned', async () => {
    const text = await pdfText((await fetchItinerary(seed.gigA.id).expect(200)).body)
    expect(text).toContain('Unassigned')
  })

  it('localizes the document when ?lng=nl is requested', async () => {
    const text = await pdfText((await fetchItinerary(seed.gigA.id, '?lng=nl').expect(200)).body)

    expect(text).toContain('Evenementgegevens')
    expect(text).toContain('Contactpersonen')
    expect(text).toContain('1 juni 2026')
  })

  it('falls back to English for an unsupported language', async () => {
    const text = await pdfText((await fetchItinerary(seed.gigA.id, '?lng=zz').expect(200)).body)
    expect(text).toContain('Event Information')
  })

  it('inherits the venue and festival contacts the Contacts tab shows', async () => {
    const venue = seed.venues.find((v) => v.tenant_id === seed.tenantA.id)
    const { rows: [festival] } = await pool.query(
      `INSERT INTO venues (tenant_id, category, name) VALUES ($1, 'festival', 'Alpha Fest')
       RETURNING id`,
      [seed.tenantA.id],
    )
    const { rows: [venueContact] } = await pool.query(
      `INSERT INTO contacts (tenant_id, name, category, email)
       VALUES ($1, 'Venue Vera', 'booker', 'vera@venue.local') RETURNING id`,
      [seed.tenantA.id],
    )
    const { rows: [festivalContact] } = await pool.query(
      `INSERT INTO contacts (tenant_id, name, category, email)
       VALUES ($1, 'Festival Fred', 'promotion', 'fred@fest.local') RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      'INSERT INTO venue_contacts (venue_id, contact_id, tenant_id) VALUES ($1, $2, $3), ($4, $5, $3)',
      [venue.id, venueContact.id, seed.tenantA.id, festival.id, festivalContact.id],
    )
    await pool.query(
      'UPDATE gigs SET venue_id = $1, festival_id = $2 WHERE id = $3 AND tenant_id = $4',
      [venue.id, festival.id, seed.gigA.id, seed.tenantA.id],
    )

    const text = await pdfText((await fetchItinerary(seed.gigA.id).expect(200)).body)

    expect(text).toContain('[Venue]')
    expect(text).toContain('Venue Vera')
    expect(text).toContain('vera@venue.local')
    expect(text).toContain('[Festival]')
    expect(text).toContain('Festival Fred')
    expect(text).toContain('fred@fest.local')
  })

  it('lists a contact linked to both the gig and its venue only once', async () => {
    const venue = seed.venues.find((v) => v.tenant_id === seed.tenantA.id)
    const contactA = seed.contacts.find((c) => c.tenant_id === seed.tenantA.id)
    await pool.query(
      'INSERT INTO venue_contacts (venue_id, contact_id, tenant_id) VALUES ($1, $2, $3)',
      [venue.id, contactA.id, seed.tenantA.id],
    )
    await pool.query(
      'UPDATE gigs SET venue_id = $1 WHERE id = $2 AND tenant_id = $3',
      [venue.id, seed.gigA.id, seed.tenantA.id],
    )
    await asUserA(
      request(app).post(`/api/gigs/${seed.gigA.id}/contacts`).send({ contact_id: contactA.id }),
    ).expect(201)

    const text = await pdfText((await fetchItinerary(seed.gigA.id).expect(200)).body)

    expect(text.match(/Alpha Contact/g)).toHaveLength(1)
    // The surviving row is the gig's own link, so it carries no source tag.
    expect(text).not.toContain('[Venue]')
  })

  it('signs the header with the band name when the tenant has no logo', async () => {
    const text = await pdfText((await fetchItinerary(seed.gigA.id).expect(200)).body)
    expect(text).toContain('Alpha Band')
  })

  it('404s a gig belonging to another tenant, leaking no existence', async () => {
    await fetchItinerary(seed.gigB.id).expect(404)
  })

  it('404s a gig that does not exist', async () => {
    await fetchItinerary(99999999).expect(404)
  })

  it('400s a non-numeric gig id', async () => {
    await fetchItinerary('abc').expect(400)
  })

  it('never renders another tenant\'s contacts, tasks or blocks into the document', async () => {
    const contactB = seed.contacts.find((c) => c.tenant_id === seed.tenantB.id)
    await asUserB(
      request(app).post(`/api/gigs/${seed.gigB.id}/contacts`).send({ contact_id: contactB.id }),
    ).expect(201)
    await asUserB(
      request(app).post(`/api/gigs/${seed.gigB.id}/info-blocks`)
        .send({ label: 'catering', content: 'Beta only catering note.' }),
    ).expect(201)

    const text = await pdfText((await fetchItinerary(seed.gigA.id).expect(200)).body)

    expect(text).not.toContain('Beta Contact')
    expect(text).not.toContain('Beta only catering note.')
    expect(text).not.toContain('Beta task')
  })
})
