import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { settleInvoice } from '../../../server/services/invoiceService.js'
import { settlePurchase } from '../../../server/services/purchaseService.js'
import { markInvoicePaid } from '../../../server/repositories/invoiceRepository.js'
import { markPurchasePaid } from '../../../server/repositories/purchaseRepository.js'

// Stub MinIO (invoice PDF path is a no-op; we assert DB/ledger state).
vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    putObject: vi.fn(async () => ({ etag: 'test' })),
    getObject: vi.fn(async () => { throw new Error('no such key') }),
    statObject: vi.fn(async () => ({ size: 0, metaData: {} })),
    removeObject: vi.fn(async () => undefined),
  },
}))

const mockPaymentLinksGet = vi.fn()
const mockPaymentLinksDelete = vi.fn()
const mockPaymentLinksUpdate = vi.fn()

vi.mock('../../../server/utils/mollieClient.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createTenantMollieClient: vi.fn(() => ({
      paymentLinks: {
        get: mockPaymentLinksGet,
        delete: mockPaymentLinksDelete,
        update: mockPaymentLinksUpdate,
      },
    })),
  }
})

function mollieError(statusCode) {
  return Object.assign(new Error(`mollie ${statusCode}`), { statusCode })
}

function paymentLink(status, payments = []) {
  return {
    status,
    getPayments: () => ({
      take: () => ({
        [Symbol.asyncIterator]: async function* iterator() { yield* payments },
      }),
    }),
  }
}

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bankStatements')
const EUR = join(FIX, 'camt053_eur.xml')
const USD = join(FIX, 'camt053_usd.xml')

let app, pool, runMigrations, truncateAll, seedTwoTenants
let seed, settings

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
  const { rows } = await pool.query(
    'SELECT * FROM tenant_accounting_settings WHERE tenant_id = $1', [seed.tenantA.id],
  )
  settings = rows[0]
  vi.clearAllMocks()
  mockPaymentLinksGet.mockResolvedValue(paymentLink('open'))
  mockPaymentLinksDelete.mockResolvedValue(true)
  mockPaymentLinksUpdate.mockResolvedValue({ archived: true })
})

afterAll(async () => { await pool.end() })

const asUserA = (req) => req
  .set('x-test-user-id', String(seed.userA.id))
  .set('x-test-tenant-id', String(seed.tenantA.id))
const asUserB = (req) => req
  .set('x-test-user-id', String(seed.userB.id))
  .set('x-test-tenant-id', String(seed.tenantB.id))

const parse = (auth, file) => auth(request(app).post('/api/bank-import/parse')).attach('file', file)
const parseBuf = (auth, buf, name) => auth(request(app).post('/api/bank-import/parse')).attach('file', buf, name)
const commit = (auth, id, decisions) => auth(request(app).post(`/api/bank-import/${id}/commit`)).send({ decisions })
const cancel = (auth, id) => auth(request(app).delete(`/api/bank-import/${id}`))

const lineBy = (lines, name) => lines.find((l) => l.counterparty_name === name)

async function insertInvoice(tenantId, { number, total, status = 'sent', link = null }) {
  const { rows } = await pool.query(
    `INSERT INTO invoices (tenant_id, invoice_number, customer_name, status, issue_date,
       subtotal_cents, tax_cents, discount_cents, total_cents, mollie_payment_link_id)
     VALUES ($1,$2,'Cafe De Kroon',$3,'2026-02-01',$4,0,0,$4,$5) RETURNING *`,
    [tenantId, number, status, total, link],
  )
  return rows[0]
}

async function insertPurchase(tenantId, { receipt, total, status = 'approved' }) {
  const { rows } = await pool.query(
    `INSERT INTO purchases (tenant_id, receipt_number, supplier_name, status, receipt_date,
       subtotal_cents, tax_cents, total_cents)
     VALUES ($1,$2,'Jansen PA Rental',$3,'2026-02-01',$4,0,$4) RETURNING *`,
    [tenantId, receipt, status, total],
  )
  return rows[0]
}

async function journalsFor(tenantId, sourceType, sourceId) {
  const { rows } = await pool.query(
    `SELECT lt.id, lt.source_event, lt.entry_date,
            json_agg(json_build_object('code', le.account_code, 'd', le.debit_cents, 'c', le.credit_cents) ORDER BY le.id) AS entries
       FROM ledger_transactions lt
       JOIN ledger_entries le ON le.transaction_id = lt.id
      WHERE lt.tenant_id = $1 AND lt.source_type = $2 AND lt.source_id = $3
      GROUP BY lt.id ORDER BY lt.id`,
    [tenantId, sourceType, sourceId],
  )
  return rows
}

describe('bank-import parse + stage', () => {
  it('stages CAMT lines with suggestions and expands split entries', async () => {
    const res = await parse(asUserA, EUR)
    expect(res.status).toBe(201)
    expect(res.body.lines).toHaveLength(5)
    const jansen = lineBy(res.body.lines, 'Jansen PA Rental')
    expect(jansen).toMatchObject({ direction: 'debit', amount_cents: 12050, status: 'pending' })
    // RvslInd marks a reversal, while CdtDbtInd remains the booked direction.
    expect(lineBy(res.body.lines, 'Bounced Payment Ltd')).toMatchObject({ direction: 'credit', is_reversal: true })
  })

  it('skips non-EUR lines at stage time', async () => {
    const res = await parse(asUserA, USD)
    expect(res.body.lines[0].status).toBe('skipped_currency')
    expect(res.body.import.status).toBe('committed')
  })

  it('is idempotent on exact re-upload (same import id)', async () => {
    const first = await parse(asUserA, EUR)
    const second = await parse(asUserA, EUR)
    expect(second.body.import.id).toBe(first.body.import.id)
  })

  it('suggests an open invoice for a matching credit line', async () => {
    await insertInvoice(seed.tenantA.id, { number: 'INV-11', total: 60000 })
    const res = await parse(asUserA, EUR)
    const credit = lineBy(res.body.lines, 'Cafe De Kroon')
    expect(credit.suggestion.invoiceMatches.map((i) => i.invoice_number)).toContain('INV-11')
  })

  it('exposes the linked gig headline on a matched invoice', async () => {
    const { rows: [venue] } = await pool.query(
      `INSERT INTO venues (tenant_id, name, category, city) VALUES ($1,'Paradiso','venue','Amsterdam') RETURNING id`,
      [seed.tenantA.id],
    )
    const { rows: [festival] } = await pool.query(
      `INSERT INTO venues (tenant_id, name, category, city) VALUES ($1,'Lowlands','festival','Biddinghuizen') RETURNING id`,
      [seed.tenantA.id],
    )
    const { rows: [gig] } = await pool.query(
      `INSERT INTO gigs (tenant_id, event_date, event_description, venue_id, festival_id)
       VALUES ($1,'2026-08-15','Summer Show',$2,$3) RETURNING id`,
      [seed.tenantA.id, venue.id, festival.id],
    )
    const inv = await insertInvoice(seed.tenantA.id, { number: 'INV-11', total: 60000 })
    await pool.query('UPDATE invoices SET gig_id = $1 WHERE id = $2', [gig.id, inv.id])

    const res = await parse(asUserA, EUR)
    const match = lineBy(res.body.lines, 'Cafe De Kroon').suggestion.invoiceMatches
      .find((i) => i.invoice_number === 'INV-11')
    expect(match.gig).toMatchObject({
      event_description: 'Summer Show',
      event_date: '2026-08-15',
      venue_name: 'Paradiso',
      festival_name: 'Lowlands',
    })
  })

  it('leaves gig null on an invoice not linked to a gig', async () => {
    await insertInvoice(seed.tenantA.id, { number: 'INV-11', total: 60000 })
    const res = await parse(asUserA, EUR)
    const match = lineBy(res.body.lines, 'Cafe De Kroon').suggestion.invoiceMatches
      .find((i) => i.invoice_number === 'INV-11')
    expect(match.gig).toBeNull()
  })

  it('suggests a Mollie-linked invoice with its active-link marker', async () => {
    await insertInvoice(seed.tenantA.id, { number: 'INV-11', total: 60000, link: 'lnk_123' })
    const res = await parse(asUserA, EUR)
    expect(lineBy(res.body.lines, 'Cafe De Kroon').suggestion.invoiceMatches).toEqual([
      expect.objectContaining({ invoice_number: 'INV-11', mollie_payment_link_id: 'lnk_123' }),
    ])
  })

  it('does not flag a fresh import\'s own lines as duplicates', async () => {
    const res = await parse(asUserA, EUR)
    expect(res.body.lines.every((l) => l.suggestion.possibleDuplicate === false)).toBe(true)
  })

  it('flags a line whose bank reference appeared in a different prior import', async () => {
    await parse(asUserA, EUR) // stages a line with bank_ref ACCTREF-001
    const mt940 = [
      ':20:DUPREF', ':25:NL02RABO0123456789 EUR', ':28C:1/1', ':60F:C260201EUR0,00',
      ':61:2602030203D120,50NTRFOWNER//ACCTREF-001',
      ':86:/NAME/Jansen PA Rental/REMI/again',
      ':62F:C260203EUR0,00', '',
    ].join('\n')
    const second = await parseBuf(asUserA, Buffer.from(mt940), 'dupref.sta')
    expect(second.body.lines[0].suggestion.possibleDuplicate).toBe(true)
  })

  it('does not flag the same bank reference when transaction identity differs', async () => {
    await parse(asUserA, EUR)
    const mt940 = [
      ':20:DUPREF-DIFFERENT', ':25:NL02RABO0123456789 EUR', ':28C:1/1', ':60F:C260201EUR0,00',
      ':61:2602030203D121,50NTRFOWNER//ACCTREF-001',
      ':86:/NAME/Jansen PA Rental/REMI/different amount',
      ':62F:C260203EUR0,00', '',
    ].join('\n')
    const second = await parseBuf(asUserA, Buffer.from(mt940), 'dupref-different.sta')
    expect(second.body.lines[0].suggestion.possibleDuplicate).toBe(false)
  })

  it('is idempotent when the exact same file is uploaded concurrently', async () => {
    const bytes = readFileSync(EUR)
    const [first, second] = await Promise.all([
      parseBuf(asUserA, bytes, 'concurrent-a.xml'),
      parseBuf(asUserA, bytes, 'concurrent-b.xml'),
    ])
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body.import.id).toBe(first.body.import.id)
  })

  it('flags ambiguous supplier matches by shared IBAN without auto-picking', async () => {
    for (const name of ['Supplier One', 'Supplier Two']) {
      await pool.query(
        `INSERT INTO contacts (tenant_id, name, category, iban) VALUES ($1,$2,'supplier','NL91ABNA0417164300')`,
        [seed.tenantA.id, name],
      )
    }
    const res = await parse(asUserA, EUR)
    expect(lineBy(res.body.lines, 'Jansen PA Rental').suggestion.supplierMatches).toHaveLength(2)
  })
})

describe('bank-import commit', () => {
  async function configureMollie() {
    await pool.query(`UPDATE tenants SET mollie_api_key = 'test_key' WHERE id = $1`, [seed.tenantA.id])
  }

  it('reconciles an open invoice on the booking date', async () => {
    const inv = await insertInvoice(seed.tenantA.id, { number: 'INV-11', total: 60000 })
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'Cafe De Kroon')
    const res = await commit(asUserA, staged.body.import.id, [
      { line_id: line.id, action: 'reconcile_invoice', invoice_id: inv.id },
    ])
    expect(res.body.results[0].status).toBe('reconciled_invoice')

    const { rows: [after] } = await pool.query('SELECT status FROM invoices WHERE id = $1', [inv.id])
    expect(after.status).toBe('paid')
    const paid = journalsFor(seed.tenantA.id, 'invoice', inv.id)
    const paidJournal = (await paid).find((j) => j.source_event === 'paid')
    expect(String(paidJournal.entry_date).slice(0, 10)).toBe('2026-02-04')
  })

  it('deactivates an unpaid Mollie link before atomically reconciling the invoice', async () => {
    await configureMollie()
    const inv = await insertInvoice(seed.tenantA.id, { number: 'INV-M1', total: 60000, link: 'pl_bank' })
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'Cafe De Kroon')

    const res = await commit(asUserA, staged.body.import.id, [
      { line_id: line.id, action: 'reconcile_invoice', invoice_id: inv.id },
    ])
    expect(res.body.results[0].status).toBe('reconciled_invoice')
    expect(mockPaymentLinksDelete).toHaveBeenCalledWith('pl_bank')

    const { rows: [invoice] } = await pool.query(
      'SELECT status, mollie_payment_link_id FROM invoices WHERE id = $1', [inv.id],
    )
    expect(invoice).toMatchObject({ status: 'paid', mollie_payment_link_id: null })
    const { rows: [operation] } = await pool.query(
      'SELECT status FROM bank_mollie_reconciliation_operations WHERE bank_statement_line_id = $1', [line.id],
    )
    expect(operation.status).toBe('completed')
  })

  it('lets Mollie win a paid race and leaves the bank line pending', async () => {
    await configureMollie()
    const inv = await insertInvoice(seed.tenantA.id, { number: 'INV-M2', total: 60000, link: 'pl_paid' })
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'Cafe De Kroon')
    mockPaymentLinksDelete.mockRejectedValue(mollieError(422))
    mockPaymentLinksGet.mockResolvedValue(paymentLink('paid', [{
      id: 'tr_paid', status: 'paid', paidAt: '2026-02-04T12:00:00Z',
    }]))

    const res = await commit(asUserA, staged.body.import.id, [
      { line_id: line.id, action: 'reconcile_invoice', invoice_id: inv.id },
    ])
    expect(res.body.results[0].status).toBe('skipped_invoice_paid_via_mollie')
    const { rows: [storedLine] } = await pool.query(
      'SELECT status FROM bank_statement_lines WHERE id = $1', [line.id],
    )
    expect(storedLine.status).toBe('pending')
    const { rows: [invoice] } = await pool.query('SELECT status FROM invoices WHERE id = $1', [inv.id])
    expect(invoice.status).toBe('paid')
  })

  it('retains a retryable operation on Mollie failure and completes on retry', async () => {
    await configureMollie()
    const inv = await insertInvoice(seed.tenantA.id, { number: 'INV-M3', total: 60000, link: 'pl_retry' })
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'Cafe De Kroon')
    const decision = [{ line_id: line.id, action: 'reconcile_invoice', invoice_id: inv.id }]
    mockPaymentLinksDelete.mockRejectedValueOnce(mollieError(503))

    const failed = await commit(asUserA, staged.body.import.id, decision)
    expect(failed.body.results[0].status).toBe('skipped_mollie_error')
    const { rows: [afterFailure] } = await pool.query(
      'SELECT status FROM bank_mollie_reconciliation_operations WHERE bank_statement_line_id = $1', [line.id],
    )
    expect(afterFailure.status).toBe('retryable_error')

    const retried = await commit(asUserA, staged.body.import.id, decision)
    expect(retried.body.results[0].status).toBe('reconciled_invoice')
    expect(mockPaymentLinksDelete).toHaveBeenCalledTimes(2)
  })

  it('serializes concurrent Mollie reconciliations and deactivates the link once', async () => {
    await configureMollie()
    const inv = await insertInvoice(seed.tenantA.id, { number: 'INV-M4', total: 60000, link: 'pl_once' })
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'Cafe De Kroon')
    const decision = [{ line_id: line.id, action: 'reconcile_invoice', invoice_id: inv.id }]

    const [first, second] = await Promise.all([
      commit(asUserA, staged.body.import.id, decision),
      commit(asUserA, staged.body.import.id, decision),
    ])
    expect([first.body.results[0].status, second.body.results[0].status]).toEqual(
      expect.arrayContaining(['reconciled_invoice']),
    )
    expect(mockPaymentLinksDelete).toHaveBeenCalledTimes(1)
    expect(await journalsFor(seed.tenantA.id, 'invoice', inv.id)).toHaveLength(2)
  })

  it('rejects a cross-tenant linked invoice without contacting Mollie', async () => {
    await configureMollie()
    const foreign = await insertInvoice(seed.tenantB.id, { number: 'INV-B', total: 60000, link: 'pl_foreign' })
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'Cafe De Kroon')

    const res = await commit(asUserA, staged.body.import.id, [
      { line_id: line.id, action: 'reconcile_invoice', invoice_id: foreign.id },
    ])
    expect(res.body.results[0].status).toBe('skipped_not_found')
    expect(mockPaymentLinksDelete).not.toHaveBeenCalled()
  })

  it('rejects a reconcile whose amount does not match', async () => {
    const inv = await insertInvoice(seed.tenantA.id, { number: 'INV-9', total: 59999 })
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'Cafe De Kroon')
    const res = await commit(asUserA, staged.body.import.id, [
      { line_id: line.id, action: 'reconcile_invoice', invoice_id: inv.id },
    ])
    expect(res.body.results[0].status).toBe('skipped_amount_mismatch')
    const { rows: [after] } = await pool.query('SELECT status FROM invoices WHERE id = $1', [inv.id])
    expect(after.status).toBe('sent')
  })

  it('reconciles an approved bill', async () => {
    const bill = await insertPurchase(seed.tenantA.id, { receipt: 5001, total: 12050 })
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'Jansen PA Rental')
    const res = await commit(asUserA, staged.body.import.id, [
      { line_id: line.id, action: 'reconcile_purchase', purchase_id: bill.id },
    ])
    expect(res.body.results[0].status).toBe('reconciled_purchase')
    const { rows: [after] } = await pool.query('SELECT status, payment_method FROM purchases WHERE id = $1', [bill.id])
    expect(after).toMatchObject({ status: 'paid', payment_method: 'bank' })
  })

  it('posts a direct journal and creates a supplier with the counterparty IBAN', async () => {
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'String Supply Co')
    const res = await commit(asUserA, staged.body.import.id, [
      {
        line_id: line.id, action: 'journal_paid',
        contra_account_code: settings.default_expense_account_code,
        create_supplier: { name: 'String Supply Co', iban: 'NL00TEST0000000001' },
      },
    ])
    expect(res.body.results[0].status).toBe('imported')

    const journals = await journalsFor(seed.tenantA.id, 'bank_statement_line', line.id)
    expect(journals).toHaveLength(1)
    expect(journals[0].source_event).toBe('paid')
    const total = journals[0].entries.reduce((s, e) => s + e.d, 0)
    expect(total).toBe(3000)

    // The audited ledger link column is populated.
    const { rows: [stored] } = await pool.query(
      'SELECT ledger_transaction_id FROM bank_statement_lines WHERE id = $1', [line.id],
    )
    expect(stored.ledger_transaction_id).toBe(journals[0].id)

    const { rows } = await pool.query(
      `SELECT iban FROM contacts WHERE tenant_id = $1 AND name = 'String Supply Co' AND category = 'supplier'`,
      [seed.tenantA.id],
    )
    expect(rows[0].iban).toBe('NL00TEST0000000001')
  })

  it('reclassifies an imported direct payment when a later purchase is paid', async () => {
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'String Supply Co')
    await commit(asUserA, staged.body.import.id, [{
      line_id: line.id,
      action: 'journal_paid',
      contra_account_code: settings.default_expense_account_code,
    }])
    const original = (await journalsFor(seed.tenantA.id, 'bank_statement_line', line.id))[0]
    const bill = await insertPurchase(seed.tenantA.id, { receipt: 5002, total: 3000 })

    const candidates = await asUserA(request(app).get(`/api/purchases/${bill.id}/payment-candidates`)).expect(200)
    expect(candidates.body).toEqual([expect.objectContaining({
      id: line.id,
      amount_cents: 3000,
      counterparty_name: 'String Supply Co',
    })])

    const paid = await asUserA(request(app).post(`/api/purchases/${bill.id}/payment`))
      .send({ method: 'bank', paid_on: '2026-06-30', bank_statement_line_id: line.id })
      .expect(200)
    expect(paid.body).toMatchObject({ status: 'paid', payment_method: 'bank' })
    expect(paid.body.paid_at.slice(0, 10)).toBe('2026-02-05')

    const { rows: [stored] } = await pool.query(
      `SELECT status, matched_source_type, matched_source_id, ledger_transaction_id
         FROM bank_statement_lines WHERE id = $1`, [line.id],
    )
    expect(stored).toMatchObject({
      status: 'reconciled_purchase', matched_source_type: 'purchase', matched_source_id: bill.id,
    })
    const purchasePaid = (await journalsFor(seed.tenantA.id, 'purchase', bill.id))
      .find((journal) => journal.source_event === 'paid')
    expect(stored.ledger_transaction_id).toBe(purchasePaid.id)
    const { rows: [corrected] } = await pool.query(
      'SELECT voided_at, voided_by_transaction_id FROM ledger_transactions WHERE id = $1', [original.id],
    )
    expect(corrected.voided_at).not.toBeNull()
    expect(corrected.voided_by_transaction_id).not.toBeNull()
  })

  it('does not expose another tenant imported payment as a candidate', async () => {
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'String Supply Co')
    await commit(asUserA, staged.body.import.id, [{
      line_id: line.id, action: 'journal_paid', contra_account_code: settings.default_expense_account_code,
    }])
    const bill = await insertPurchase(seed.tenantB.id, { receipt: 5003, total: 3000 })
    const candidates = await asUserB(request(app).get(`/api/purchases/${bill.id}/payment-candidates`)).expect(200)
    expect(candidates.body).toEqual([])
  })

  it('corrects a subsequently closed imported payment forward into the open period', async () => {
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'String Supply Co')
    await commit(asUserA, staged.body.import.id, [{
      line_id: line.id, action: 'journal_paid', contra_account_code: settings.default_expense_account_code,
    }])
    const original = (await journalsFor(seed.tenantA.id, 'bank_statement_line', line.id))[0]
    await pool.query(
      `UPDATE tenant_accounting_settings SET books_closed_through = '2026-02-28' WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )
    const bill = await insertPurchase(seed.tenantA.id, { receipt: 5004, total: 3000 })

    const paid = await asUserA(request(app).post(`/api/purchases/${bill.id}/payment`))
      .send({ method: 'bank', bank_statement_line_id: line.id })
      .expect(200)
    expect(paid.body.paid_at.slice(0, 10)).toBe('2026-02-05')

    const { rows: [corrected] } = await pool.query(
      'SELECT voided_at, reversed_by_transaction_id FROM ledger_transactions WHERE id = $1', [original.id],
    )
    expect(corrected.voided_at).toBeNull()
    expect(corrected.reversed_by_transaction_id).not.toBeNull()
    const { rows: replacements } = await pool.query(
      `SELECT source_type, source_event, to_char(entry_date, 'YYYY-MM-DD') AS entry_date
         FROM ledger_transactions
        WHERE tenant_id = $1 AND id = ANY($2::int[])`,
      [seed.tenantA.id, [corrected.reversed_by_transaction_id]],
    )
    expect(replacements[0]).toMatchObject({
      source_type: 'ledger_transaction', source_event: 'reversal',
    })
    expect(replacements[0].entry_date > '2026-02-28').toBe(true)
    const purchasePaid = (await journalsFor(seed.tenantA.id, 'purchase', bill.id))
      .find((journal) => journal.source_event === 'paid')
    expect(String(purchasePaid.entry_date).slice(0, 10) > '2026-02-28').toBe(true)
  })

  it('posts an incoming direct journal to a revenue account', async () => {
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'Cafe De Kroon')
    const res = await commit(asUserA, staged.body.import.id, [
      { line_id: line.id, action: 'journal_received', contra_account_code: settings.default_revenue_account_code },
    ])
    expect(res.body.results[0].status).toBe('imported')
    const journals = await journalsFor(seed.tenantA.id, 'bank_statement_line', line.id)
    expect(journals[0].source_event).toBe('received')
    // DR checking / CR revenue.
    const checking = journals[0].entries.find((e) => e.code === settings.primary_checking_account_code)
    expect(checking.d).toBe(60000)
  })

  it('rejects a bad contra account type', async () => {
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'String Supply Co')
    // A revenue account is not valid for an outgoing (expense) line.
    const res = await commit(asUserA, staged.body.import.id, [
      { line_id: line.id, action: 'journal_paid', contra_account_code: settings.default_revenue_account_code },
    ])
    expect(res.body.results[0].status).toBe('skipped_invalid_account')
  })

  it('is idempotent: re-committing a posted line does not duplicate', async () => {
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'String Supply Co')
    const decision = [{ line_id: line.id, action: 'journal_paid', contra_account_code: settings.default_expense_account_code }]
    await commit(asUserA, staged.body.import.id, decision)
    const second = await commit(asUserA, staged.body.import.id, decision)
    expect(second.body.results[0].status).toBe('skipped_already_committed')
    expect(await journalsFor(seed.tenantA.id, 'bank_statement_line', line.id)).toHaveLength(1)
  })

  it('rejects duplicate line ids in one request (400)', async () => {
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'String Supply Co')
    const res = await commit(asUserA, staged.body.import.id, [
      { line_id: line.id, action: 'skip' },
      { line_id: line.id, action: 'skip' },
    ])
    expect(res.status).toBe(400)
  })
})

describe('bank-import cancel', () => {
  it('deletes an import whose lines are still uncommitted', async () => {
    const staged = await parse(asUserA, EUR)

    await cancel(asUserA, staged.body.import.id).expect(204)
    await asUserA(request(app).get(`/api/bank-import/${staged.body.import.id}`)).expect(404)

    const uploadedAgain = await parse(asUserA, EUR)
    expect(uploadedAgain.body.import.id).not.toBe(staged.body.import.id)
  })

  it('refuses to delete an import once any line has been committed', async () => {
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'String Supply Co')
    await commit(asUserA, staged.body.import.id, [{
      line_id: line.id,
      action: 'journal_paid',
      contra_account_code: settings.default_expense_account_code,
    }])

    const res = await cancel(asUserA, staged.body.import.id)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('bank_import_has_committed_lines')
    await asUserA(request(app).get(`/api/bank-import/${staged.body.import.id}`)).expect(200)
  })

  it('does not let another tenant delete a staged import', async () => {
    const staged = await parse(asUserA, EUR)

    await cancel(asUserB, staged.body.import.id).expect(404)
    await asUserA(request(app).get(`/api/bank-import/${staged.body.import.id}`)).expect(200)
  })
})

describe('bank-import tenant isolation', () => {
  it('cross-tenant read of an import returns 404', async () => {
    const staged = await parse(asUserA, EUR)
    const res = await asUserB(request(app).get(`/api/bank-import/${staged.body.import.id}`))
    expect(res.status).toBe(404)
  })

  it('cross-tenant commit returns 404 and posts nothing', async () => {
    const staged = await parse(asUserA, EUR)
    const line = lineBy(staged.body.lines, 'String Supply Co')
    const res = await commit(asUserB, staged.body.import.id, [
      { line_id: line.id, action: 'skip' },
    ])
    expect(res.status).toBe(404)
  })

  // The settle domain ops are called directly (not via a route) with a foreign
  // tenant id: a route can't reach this — its own tenant-scoping 404s first — but
  // the ops are the reusable primitive, so they must be safe on their own. A
  // zero-row scoped confirmation must never be followed by a ledger journal (there
  // is no FK from ledger_transactions.source_id back to the document).
  it('settleInvoice on a foreign tenant 404s, leaves status, and posts no journal', async () => {
    const inv = await insertInvoice(seed.tenantA.id, { number: 'INV-X', total: 60000 })
    const result = await settleInvoice(pool, seed.tenantB.id, inv.id, {
      entryDate: '2026-02-05', actorUserId: seed.userB.id, clampToOpenPeriod: true,
    })
    expect(result.error?.status).toBe(404)
    expect(await journalsFor(seed.tenantA.id, 'invoice', inv.id)).toHaveLength(0)
    const { rows: [after] } = await pool.query('SELECT status FROM invoices WHERE id = $1', [inv.id])
    expect(after.status).toBe('sent')
    // The scoped status write also refuses the foreign tenant.
    expect(await markInvoicePaid(pool, seed.tenantB.id, inv.id)).toBeNull()
  })

  it('settlePurchase on a foreign tenant 404s, leaves status, and posts no journal', async () => {
    const bill = await insertPurchase(seed.tenantA.id, { receipt: 5100, total: 12050 })
    const result = await settlePurchase(pool, seed.tenantB.id, bill.id, {
      paidOn: '2026-02-05', method: 'bank', registeredByUserId: seed.userB.id, clampToOpenPeriod: true,
    })
    expect(result.error?.status).toBe(404)
    expect(await journalsFor(seed.tenantA.id, 'purchase', bill.id)).toHaveLength(0)
    const { rows: [after] } = await pool.query('SELECT status, paid_at FROM purchases WHERE id = $1', [bill.id])
    expect(after).toMatchObject({ status: 'approved', paid_at: null })
    expect(await markPurchasePaid(pool, seed.tenantB.id, bill.id, { paidOn: '2026-02-05', method: 'bank' })).toBeNull()
  })
})

describe('bank-import opening balance', () => {
  const setOpening = (auth, id) => auth(request(app).post(`/api/bank-import/${id}/opening-balance`))

  it('suggests the opening balance only while the tenant has none', async () => {
    const staged = await parse(asUserA, EUR)
    expect(staged.body.openingBalanceSuggested).toBe(true)
    expect(staged.body.import).toMatchObject({
      opening_balance_cents: 100000, opening_balance_date: '2026-01-31',
    })

    const set = await setOpening(asUserA, staged.body.import.id).expect(200)
    expect(set.body.posted).toBe(true)

    const journal = await journalsFor(seed.tenantA.id, 'opening_balance', seed.tenantA.id)
    expect(journal[0].entries).toEqual([
      { code: '11000', d: 100000, c: 0 },
      { code: '39000', d: 0, c: 100000 },
    ])

    // Re-parsing the same file no longer nudges (opening balance now exists).
    const again = await parse(asUserA, EUR)
    expect(again.body.openingBalanceSuggested).toBe(false)
  })

  it('409s a second opening-balance set from an import', async () => {
    const staged = await parse(asUserA, EUR)
    await setOpening(asUserA, staged.body.import.id).expect(200)
    const second = await setOpening(asUserA, staged.body.import.id).expect(409)
    expect(second.body.code).toBe('opening_balance_exists')
  })

  it('cross-tenant opening-balance set returns 404 and posts nothing', async () => {
    const staged = await parse(asUserA, EUR)
    await setOpening(asUserB, staged.body.import.id).expect(404)
    expect(await journalsFor(seed.tenantA.id, 'opening_balance', seed.tenantA.id)).toHaveLength(0)
  })
})

describe('bank-import duplicate lines', () => {
  it('stages two legitimate identical lines as separate pending rows', async () => {
    const mt940 = [
      ':20:DUP',
      ':25:NL02RABO0123456789 EUR',
      ':28C:1/1',
      ':60F:C260201EUR0,00',
      ':61:2602030203D50,00NTRFREF1//BR1',
      ':86:/NAME/Rent Co/REMI/Monthly rent',
      ':61:2602030203D50,00NTRFREF2//BR2',
      ':86:/NAME/Rent Co/REMI/Monthly rent',
      ':62F:C260203EUR0,00',
      '',
    ].join('\n')
    const res = await parseBuf(asUserA, Buffer.from(mt940), 'dup.sta')
    const rentLines = res.body.lines.filter((l) => l.counterparty_name === 'Rent Co')
    expect(rentLines).toHaveLength(2)
    expect(rentLines.every((l) => l.status === 'pending')).toBe(true)
  })
})
