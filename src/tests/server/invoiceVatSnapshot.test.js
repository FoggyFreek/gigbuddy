import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

vi.mock('../../../server/platform/files/storageService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadObjectWithQuota: vi.fn(async () => undefined),
  removeObject: vi.fn(async () => undefined),
  safeRemove: vi.fn(() => undefined),
}))

let app, pool, runMigrations, truncateAll, seedTwoTenants, uploadObjectWithQuota
let seed

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  const appMod = await import('./_app.js')
  const storageMod = await import('../../../server/platform/files/storageService.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  uploadObjectWithQuota = storageMod.uploadObjectWithQuota
  app = appMod.createTestApp()
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
  await pool.query(
    `UPDATE tenants SET formal_name = 'The Woods BV', address_street = 'Straat 1',
       address_postal_code = '9751TG', address_city = 'Haren', address_country = 'Netherlands',
       tax_id = 'NL819789471B01', kvk_number = '12345678', iban = 'NL91ABNA0417164300'
     WHERE id = $1`,
    [seed.tenantA.id],
  )
  uploadObjectWithQuota.mockClear()
})

afterAll(async () => {
  await pool.end()
})

function asUserA(req) {
  return req
    .set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

const createInvoice = (body = {}) => asUserA(request(app).post('/api/invoices')).send({
  customer_name: 'Venue BV',
  customer_address_street: 'Plein 2',
  customer_address_postal_code: '1011AB',
  customer_address_city: 'Amsterdam',
  customer_address_country: 'NL',
  issue_date: '2025-06-10',
  due_date: '2025-06-24',
  lines: [{ description: 'Live performance', quantity: 1, unit_price_cents: 100000, tax_percentage: 21 }],
  ...body,
})

const patchInvoice = (id, body) => asUserA(request(app).patch(`/api/invoices/${id}`)).send(body)
const startScheme = (body) => asUserA(request(app).post('/api/accounting-profile/schemes')).send(body)

async function snapshotOf(invoiceId) {
  const { rows } = await pool.query(
    `SELECT accounting_country_snapshot, vat_scheme_code_snapshot, vat_treatment_snapshot,
            charges_output_vat_snapshot, vat_treatment_version, vat_snapshot_source, currency,
            tax_cents, finalized_at, status
       FROM invoices WHERE id = $1`,
    [invoiceId],
  )
  return rows[0]
}

const fetchUbl = (id) => asUserA(request(app).get(`/api/invoices/${id}/ubl`))

describe('invoice VAT snapshot — capture', () => {
  it('freezes the treatment when a draft is sent', async () => {
    const { body: inv } = await createInvoice().expect(201)
    expect(await snapshotOf(inv.id)).toMatchObject({ vat_treatment_snapshot: null })

    await patchInvoice(inv.id, { status: 'sent' }).expect(200)
    expect(await snapshotOf(inv.id)).toMatchObject({
      accounting_country_snapshot: 'nl',
      vat_scheme_code_snapshot: null,
      vat_treatment_snapshot: 'standard',
      charges_output_vat_snapshot: true,
      vat_treatment_version: 1,
      vat_snapshot_source: 'issued',
      currency: 'EUR',
    })
  })

  it('freezes it on a direct draft to paid too', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'paid' }).expect(200)
    expect((await snapshotOf(inv.id)).vat_snapshot_source).toBe('issued')
  })

  it('records the scheme and its exemption for an enrolled band', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)
    const { body: inv } = await createInvoice().expect(201)
    // The scheme suppresses output VAT, so the stored totals carry none.
    expect(inv.tax_cents).toBe(0)

    await patchInvoice(inv.id, { status: 'sent' }).expect(200)
    expect(await snapshotOf(inv.id)).toMatchObject({
      vat_scheme_code_snapshot: 'nl_kor',
      vat_treatment_snapshot: 'small_business_exempt',
      charges_output_vat_snapshot: false,
    })
  })

  // finalized_at is stamped on ANY move off draft, but an abandoned draft was
  // never issued and must not carry a snapshot claiming it was.
  it('does not snapshot a voided draft, even though it is finalized', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'void' }).expect(200)

    const row = await snapshotOf(inv.id)
    expect(row.finalized_at).not.toBeNull()
    expect(row.vat_treatment_snapshot).toBeNull()
    expect(row.vat_snapshot_source).toBeNull()
  })

  it('keeps the snapshot when an ISSUED invoice is later voided', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'sent' }).expect(200)
    await patchInvoice(inv.id, { status: 'void' }).expect(200)

    expect(await snapshotOf(inv.id)).toMatchObject({
      vat_treatment_snapshot: 'standard',
      vat_snapshot_source: 'issued',
    })
  })

  it('records reverse charge as the treatment, outranking the scheme', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)
    const { body: inv } = await createInvoice({
      reverse_charge: true,
      customer_address_country: 'BE',
      customer_tax_id: 'BE0779341748',
      // Issuing a reverse-charge invoice needs the VIES attestation; that gate is
      // unrelated to the snapshot but has to be satisfied to reach it.
      vies_checked: true,
      vies_consultation_number: 'WAPIAAAA123',
    }).expect(201)
    await patchInvoice(inv.id, { status: 'sent' }).expect(200)

    expect(await snapshotOf(inv.id)).toMatchObject({
      vat_treatment_snapshot: 'reverse_charge',
      charges_output_vat_snapshot: false,
    })
  })
})

describe('invoice VAT snapshot — immutability', () => {
  it('renders an issued invoice from its snapshot after the scheme changes', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'sent' }).expect(200)

    const before = await fetchUbl(inv.id).expect(200)
    expect(before.text).toContain('<cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount>')

    // The band joins the small-business scheme, backdated to before this invoice.
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)

    const after = await fetchUbl(inv.id).expect(200)
    // THE test of this whole step: byte-identical, because the invoice renders
    // from what it was issued under, not from what the band is on today.
    expect(after.text).toBe(before.text)
    expect(await snapshotOf(inv.id)).toMatchObject({
      vat_treatment_snapshot: 'standard',
      charges_output_vat_snapshot: true,
    })
  })

  it('re-rendering the PDF of an issued invoice does not re-derive its treatment', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'sent' }).expect(200)
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)

    // POST /:id/render has no finalization guard — before the snapshot it would
    // silently replace the stored PDF with one under today's scheme.
    const uploadCount = uploadObjectWithQuota.mock.calls.length
    await asUserA(request(app).post(`/api/invoices/${inv.id}/render`)).expect(200)
    expect(uploadObjectWithQuota).toHaveBeenCalledTimes(uploadCount + 1)
    expect(uploadObjectWithQuota).toHaveBeenLastCalledWith(
      expect.stringMatching(new RegExp(`^tenants/${seed.tenantA.id}/invoices/.+\\.pdf$`)),
      expect.any(Buffer),
      expect.any(Number),
      'application/pdf',
    )
    expect(await snapshotOf(inv.id)).toMatchObject({
      vat_treatment_snapshot: 'standard',
      vat_snapshot_source: 'issued',
    })
  })

  it('a new draft issued after the change DOES follow the new scheme', async () => {
    const { body: first } = await createInvoice().expect(201)
    await patchInvoice(first.id, { status: 'sent' }).expect(200)
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)

    const { body: second } = await createInvoice().expect(201)
    await patchInvoice(second.id, { status: 'sent' }).expect(200)

    expect((await snapshotOf(first.id)).vat_treatment_snapshot).toBe('standard')
    expect((await snapshotOf(second.id)).vat_treatment_snapshot).toBe('small_business_exempt')
  })

  it('cannot be rewritten by a second finalizing write', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'sent' }).expect(200)
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)

    // Directly re-running the capture path proves the guard is in SQL
    // (COALESCE), not in a read-then-check a race could slip through.
    const { updateInvoiceFields } = await import('../../../server/finance/invoices/invoiceRepository.js')
    await updateInvoiceFields(pool, seed.tenantA.id, inv.id, {
      columns: [],
      finalize: false,
      snapshot: {
        accounting_country_snapshot: 'de',
        vat_scheme_code_snapshot: 'nl_kor',
        vat_treatment_snapshot: 'small_business_exempt',
        charges_output_vat_snapshot: false,
        vat_treatment_version: 1,
        vat_snapshot_source: 'issued',
      },
    })

    expect(await snapshotOf(inv.id)).toMatchObject({
      accounting_country_snapshot: 'nl',
      vat_treatment_snapshot: 'standard',
      charges_output_vat_snapshot: true,
    })
  })

  it('still renders an issued invoice whose snapshot the old container never wrote', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'sent' }).expect(200)
    // Exactly the deploy-window shape: issued, no snapshot.
    await pool.query(
      `UPDATE invoices SET accounting_country_snapshot = NULL, vat_treatment_snapshot = NULL,
              charges_output_vat_snapshot = NULL, vat_snapshot_source = NULL
        WHERE id = $1`,
      [inv.id],
    )
    const res = await fetchUbl(inv.id).expect(200)
    expect(res.text).toContain('<cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount>')
  })
})

describe('invoice VAT snapshot — legacy correction', () => {
  async function makeInferred(invoiceId) {
    await pool.query(
      `UPDATE invoices SET vat_snapshot_source = 'legacy_inferred',
              vat_treatment_snapshot = 'small_business_exempt',
              charges_output_vat_snapshot = FALSE
        WHERE id = $1`,
      [invoiceId],
    )
  }

  const correct = (id, body) => asUserA(request(app).patch(`/api/invoices/${id}/vat-snapshot`)).send(body)

  it('corrects an inferred snapshot and closes it', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'sent' }).expect(200)
    await makeInferred(inv.id)

    await correct(inv.id, { vat_treatment_snapshot: 'standard' }).expect(200)
    expect(await snapshotOf(inv.id)).toMatchObject({
      vat_treatment_snapshot: 'standard',
      charges_output_vat_snapshot: true,
      vat_snapshot_source: 'confirmed',
    })

    // Now closed: a wrong INFERENCE may be fixed once, a confirmed treatment never.
    const again = await correct(inv.id, { vat_treatment_snapshot: 'small_business_exempt' }).expect(409)
    expect(again.body.code).toBe('vat_snapshot_immutable')
  })

  it('refuses to touch a snapshot written at issue', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'sent' }).expect(200)

    const res = await correct(inv.id, { vat_treatment_snapshot: 'small_business_exempt' }).expect(409)
    expect(res.body.code).toBe('vat_snapshot_immutable')
  })

  it('rejects a treatment the software could never have produced', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'sent' }).expect(200)
    await makeInferred(inv.id)

    const res = await correct(inv.id, { vat_treatment_snapshot: 'outside_scope' }).expect(400)
    expect(res.body.error).toBe('invalid_vat_treatment')
  })

  it('404s a cross-tenant correction, and the owner can still do it', async () => {
    const { body: inv } = await createInvoice().expect(201)
    await patchInvoice(inv.id, { status: 'sent' }).expect(200)
    await makeInferred(inv.id)

    await request(app)
      .patch(`/api/invoices/${inv.id}/vat-snapshot`)
      .set('x-test-user-id', String(seed.userB.id))
      .set('x-test-tenant-id', String(seed.tenantB.id))
      .send({ vat_treatment_snapshot: 'standard' })
      .expect(404)

    await correct(inv.id, { vat_treatment_snapshot: 'standard' }).expect(200)
  })
})

describe('purchase VAT snapshot', () => {
  const createPurchase = (body = {}) => asUserA(request(app).post('/api/purchases')).send({
    supplier_name: 'Backline Rental',
    receipt_date: '2025-06-10',
    lines: [{ description: 'PA hire', expense_category: 'other', tax_rate: 21, amount_incl_cents: 12100 }],
    ...body,
  })

  async function purchaseSnapshot(id) {
    const { rows } = await pool.query(
      `SELECT accounting_country_snapshot, vat_scheme_code_snapshot, vat_treatment_snapshot,
              input_vat_recoverable_snapshot, vat_snapshot_source, tax_cents, total_cents
         FROM purchases WHERE id = $1`,
      [id],
    )
    return rows[0]
  }

  it('snapshots at approval, not while a draft', async () => {
    const { body: draft } = await createPurchase().expect(201)
    expect((await purchaseSnapshot(draft.id)).vat_snapshot_source).toBeNull()

    await asUserA(request(app).patch(`/api/purchases/${draft.id}`)).send({ status: 'approved' }).expect(200)
    expect(await purchaseSnapshot(draft.id)).toMatchObject({
      accounting_country_snapshot: 'nl',
      vat_treatment_snapshot: 'standard',
      input_vat_recoverable_snapshot: true,
      vat_snapshot_source: 'issued',
    })
  })

  it('snapshots a create-as-approved purchase too', async () => {
    const { body: p } = await createPurchase({ status: 'approved' }).expect(201)
    expect((await purchaseSnapshot(p.id)).vat_snapshot_source).toBe('issued')
  })

  // The point the sales side must never bleed into: under a small-business
  // scheme the SUPPLIER still charges VAT. What changes is that the band cannot
  // deduct it — the amounts are untouched.
  it('records non-recoverable input VAT without erasing the supplier VAT', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2020-01-01' }).expect(201)
    const { body: p } = await createPurchase({ status: 'approved' }).expect(201)

    const row = await purchaseSnapshot(p.id)
    expect(row).toMatchObject({
      vat_scheme_code_snapshot: 'nl_kor',
      vat_treatment_snapshot: 'small_business_exempt',
      input_vat_recoverable_snapshot: false,
    })
    expect(row.tax_cents).toBe(2100)
    expect(row.total_cents).toBe(12100)
  })

  it('uses an edited receipt date when approval crosses into the KOR period', async () => {
    await startScheme({ scheme_code: 'nl_kor', valid_from: '2025-06-01' }).expect(201)
    const { body: draft } = await createPurchase({ receipt_date: '2025-05-31' }).expect(201)

    await asUserA(request(app).patch(`/api/purchases/${draft.id}`))
      .send({ receipt_date: '2025-06-01', status: 'approved' })
      .expect(200)

    expect(await purchaseSnapshot(draft.id)).toMatchObject({
      vat_scheme_code_snapshot: 'nl_kor',
      vat_treatment_snapshot: 'small_business_exempt',
      input_vat_recoverable_snapshot: false,
    })
  })
})
