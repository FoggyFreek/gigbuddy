import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The embedded PDF is stored through the normal attachment path, so the object
// store has to retain what it is handed.
const objectStore = new Map()
vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    putObject: vi.fn(async (bucket, key, buffer, size, meta) => {
      objectStore.set(key, { buffer, contentType: meta?.['Content-Type'] })
      return { etag: 'test' }
    }),
    statObject: vi.fn(async (bucket, key) => {
      const obj = objectStore.get(key)
      if (!obj) throw Object.assign(new Error('Not Found'), { code: 'NoSuchKey' })
      return { size: obj.buffer.length, metaData: { 'content-type': obj.contentType } }
    }),
    getObject: vi.fn(async () => { throw new Error('no such key') }),
    removeObject: vi.fn(async (bucket, key) => { objectStore.delete(key) }),
  },
}))

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ublImport')
const SI_UBL = join(FIX, 'si-ubl-discount.xml')
const siUblText = readFileSync(SI_UBL, 'utf8')
const CII = join(FIX, 'cii-xrechnung.xml')
const ciiText = readFileSync(CII, 'utf8')

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
  objectStore.clear()
  seed = await seedTwoTenants()
})

afterAll(async () => { await pool.end() })

const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))
const asUserB = (req) => req
  .set('x-test-user-id', String(seed.userB.id))
  .set('x-test-tenant-id', String(seed.tenantB.id))

const importFile = (auth, path) =>
  auth(request(app).post('/api/purchases/import')).attach('file', path)
const importBuf = (auth, text, name = 'invoice.xml') =>
  auth(request(app).post('/api/purchases/import')).attach('file', Buffer.from(text), name)

const codes = (warnings) => warnings.map((w) => w.code)

async function insertSupplier(tenantId, { name, iban = null }) {
  const { rows } = await pool.query(
    `INSERT INTO contacts (tenant_id, name, category, iban)
     VALUES ($1, $2, 'supplier', $3) RETURNING *`,
    [tenantId, name, iban],
  )
  return rows[0]
}

describe('POST /purchases/import', () => {
  it('creates a draft purchase reconciling to the invoice totals', async () => {
    const res = await importFile(asUserA, SI_UBL)
    expect(res.status).toBe(201)

    const { purchase } = res.body
    expect(purchase.status).toBe('draft')
    expect(purchase.supplier_name).toBe('Recording Studio De Kerk')
    expect(purchase.receipt_date.slice(0, 10)).toBe('2026-07-29')
    expect(purchase.due_date.slice(0, 10)).toBe('2026-08-12')
    // The supplier's number now has its own column; memo is theirs to use.
    expect(purchase.supplier_invoice_number).toBe('20260038')
    expect(purchase.memo).toBeNull()
    expect(purchase.subtotal_cents).toBe(99000)
    expect(purchase.tax_cents).toBe(20790)
    expect(purchase.total_cents).toBe(119790)
    expect(purchase.lines.map((l) => l.amount_incl_cents)).toEqual([65340, 54450])
  })

  it('stores the embedded PDF as an attachment on the draft', async () => {
    const res = await importFile(asUserA, SI_UBL)
    expect(res.body.purchase.attachments).toHaveLength(1)
    expect(res.body.purchase.attachments[0].content_type).toBe('application/pdf')
    expect(codes(res.body.warnings)).not.toContain('attachment_skipped')
  })

  it('imports as a draft even for a finance manager — approving stays a human step', async () => {
    const res = await importFile(asUserA, SI_UBL)
    const { rows } = await pool.query(
      'SELECT status, finalized_at FROM purchases WHERE id = $1', [res.body.purchase.id],
    )
    expect(rows[0]).toMatchObject({ status: 'draft', finalized_at: null })
    // Nothing reached the ledger.
    const { rows: entries } = await pool.query(
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE tenant_id = $1 AND source_type = 'purchase'`, [seed.tenantA.id],
    )
    expect(entries[0].n).toBe(0)
  })

  it('links the supplier contact matched on the payee IBAN', async () => {
    const supplier = await insertSupplier(seed.tenantA.id, {
      name: 'Studio de Kerk (old name)', iban: 'NL55RABO0127957391',
    })
    const res = await importFile(asUserA, SI_UBL)

    expect(res.body.purchase.supplier_contact_id).toBe(supplier.id)
    expect(codes(res.body.warnings)).not.toContain('supplier_not_matched')
  })

  it('falls back to an exact name match when there is no IBAN', async () => {
    const supplier = await insertSupplier(seed.tenantA.id, { name: 'recording studio de kerk' })
    const res = await importFile(asUserA, SI_UBL)
    expect(res.body.purchase.supplier_contact_id).toBe(supplier.id)
  })

  it('keeps the supplier as free text and warns when nothing matches', async () => {
    const res = await importFile(asUserA, SI_UBL)
    expect(res.body.purchase.supplier_contact_id).toBeNull()
    expect(codes(res.body.warnings)).toContain('supplier_not_matched')
  })

  it("stores the supplier's own invoice number in its own column", async () => {
    const res = await importFile(asUserA, SI_UBL)
    expect(res.body.purchase.supplier_invoice_number).toBe('20260038')
    // receipt_number stays OUR sequential id for the same bill.
    expect(res.body.purchase.receipt_number).not.toBe('20260038')
  })

  it('refuses a second import of the same bill, naming the purchase it clashes with', async () => {
    const first = await importFile(asUserA, SI_UBL)
    const second = await importFile(asUserA, SI_UBL)

    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({ code: 'supplier_invoice_number_taken' })
    expect(second.body.receipt_numbers).toContain(first.body.purchase.receipt_number)

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM purchases WHERE tenant_id = $1', [seed.tenantA.id],
    )
    expect(rows[0].n).toBe(1)
  })

  it('still refuses when the lookup is bypassed, because the index is the real guard', async () => {
    await importFile(asUserA, SI_UBL)
    // Simulates the race the pre-insert lookup cannot see: a concurrent import
    // that passed its own check before the first one committed.
    await expect(pool.query(
      `INSERT INTO purchases (tenant_id, receipt_number, supplier_name, supplier_invoice_number, receipt_date)
       VALUES ($1, 9999, 'Recording Studio De Kerk', '20260038', '2026-07-29')`,
      [seed.tenantA.id],
    )).rejects.toMatchObject({ code: '23505', constraint: 'purchases_tenant_supplier_invoice_number_key' })
  })

  it('warns rather than refuses when only the supplier, date and total match', async () => {
    // A bill entered by hand carries no supplier invoice number to compare, so
    // the resemblance is a heuristic and two genuine purchases can look alike.
    const created = await asUserA(request(app).post('/api/purchases')).send({
      supplier_name: 'Recording Studio De Kerk',
      receipt_date: '2026-07-29',
      lines: [{ description: 'Studio', tax_rate: 21, amount_incl_cents: 119790, position: 0 }],
    })
    expect(created.status).toBe(201)

    const res = await importFile(asUserA, SI_UBL)
    expect(res.status).toBe(201)
    const duplicate = res.body.warnings.find((w) => w.code === 'possible_duplicate')
    expect(duplicate).toMatchObject({ severity: 'blocking' })
    expect(duplicate.receiptNumbers).toContain(created.body.receipt_number)
  })

  it('lets a different supplier reuse the same invoice number', async () => {
    await importFile(asUserA, SI_UBL)
    const other = await importBuf(asUserA, siUblText.replace(
      /<cbc:RegistrationName>Recording Studio De Kerk<\/cbc:RegistrationName>/,
      '<cbc:RegistrationName>Another Studio</cbc:RegistrationName>',
    ))
    expect(other.status).toBe(201)
  })

  it('reports the discount allocation so the user knows the lines were changed', async () => {
    const res = await importFile(asUserA, SI_UBL)
    expect(codes(res.body.warnings)).toContain('document_discount_allocated')
  })
})

describe('POST /purchases/import — buyer identity', () => {
  // The invoice's buyer VAT number, added to the fixture's customer party.
  const withBuyerVat = (vat) => siUblText.replace(
    '<cac:PartyLegalEntity>\n        <cbc:RegistrationName>The woods</cbc:RegistrationName>',
    `<cac:PartyTaxScheme><cbc:CompanyID>${vat}</cbc:CompanyID>`
    + '<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>'
    + '<cac:PartyLegalEntity>\n        <cbc:RegistrationName>The woods</cbc:RegistrationName>',
  )

  it('warns when the invoice is addressed to another VAT number', async () => {
    await pool.query('UPDATE tenants SET tax_id = $2 WHERE id = $1', [seed.tenantA.id, 'NL123456789B01'])
    const res = await importBuf(asUserA, withBuyerVat('NL999999999B99'))

    expect(res.status).toBe(201)
    expect(res.body.warnings.find((w) => w.code === 'buyer_is_not_this_tenant'))
      .toMatchObject({ severity: 'blocking' })
  })

  it('stays quiet when the buyer VAT matches', async () => {
    await pool.query('UPDATE tenants SET tax_id = $2 WHERE id = $1', [seed.tenantA.id, 'NL123456789B01'])
    const res = await importBuf(asUserA, withBuyerVat('NL 123456789 B01'))
    expect(codes(res.body.warnings)).not.toContain('buyer_is_not_this_tenant')
  })

  it('stays quiet when the tenant has no VAT number on file — the common case', async () => {
    // Silence must mean "nothing to compare", never "verified": a tenant that
    // has not filled in its profile must still be able to import.
    await pool.query('UPDATE tenants SET tax_id = NULL, kvk_number = NULL WHERE id = $1', [seed.tenantA.id])
    const res = await importBuf(asUserA, withBuyerVat('NL999999999B99'))
    expect(codes(res.body.warnings)).not.toContain('buyer_is_not_this_tenant')
  })
})

describe('POST /purchases/import — rejected documents', () => {
  it('rejects a credit note', async () => {
    const res = await importBuf(asUserA, siUblText.replace(
      '<cbc:InvoiceTypeCode listAgencyID="6" listID="UNCL1001">380</cbc:InvoiceTypeCode>',
      '<cbc:InvoiceTypeCode>381</cbc:InvoiceTypeCode>',
    ))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('ubl_parse_failed')
  })

  it('rejects an invoice in another currency rather than booking it as EUR', async () => {
    const res = await importBuf(asUserA, siUblText.replaceAll('EUR', 'USD'))
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'unsupported_currency', currency: 'USD' })
  })

  it('rejects a file that is not a UBL invoice', async () => {
    const res = await importBuf(asUserA, '<html><body>not an invoice</body></html>')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('ubl_parse_failed')
  })

  it('rejects an invoice missing a mandatory field rather than defaulting it', async () => {
    const res = await importBuf(asUserA, siUblText.replace(
      '<cbc:IssueDate>2026-07-29</cbc:IssueDate>', '',
    ))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('ubl_parse_failed')
    // Nothing was created before the rejection.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM purchases WHERE tenant_id = $1', [seed.tenantA.id])
    expect(rows[0].n).toBe(0)
  })

  it('rejects a document whose root is not in the UBL Invoice namespace', async () => {
    const res = await importBuf(asUserA, siUblText.replace(
      'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
      'xmlns="urn:example:not-ubl"',
    ))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('ubl_parse_failed')
  })

  it('rejects a request with no file', async () => {
    const res = await asUserA(request(app).post('/api/purchases/import'))
    expect(res.status).toBe(400)
  })
})

describe('POST /purchases/import — tenant isolation', () => {
  it('files the purchase in the importing tenant only', async () => {
    const res = await importFile(asUserA, SI_UBL)
    const id = res.body.purchase.id

    // Tenant B must not learn the row exists.
    expect((await asUserB(request(app).get(`/api/purchases/${id}`))).status).toBe(404)
    expect((await asUserB(request(app).patch(`/api/purchases/${id}`)).send({ memo: 'theirs' })).status).toBe(404)
    expect((await asUserB(request(app).delete(`/api/purchases/${id}`))).status).toBe(404)

    const listB = await asUserB(request(app).get('/api/purchases'))
    expect(listB.body.map((p) => p.id)).not.toContain(id)

    const { rows } = await pool.query('SELECT tenant_id FROM purchases WHERE id = $1', [id])
    expect(rows[0].tenant_id).toBe(seed.tenantA.id)
  })

  it('never matches a supplier contact belonging to another tenant', async () => {
    await insertSupplier(seed.tenantB.id, {
      name: 'Recording Studio De Kerk', iban: 'NL55RABO0127957391',
    })
    const res = await importFile(asUserA, SI_UBL)

    expect(res.body.purchase.supplier_contact_id).toBeNull()
    expect(codes(res.body.warnings)).toContain('supplier_not_matched')
  })

  it('lets both tenants import the same bill — the number is unique per tenant', async () => {
    const b = await importFile(asUserB, SI_UBL)
    const a = await importFile(asUserA, SI_UBL)
    expect(b.status).toBe(201)
    expect(a.status).toBe(201)
    expect(codes(a.body.warnings)).not.toContain('possible_duplicate')
  })

  it('keeps the imported attachment out of the other tenant', async () => {
    const res = await importFile(asUserA, SI_UBL)
    const { id } = res.body.purchase
    const attachmentId = res.body.purchase.attachments[0].id

    expect((await asUserB(request(app).delete(`/api/purchases/${id}/attachments/${attachmentId}`))).status).toBe(404)
  })
})

describe('POST /purchases/import — CII and Factur-X', () => {
  // Same hybrid construction Factur-X uses: a readable PDF carrying the CII XML.
  async function facturXPdf(xml, name = 'factur-x.xml') {
    const { default: PDFDocument } = await import('pdfkit')
    const doc = new PDFDocument()
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    const done = new Promise((resolve) => doc.on('end', resolve))
    doc.text('Rechnung')
    doc.file(Buffer.from(xml), { name })
    doc.end()
    await done
    return Buffer.concat(chunks)
  }

  it('imports a German XRechnung sent as CII XML', async () => {
    const res = await importFile(asUserA, CII)
    expect(res.status).toBe(201)
    expect(res.body.purchase).toMatchObject({
      supplier_name: 'Tonstudio Hansa GmbH',
      supplier_invoice_number: 'RE-2026-0042',
      subtotal_cents: 95000,
      tax_cents: 18050,
      total_cents: 113050,
    })
    // tax_rate is NUMERIC, which pg hands back as a string.
    expect(res.body.purchase.lines.map((l) => Number(l.tax_rate))).toEqual([19, 19])
  })

  it('imports a Factur-X PDF and keeps the PDF itself as the attachment', async () => {
    const res = await asUserA(request(app).post('/api/purchases/import'))
      .attach('file', await facturXPdf(ciiText), 'rechnung.pdf')

    expect(res.status).toBe(201)
    expect(res.body.purchase.total_cents).toBe(113050)
    // The upload IS the human-readable invoice, so it becomes the attachment.
    expect(res.body.purchase.attachments).toHaveLength(1)
    expect(res.body.purchase.attachments[0]).toMatchObject({
      content_type: 'application/pdf',
      original_filename: 'rechnung.pdf',
    })
  })

  it('tells the user what to do with an ordinary PDF invoice', async () => {
    const { default: PDFDocument } = await import('pdfkit')
    const pdf = new PDFDocument()
    const chunks = []
    pdf.on('data', (c) => chunks.push(c))
    const done = new Promise((resolve) => pdf.on('end', resolve))
    pdf.text('Scanned invoice, no XML')
    pdf.end()
    await done

    const res = await asUserA(request(app).post('/api/purchases/import'))
      .attach('file', Buffer.concat(chunks), 'scan.pdf')

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/carries no e-invoice data/)
  })

  it('creates a usable draft from a line-less Factur-X MINIMUM document', async () => {
    const minimum = ciiText.replace(
      /<ram:IncludedSupplyChainTradeLineItem>[\s\S]*<\/ram:IncludedSupplyChainTradeLineItem>/, '',
    )
    const res = await importBuf(asUserA, minimum, 'minimum.xml')

    expect(res.status).toBe(201)
    expect(res.body.purchase.lines).toHaveLength(1)
    expect(res.body.purchase.total_cents).toBe(113050)
    expect(codes(res.body.warnings)).toContain('lines_synthesized_from_totals')
  })

  it('keeps a CII import inside the importing tenant', async () => {
    const res = await importFile(asUserA, CII)
    const id = res.body.purchase.id
    expect((await asUserB(request(app).get(`/api/purchases/${id}`))).status).toBe(404)
  })
})
