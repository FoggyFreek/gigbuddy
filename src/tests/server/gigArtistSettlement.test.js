import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
  seed = await fixtureDb.seedGigsAndTasks(seed)
  seed = await fixtureDb.seedContactsAndVenues(seed)
  seed = await fixtureDb.seedAccountingForTenants(seed)
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

function fetchSettlement(gigId, query = '') {
  return asUserA(request(app).get(`/api/gigs/${gigId}/artist-settlement.pdf${query}`))
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

async function configureFinalSales() {
  const venue = seed.venues.find((row) => row.tenant_id === seed.tenantA.id)
  await pool.query(
    `UPDATE venues
        SET street_and_number = 'Stage Road 12', postal_code = '1012 AB', city = 'Amsterdam', country = 'NL'
      WHERE id = $1 AND tenant_id = $2`,
    [venue.id, seed.tenantA.id],
  )
  await pool.query(
    `UPDATE gigs SET
       venue_id = $1,
       deal_type = 'guarantee', guarantee_variant = 'plus',
       guaranteed_fee_cents = 100000, percentage_of_sales = 70,
       tickets_sold = 125, ticket_price_net_cents = 2000,
       subject_to_vat = TRUE, ticket_vat_percentage = 9, copyright_percentage = 10,
       venue_costs_cents = 50000,
       agency_fee_basis = 'amount', agency_fee_amount_cents = 15000
     WHERE id = $2 AND tenant_id = $3`,
    [venue.id, seed.gigA.id, seed.tenantA.id],
  )
  await pool.query(
    `INSERT INTO gig_costs (gig_id, tenant_id, label, amount_cents, paid_by)
     VALUES ($1, $2, 'Travel', 10000, 'artist')`,
    [seed.gigA.id, seed.tenantA.id],
  )
}

describe('GET /api/gigs/:id/artist-settlement.pdf', () => {
  it('returns a finance-gated PDF named after the gig', async () => {
    const res = await fetchSettlement(seed.gigA.id).expect(200)

    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition'])
      .toBe('attachment; filename="artist-settlement-alpha-gig-06012026.pdf"')
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('renders band, venue, terms, finalized revenue, VAT, expenses and settlement totals', async () => {
    await configureFinalSales()
    const text = await pdfText((await fetchSettlement(seed.gigA.id).expect(200)).body)

    expect(text).toContain('Alpha Band')
    expect(text).toContain('Alpha Hall')
    expect(text).toContain('Stage Road 12')
    expect(text).toContain('Settlement date')
    expect(text).toContain('Guarantee plus ticket share')
    expect(text).toContain('Revenue')
    expect(text).toContain('Visitors')
    expect(text).toContain('Ticket price')
    expect(text).toContain('125')
    expect(text).toContain('VAT (9%)')
    expect(text).toContain('Copyright / PRS (10%)')
    expect(text.indexOf('Copyright / PRS (10%)')).toBeGreaterThan(text.indexOf('VAT (9%)'))
    expect(text).toContain('Net gross after VAT and Copyright / PRS')
    expect(text).toContain('Production costs')
    expect(text).toContain('Other costs')
    expect(text).toContain('Due to artist')
  })

  it('localizes the settlement to Dutch', async () => {
    await configureFinalSales()
    const text = await pdfText((await fetchSettlement(seed.gigA.id, '?lng=nl').expect(200)).body)

    expect(text).toContain('Artiestenafrekening')
    expect(text).toContain('Datum afrekening')
    expect(text).toContain('Opbrengsten')
    expect(text).toContain('Productiekosten')
    expect(text).toContain('Te betalen aan artiest')
  })

  it('requires finance.view', async () => {
    await pool.query(
      `UPDATE memberships SET role = 'reader'
       WHERE user_id = $1 AND tenant_id = $2`,
      [seed.userA.id, seed.tenantA.id],
    )

    await fetchSettlement(seed.gigA.id).expect(403)
  })

  it('does not leak a gig from another tenant', async () => {
    await fetchSettlement(seed.gigB.id).expect(404)
  })

  it('rejects a non-numeric gig id', async () => {
    await fetchSettlement('abc').expect(400)
  })
})
