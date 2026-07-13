import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

// Stub MinIO so the invoice PDF render path is a no-op (we assert API output).
vi.mock('../../../server/utils/storage.js', () => ({
  BUCKET: 'test-bucket',
  storageClient: {
    putObject: vi.fn(async () => ({ etag: 'test' })),
    getObject: vi.fn(async () => { throw new Error('no such key') }),
    statObject: vi.fn(async () => ({ size: 0, metaData: {} })),
    removeObject: vi.fn(async () => undefined),
  },
}))

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
  return req.set('x-test-user-id', String(seed.userA.id)).set('x-test-tenant-id', String(seed.tenantA.id))
}
function asUserB(req) {
  return req.set('x-test-user-id', String(seed.userB.id)).set('x-test-tenant-id', String(seed.tenantB.id))
}

// An approved contributor in tenant A: may use the app but holds no finance
// permission at all, so finance mutations must 403.
async function createContributorA() {
  const { rows: u } = await pool.query(
    `INSERT INTO users (google_sub, email, name, status, is_super_admin)
     VALUES ('sub-contrib', 'contrib@a.local', 'Contrib User', 'approved', false) RETURNING *`,
  )
  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at)
     VALUES ($1, $2, 'contributor', 'approved', NOW())`,
    [u[0].id, seed.tenantA.id],
  )
  return (req) => req.set('x-test-user-id', String(u[0].id)).set('x-test-tenant-id', String(seed.tenantA.id))
}

// ---------- payload builders / drivers ----------

function purchasePayload(overrides = {}) {
  return {
    supplier_name: 'mi5 Studios',
    receipt_date: '2026-06-12',
    memo: 'TEST',
    lines: [
      { description: 'Studio day', account_code: '62100', tax_rate: 21, amount_incl_cents: 2500 },
    ],
    ...overrides,
  }
}

// Books an approved purchase and returns its ledger transaction detail
// (source_type 'purchase'). Posts: Dr 62100 net, Dr 15000 VAT, Cr 21100 gross.
async function purchaseLedgerDetail(receipt_date = '2026-06-12') {
  await asUserA(request(app).post('/api/purchases'))
    .send(purchasePayload({ status: 'approved', receipt_date })).expect(201)
  const list = await asUserA(request(app).get('/api/ledger')).expect(200)
  const row = list.body.find((r) => r.source_type === 'purchase')
  const detail = await asUserA(request(app).get(`/api/ledger/${row.id}`)).expect(200)
  return detail.body
}

function lineByAccount(detail, code) {
  return detail.lines.find((l) => l.account_code === code)
}

async function closeBooksThrough(date) {
  await asUserA(request(app).patch('/api/accounts/settings')).send({ books_closed_through: date }).expect(200)
}

function reclassify(txnId, body, as = asUserA) {
  return as(request(app).post(`/api/ledger/${txnId}/reclassify`)).send(body)
}

// ============================================================
describe('ledger notes — PATCH /api/ledger/:id/note', () => {
  it('sets, trims, and returns the note with audit metadata; detail carries it', async () => {
    const detail = await purchaseLedgerDetail()

    const res = await asUserA(request(app).patch(`/api/ledger/${detail.id}/note`))
      .send({ note: '  Checked with accountant  ' }).expect(200)
    expect(res.body.note).toBe('Checked with accountant')
    expect(res.body.note_updated_at).toBeTruthy()
    expect(res.body.note_updated_by_user_id).toBe(seed.userA.id)
    expect(res.body.note_updated_by_name).toBe('Alpha User')

    const after = await asUserA(request(app).get(`/api/ledger/${detail.id}`)).expect(200)
    expect(after.body.note).toBe('Checked with accountant')
    expect(after.body.note_updated_by_name).toBe('Alpha User')
    expect(after.body.note_updated_at).toBeTruthy()
  })

  it('stores blank input as NULL', async () => {
    const detail = await purchaseLedgerDetail()
    await asUserA(request(app).patch(`/api/ledger/${detail.id}/note`))
      .send({ note: 'temp' }).expect(200)

    const res = await asUserA(request(app).patch(`/api/ledger/${detail.id}/note`))
      .send({ note: '   ' }).expect(200)
    expect(res.body.note).toBeNull()

    const after = await asUserA(request(app).get(`/api/ledger/${detail.id}`)).expect(200)
    expect(after.body.note).toBeNull()
  })

  it('400s on a non-string note', async () => {
    const detail = await purchaseLedgerDetail()
    await asUserA(request(app).patch(`/api/ledger/${detail.id}/note`))
      .send({ note: { nested: true } }).expect(400)
  })

  it('a voided transaction can still be annotated', async () => {
    const detail = await purchaseLedgerDetail()
    const voided = await asUserA(request(app).post(`/api/ledger/${detail.id}/void`)).expect(200)

    await asUserA(request(app).patch(`/api/ledger/${detail.id}/note`))
      .send({ note: 'voided but noted' }).expect(200)
    // The correction entry too.
    await asUserA(request(app).patch(`/api/ledger/${voided.body.id}/note`))
      .send({ note: 'correction note' }).expect(200)
  })

  it('requires finance.manage (contributor 403s)', async () => {
    const detail = await purchaseLedgerDetail()
    const asContrib = await createContributorA()
    await asContrib(request(app).patch(`/api/ledger/${detail.id}/note`))
      .send({ note: 'nope' }).expect(403)
  })

  it('cross-tenant note write 404s and writes nothing', async () => {
    const detail = await purchaseLedgerDetail()
    await asUserB(request(app).patch(`/api/ledger/${detail.id}/note`))
      .send({ note: 'sneaky' }).expect(404)
    const after = await asUserA(request(app).get(`/api/ledger/${detail.id}`)).expect(200)
    expect(after.body.note).toBeNull()
  })
})

describe('ledger notes — list and search', () => {
  it('list rows carry the note; global search matches it', async () => {
    const detail = await purchaseLedgerDetail()
    await asUserA(request(app).patch(`/api/ledger/${detail.id}/note`))
      .send({ note: 'Zebra crossing fee' }).expect(200)

    const list = await asUserA(request(app).get('/api/ledger')).expect(200)
    const row = list.body.find((r) => r.id === detail.id)
    expect(row.note).toBe('Zebra crossing fee')

    const hit = await asUserA(request(app).get('/api/ledger/search').query({ q: 'Zebra' })).expect(200)
    expect(hit.body.map((r) => r.id)).toContain(detail.id)

    const miss = await asUserA(request(app).get('/api/ledger/search').query({ q: 'Giraffe' })).expect(200)
    expect(miss.body).toEqual([])
  })

  it('search on notes stays tenant-isolated', async () => {
    const detail = await purchaseLedgerDetail()
    await asUserA(request(app).patch(`/api/ledger/${detail.id}/note`))
      .send({ note: 'Zebra crossing fee' }).expect(200)
    const res = await asUserB(request(app).get('/api/ledger/search').query({ q: 'Zebra' })).expect(200)
    expect(res.body).toEqual([])
  })
})

describe('journal notes — draft note carried into the posted transaction', () => {
  it('create with note, edit on draft, approve → transaction is the canonical note', async () => {
    const created = await asUserA(request(app).post('/api/journal')).send({
      entry_date: '2026-06-10',
      description: 'Annotated journal',
      note: '  Draft note  ',
      lines: [
        { description: 'T', account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 1000, balancing_account_code: '11000' },
      ],
    }).expect(201)
    expect(created.body.note).toBe('Draft note')

    const patched = await asUserA(request(app).patch(`/api/journal/${created.body.id}`))
      .send({ note: 'Reviewed note' }).expect(200)
    expect(patched.body.note).toBe('Reviewed note')

    const approved = await asUserA(request(app).post(`/api/journal/${created.body.id}/approve`)).expect(200)
    const txnId = approved.body.posted_transaction_id
    expect(approved.body.note).toBe('Reviewed note')

    const detail = await asUserA(request(app).get(`/api/ledger/${txnId}`)).expect(200)
    expect(detail.body.note).toBe('Reviewed note')
    expect(detail.body.note_updated_by_name).toBe('Alpha User')

    // Editing the posted transaction's note wins on subsequent journal reads.
    await asUserA(request(app).patch(`/api/ledger/${txnId}/note`))
      .send({ note: 'Post-approval edit' }).expect(200)
    const journalRead = await asUserA(request(app).get(`/api/journal/${created.body.id}`)).expect(200)
    expect(journalRead.body.note).toBe('Post-approval edit')
  })

  it('approving a note-less journal leaves the transaction note empty', async () => {
    const created = await asUserA(request(app).post('/api/journal')).send({
      entry_date: '2026-06-10',
      description: 'Plain journal',
      lines: [
        { description: 'T', account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 1000, balancing_account_code: '11000' },
      ],
    }).expect(201)
    const approved = await asUserA(request(app).post(`/api/journal/${created.body.id}/approve`)).expect(200)
    const detail = await asUserA(request(app).get(`/api/ledger/${approved.body.posted_transaction_id}`)).expect(200)
    expect(detail.body.note).toBeNull()
    expect(detail.body.note_updated_at).toBeNull()
  })
})

describe('reclassification — POST /api/ledger/:id/reclassify', () => {
  it('immediately posts an approved two-line VAT-free transfer for a debit line (open period)', async () => {
    const detail = await purchaseLedgerDetail()
    const source = lineByAccount(detail, '62100')

    const res = await reclassify(detail.id, {
      source_line_id: source.id,
      destination_account_code: '64200',
      note: `Reclassified 62100 to 64200 from ledger entry #${detail.id}`,
    }).expect(201)

    // No draft phase: the journal comes back approved with its posting.
    const journal = res.body
    expect(journal.status).toBe('approved')
    expect(journal.posted_transaction_id).toBeGreaterThan(0)
    expect(journal.entry_date).toContain('2026-06-12') // original date; period open
    expect(journal.description).toBe(`Reclassification of ledger entry #${detail.id}`)
    expect(journal.note).toBe(`Reclassified 62100 to 64200 from ledger entry #${detail.id}`)
    expect(journal.reclassifies_ledger_entry_id).toBe(source.id)

    expect(journal.lines).toHaveLength(2)
    const [reversal, target] = journal.lines
    expect(reversal.account_code).toBe('62100')
    expect(reversal.side).toBe('credit') // opposite of the original debit
    expect(reversal.amount_cents).toBe(source.debit_cents)
    expect(Number(reversal.vat_rate)).toBe(0)
    expect(target.account_code).toBe('64200')
    expect(target.side).toBe('debit') // same side as the original
    expect(target.amount_cents).toBe(source.debit_cents)
    expect(Number(target.vat_rate)).toBe(0)

    // The posted transaction is a balanced full-amount gross transfer with the note.
    const posted = await asUserA(request(app).get(`/api/ledger/${journal.posted_transaction_id}`)).expect(200)
    expect(posted.body.entry_date).toBe('2026-06-12')
    expect(posted.body.note).toBe(`Reclassified 62100 to 64200 from ledger entry #${detail.id}`)
    const out = lineByAccount(posted.body, '62100')
    const into = lineByAccount(posted.body, '64200')
    expect(out.credit_cents).toBe(source.debit_cents)
    expect(out.debit_cents).toBe(0)
    expect(into.debit_cents).toBe(source.debit_cents)
    expect(into.credit_cents).toBe(0)
    const totalDebit = posted.body.lines.reduce((s, l) => s + l.debit_cents, 0)
    const totalCredit = posted.body.lines.reduce((s, l) => s + l.credit_cents, 0)
    expect(totalDebit).toBe(totalCredit)
    expect(totalDebit).toBe(source.debit_cents) // gross transfer, no VAT split

    // The source line links straight to the posted correction…
    const after = await asUserA(request(app).get(`/api/ledger/${detail.id}`)).expect(200)
    expect(lineByAccount(after.body, '62100').reclassification).toEqual({
      journal_id: journal.id,
      status: 'approved',
      posted_transaction_id: journal.posted_transaction_id,
    })
    expect(lineByAccount(after.body, '21100').reclassification).toBeNull()

    // …and no draft is left behind in the journal editor.
    const drafts = await asUserA(request(app).get('/api/journal')).expect(200)
    expect(drafts.body).toEqual([])
  })

  it('reclassifying a credit line swaps the sides the other way', async () => {
    const detail = await purchaseLedgerDetail()
    const source = lineByAccount(detail, '21100') // payable, credit side

    const res = await reclassify(detail.id, {
      source_line_id: source.id,
      destination_account_code: '64200',
    }).expect(201)

    expect(res.body.status).toBe('approved')
    const [reversal, target] = res.body.lines
    expect(reversal.account_code).toBe('21100')
    expect(reversal.side).toBe('debit')
    expect(reversal.amount_cents).toBe(source.credit_cents)
    expect(target.account_code).toBe('64200')
    expect(target.side).toBe('credit')
  })

  it('uses the first open date when the original date falls in a closed period', async () => {
    const detail = await purchaseLedgerDetail('2026-02-15')
    await closeBooksThrough('2026-05-31')
    const source = lineByAccount(detail, '62100')

    const res = await reclassify(detail.id, {
      source_line_id: source.id,
      destination_account_code: '64200',
    }).expect(201)
    expect(res.body.entry_date).toContain('2026-06-01')

    const posted = await asUserA(request(app).get(`/api/ledger/${res.body.posted_transaction_id}`)).expect(200)
    expect(posted.body.entry_date).toBe('2026-06-01')
  })

  it('blocks voiding and reversing a transaction whose line was reclassified (409)', async () => {
    const detail = await purchaseLedgerDetail()
    const source = lineByAccount(detail, '62100')
    await reclassify(detail.id, {
      source_line_id: source.id, destination_account_code: '64200',
    }).expect(201)

    const voidRes = await asUserA(request(app).post(`/api/ledger/${detail.id}/void`)).expect(409)
    expect(voidRes.body.code).toBe('has_reclassified_lines')

    // Same guard on the closed-period reversal path.
    await closeBooksThrough('2026-06-30')
    const reverseRes = await asUserA(request(app).post(`/api/ledger/${detail.id}/reverse`)).expect(409)
    expect(reverseRes.body.code).toBe('has_reclassified_lines')

    // Nothing was posted: the purchase transaction + the reclassification only.
    const list = await asUserA(request(app).get('/api/ledger')).expect(200)
    expect(list.body).toHaveLength(2)
  })

  it('voiding the reclassification unlocks the original for correction', async () => {
    const detail = await purchaseLedgerDetail()
    const source = lineByAccount(detail, '62100')
    const r = await reclassify(detail.id, {
      source_line_id: source.id, destination_account_code: '64200',
    }).expect(201)

    // Active reclassification blocks the original…
    const blocked = await asUserA(request(app).post(`/api/ledger/${detail.id}/void`)).expect(409)
    expect(blocked.body.code).toBe('has_reclassified_lines')

    // …voiding the reclassification (the unwind the 409 asks for) unblocks it.
    await asUserA(request(app).post(`/api/ledger/${r.body.posted_transaction_id}/void`)).expect(200)
    await asUserA(request(app).post(`/api/ledger/${detail.id}/void`)).expect(200)
  })

  it('blocks the invoice void workflow while the sent posting has an active reclassification', async () => {
    const inv = await asUserA(request(app).post('/api/invoices')).send({
      customer_name: 'Texel Buitengewoon',
      issue_date: '2026-06-09',
      payment_term_days: 14,
      tax_inclusive: false,
      discount_cents: 0,
      lines: [{ description: 'Optreden', quantity: 1, unit_price_cents: 100000, tax_percentage: 21 }],
    }).expect(201)
    await asUserA(request(app).patch(`/api/invoices/${inv.body.id}`)).send({ status: 'sent' }).expect(200)

    const list = await asUserA(request(app).get('/api/ledger')).expect(200)
    const sentRow = list.body.find((r) => r.source_type === 'invoice' && r.source_event === 'sent')
    const detail = await asUserA(request(app).get(`/api/ledger/${sentRow.id}`)).expect(200)
    const rec = await reclassify(sentRow.id, {
      source_line_id: detail.body.lines[0].id, destination_account_code: '64200',
    }).expect(201)

    // The domain void compensates invoice/sent — same guard as a manual void.
    const blocked = await asUserA(request(app).patch(`/api/invoices/${inv.body.id}`)).send({ status: 'void' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('has_reclassified_lines')

    // Unwinding the reclassification lets the domain void proceed.
    await asUserA(request(app).post(`/api/ledger/${rec.body.posted_transaction_id}/void`)).expect(200)
    await asUserA(request(app).patch(`/api/invoices/${inv.body.id}`)).send({ status: 'void' }).expect(200)
  })

  it('blocks the merch-sale void workflow while the recorded posting has an active reclassification', async () => {
    const product = await asUserA(request(app).post('/api/merch/products')).send({
      name: 'Band T-Shirt', unit_cost_cents: 1200, default_price_incl_cents: 3630, vat_rate: 21,
    }).expect(201)
    await asUserA(request(app).post('/api/purchases')).send({
      supplier_name: 'Merch Printer',
      receipt_date: '2026-05-01',
      status: 'approved',
      lines: [{
        description: 'T-shirt batch', tax_rate: 21,
        amount_incl_cents: Math.round(10 * 1200 * 1.21), product_id: product.body.id, quantity: 10,
      }],
    }).expect(201)
    const sale = await asUserA(request(app).post('/api/merch/sales')).send({
      product_id: product.body.id, quantity: 2, unit_price_incl_cents: 3630, vat_rate: 21,
    }).expect(201)

    const list = await asUserA(request(app).get('/api/ledger')).expect(200)
    const recordedRow = list.body.find((r) => r.source_type === 'merch_sale' && r.source_event === 'recorded')
    const detail = await asUserA(request(app).get(`/api/ledger/${recordedRow.id}`)).expect(200)
    const rec = await reclassify(recordedRow.id, {
      source_line_id: detail.body.lines[0].id, destination_account_code: '64200',
    }).expect(201)

    // The domain void mirrors merch_sale/recorded — same guard as a manual void.
    const blocked = await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`))
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('has_reclassified_lines')

    // Unwinding the reclassification lets the domain void proceed.
    await asUserA(request(app).post(`/api/ledger/${rec.body.posted_transaction_id}/void`)).expect(200)
    await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(200)
  })

  it('reversing the reclassification unlocks the original for reversal (closed period)', async () => {
    const detail = await purchaseLedgerDetail('2026-02-15')
    const source = lineByAccount(detail, '62100')
    const r = await reclassify(detail.id, {
      source_line_id: source.id, destination_account_code: '64200',
    }).expect(201)

    // Both the original and the reclassification (posted on the original date)
    // now fall in a closed period, so the correction mode is reversal.
    await closeBooksThrough('2026-05-31')
    const blocked = await asUserA(request(app).post(`/api/ledger/${detail.id}/reverse`)).expect(409)
    expect(blocked.body.code).toBe('has_reclassified_lines')

    await asUserA(request(app).post(`/api/ledger/${r.body.posted_transaction_id}/reverse`)).expect(200)
    await asUserA(request(app).post(`/api/ledger/${detail.id}/reverse`)).expect(200)
  })

  it('409s a second reclassification of the same line, with the existing reference', async () => {
    const detail = await purchaseLedgerDetail()
    const source = lineByAccount(detail, '62100')

    const first = await reclassify(detail.id, {
      source_line_id: source.id, destination_account_code: '64200',
    }).expect(201)

    const dup = await reclassify(detail.id, {
      source_line_id: source.id, destination_account_code: '63100',
    }).expect(409)
    expect(dup.body.code).toBe('already_reclassified')
    expect(dup.body.journal_id).toBe(first.body.id)
    expect(dup.body.posted_transaction_id).toBe(first.body.posted_transaction_id)
  })

  it('rejects voided, reversed, and correction transactions', async () => {
    // Voided original + its correction entry.
    const voidedDetail = await purchaseLedgerDetail()
    const voidRes = await asUserA(request(app).post(`/api/ledger/${voidedDetail.id}/void`)).expect(200)
    const sourceLine = lineByAccount(voidedDetail, '62100')
    const r1 = await reclassify(voidedDetail.id, {
      source_line_id: sourceLine.id, destination_account_code: '64200',
    }).expect(409)
    expect(r1.body.code).toBe('not_reclassifiable')

    const correction = await asUserA(request(app).get(`/api/ledger/${voidRes.body.id}`)).expect(200)
    const correctionLine = lineByAccount(correction.body, '62100')
    const r2 = await reclassify(voidRes.body.id, {
      source_line_id: correctionLine.id, destination_account_code: '64200',
    }).expect(409)
    expect(r2.body.code).toBe('not_reclassifiable')

    // Reversed original (closed period).
    await truncateAll()
    seed = await seedTwoTenants()
    const reversedDetail = await purchaseLedgerDetail('2026-02-15')
    await closeBooksThrough('2026-05-31')
    await asUserA(request(app).post(`/api/ledger/${reversedDetail.id}/reverse`)).expect(200)
    const revLine = lineByAccount(reversedDetail, '62100')
    const r3 = await reclassify(reversedDetail.id, {
      source_line_id: revLine.id, destination_account_code: '64200',
    }).expect(409)
    expect(r3.body.code).toBe('not_reclassifiable')
  })

  it('rejects unknown, inactive, and same-account destinations', async () => {
    const detail = await purchaseLedgerDetail()
    const source = lineByAccount(detail, '62100')

    const unknown = await reclassify(detail.id, {
      source_line_id: source.id, destination_account_code: '99999',
    }).expect(400)
    expect(unknown.body.code).toBe('invalid_destination_account')

    await pool.query(
      "UPDATE chart_of_accounts SET is_active = false WHERE tenant_id = $1 AND code = '64200'",
      [seed.tenantA.id],
    )
    const inactive = await reclassify(detail.id, {
      source_line_id: source.id, destination_account_code: '64200',
    }).expect(400)
    expect(inactive.body.code).toBe('invalid_destination_account')

    const same = await reclassify(detail.id, {
      source_line_id: source.id, destination_account_code: '62100',
    }).expect(400)
    expect(same.body.code).toBe('same_account')
  })

  it('rejects a line that does not belong to the transaction, and missing params', async () => {
    const detail = await purchaseLedgerDetail()
    // A second transaction whose line id is valid but on another transaction.
    const journal = await asUserA(request(app).post('/api/journal')).send({
      entry_date: '2026-06-10',
      description: 'Other txn',
      lines: [
        { description: 'T', account_code: '62100', vat_rate: 0, side: 'debit', amount_cents: 1000, balancing_account_code: '11000' },
      ],
    }).expect(201)
    const approved = await asUserA(request(app).post(`/api/journal/${journal.body.id}/approve`)).expect(200)
    const other = await asUserA(request(app).get(`/api/ledger/${approved.body.posted_transaction_id}`)).expect(200)

    const mismatch = await reclassify(detail.id, {
      source_line_id: other.body.lines[0].id, destination_account_code: '64200',
    }).expect(400)
    expect(mismatch.body.code).toBe('invalid_source_line')

    await reclassify(detail.id, { destination_account_code: '64200' }).expect(400)
    await reclassify(detail.id, { source_line_id: lineByAccount(detail, '62100').id }).expect(400)
  })

  it('requires finance.manage (contributor 403s)', async () => {
    const detail = await purchaseLedgerDetail()
    const asContrib = await createContributorA()
    await reclassify(detail.id, {
      source_line_id: lineByAccount(detail, '62100').id,
      destination_account_code: '64200',
    }, asContrib).expect(403)
  })

  it('cross-tenant reclassify 404s and writes nothing', async () => {
    const detail = await purchaseLedgerDetail()
    await reclassify(detail.id, {
      source_line_id: lineByAccount(detail, '62100').id,
      destination_account_code: '64200',
    }, asUserB).expect(404)

    const journalsA = await asUserA(request(app).get('/api/journal')).expect(200)
    expect(journalsA.body).toEqual([])
    const journalsB = await asUserB(request(app).get('/api/journal')).expect(200)
    expect(journalsB.body).toEqual([])
  })

  it('404s a missing transaction and 400s a non-numeric id', async () => {
    await reclassify(999999, { source_line_id: 1, destination_account_code: '64200' }).expect(404)
    await asUserA(request(app).post('/api/ledger/abc/reclassify'))
      .send({ source_line_id: 1, destination_account_code: '64200' }).expect(400)
  })
})
