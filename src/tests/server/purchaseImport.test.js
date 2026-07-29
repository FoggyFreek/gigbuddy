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
    expect(purchase.memo).toBe('20260038')
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

  it('warns on a second import of the same bill', async () => {
    const first = await importFile(asUserA, SI_UBL)
    const second = await importFile(asUserA, SI_UBL)

    expect(second.status).toBe(201)
    const duplicate = second.body.warnings.find((w) => w.code === 'possible_duplicate')
    expect(duplicate).toMatchObject({ severity: 'blocking' })
    expect(duplicate.receiptNumbers).toContain(first.body.purchase.receipt_number)
  })

  it('reports the discount allocation so the user knows the lines were changed', async () => {
    const res = await importFile(asUserA, SI_UBL)
    expect(codes(res.body.warnings)).toContain('document_discount_allocated')
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

  it('does not warn about a duplicate that belongs to another tenant', async () => {
    await importFile(asUserB, SI_UBL)
    const res = await importFile(asUserA, SI_UBL)
    expect(codes(res.body.warnings)).not.toContain('possible_duplicate')
  })

  it('keeps the imported attachment out of the other tenant', async () => {
    const res = await importFile(asUserA, SI_UBL)
    const { id } = res.body.purchase
    const attachmentId = res.body.purchase.attachments[0].id

    expect((await asUserB(request(app).delete(`/api/purchases/${id}/attachments/${attachmentId}`))).status).toBe(404)
  })
})
