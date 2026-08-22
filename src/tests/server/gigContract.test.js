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
  ;({ pool, runMigrations, truncateAll, seedTwoTenants } = dbMod)
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

function fetchContract(gigId, query = '') {
  return asUserA(request(app).get(`/api/gigs/${gigId}/contract.pdf${query}`))
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

async function configureContractGig() {
  const venue = seed.venues.find((row) => row.tenant_id === seed.tenantA.id)
  await pool.query(
    `UPDATE venues
        SET organization_name = 'Alpha Hall Foundation', street_and_number = 'Stage Road 12',
            postal_code = '1012 AB', city = 'Amsterdam', country = 'NL'
      WHERE id = $1 AND tenant_id = $2`,
    [venue.id, seed.tenantA.id],
  )
  await pool.query(
    `UPDATE gigs SET venue_id = $1, deal_type = 'guarantee', guarantee_variant = 'versus',
       guaranteed_fee_cents = 100000, percentage_of_sales = 70,
       venue_costs_cents = 50000, ticket_price_net_cents = 2000,
       ticket_price_gross_cents = 2200, subject_to_vat = TRUE, vat_percentage = 9
     WHERE id = $2 AND tenant_id = $3`,
    [venue.id, seed.gigA.id, seed.tenantA.id],
  )
  await pool.query(
    `INSERT INTO gig_costs (gig_id, tenant_id, label, amount_cents, paid_by)
     VALUES ($1, $2, 'Travel', 10000, 'artist')`,
    [seed.gigA.id, seed.tenantA.id],
  )
}

describe('GET /api/gigs/:id/contract.pdf', () => {
  it('returns a finance-gated PDF named after the gig without persisted contract state', async () => {
    await configureContractGig()
    const res = await fetchContract(seed.gigA.id).expect(200)

    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition'])
      .toBe('attachment; filename="contract-alpha-gig-06012026.pdf"')
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-')
    const { rows: [{ table_name: tableName }] } = await pool.query(
      "SELECT to_regclass('public.gig_contracts') AS table_name",
    )
    expect(tableName).toBeNull()
  })

  it('renders the unchanged agreement and current gig terms without reference or version metadata', async () => {
    await configureContractGig()
    const first = await pdfText((await fetchContract(seed.gigA.id).expect(200)).body)

    expect(first).toContain('Performance agreement')
    expect(first).toContain('Alpha Band')
    expect(first).toContain('Alpha Hall Foundation')
    expect(first).toContain('agree to the performance and deal terms listed below')
    expect(first).toContain('Guarantee versus')
    expect(first).toContain('Travel')
    expect(first).toContain('For the band')
    expect(first).toContain('For the venue')
    expect(first).not.toContain('Reference')
    expect(first).not.toContain('Version')

    await pool.query(
      'UPDATE gigs SET guaranteed_fee_cents = 125000 WHERE id = $1 AND tenant_id = $2',
      [seed.gigA.id, seed.tenantA.id],
    )
    const regenerated = await pdfText((await fetchContract(seed.gigA.id).expect(200)).body)
    expect(regenerated).toContain('€1,250.00')
  })

  it('localizes the live contract to Dutch', async () => {
    await configureContractGig()
    const text = await pdfText((await fetchContract(seed.gigA.id, '?lng=nl').expect(200)).body)

    expect(text).toContain('Optredenovereenkomst')
    expect(text).toContain('komen het optreden en de hieronder vermelde afspraken overeen')
    expect(text).toContain('Voor de band')
    expect(text).toContain('Voor de locatie')
    expect(text).not.toContain('Referentie')
    expect(text).not.toContain('Versie')
  })

  it('requires a venue before generating the contract', async () => {
    await fetchContract(seed.gigA.id).expect(400)
  })

  it('requires finance.view', async () => {
    await configureContractGig()
    await pool.query(
      `UPDATE memberships SET role = 'reader'
       WHERE user_id = $1 AND tenant_id = $2`,
      [seed.userA.id, seed.tenantA.id],
    )

    await fetchContract(seed.gigA.id).expect(403)
  })

  it('does not leak a gig from another tenant', async () => {
    await fetchContract(seed.gigB.id).expect(404)
  })

  it('rejects a non-numeric gig id', async () => {
    await fetchContract('abc').expect(400)
  })
})
