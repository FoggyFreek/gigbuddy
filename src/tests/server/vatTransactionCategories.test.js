import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import request from 'supertest'

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
  return req.set('x-test-user-id', String(seed.userA.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

function asUserB(req) {
  return req.set('x-test-user-id', String(seed.userB.id))
    .set('x-test-tenant-id', String(seed.tenantB.id))
}

function asSuper(req) {
  return req.set('x-test-user-id', String(seed.superUser.id))
    .set('x-test-tenant-id', String(seed.tenantA.id))
}

async function createSentInvoice(line = {}) {
  const created = await asUserA(request(app).post('/api/invoices')).send({
    customer_name: 'VAT customer',
    customer_address_street: 'Street 1',
    customer_address_city: 'Amsterdam',
    customer_address_country: 'nl',
    issue_date: '2026-02-01',
    payment_term_days: 14,
    tax_inclusive: false,
    lines: [{
      description: 'Performance',
      quantity: 1,
      unit_price_cents: 200000,
      tax_percentage: 21,
      tax_category_code: 'domestic_standard',
      tax_jurisdiction_code: 'nl',
      ...line,
    }],
  }).expect(201)
  await asUserA(request(app).patch(`/api/invoices/${created.body.id}`))
    .send({ status: 'sent' })
    .expect(200)
  return created.body
}

async function createApprovedPurchase(line = {}) {
  return asUserA(request(app).post('/api/purchases')).send({
    supplier_name: 'VAT supplier',
    receipt_date: '2026-02-10',
    status: 'approved',
    lines: [{
      description: 'Studio',
      account_code: '62100',
      amount_incl_cents: 121000,
      tax_rate: 21,
      tax_category_code: 'domestic_standard',
      tax_jurisdiction_code: 'nl',
      input_vat_recovery_percent: 100,
      ...line,
    }],
  }).expect(201)
}

async function transactionFor(sourceType, sourceId, sourceEvent) {
  const { rows } = await pool.query(
    `SELECT * FROM ledger_transactions
      WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3
        AND source_event = $4`,
    [seed.tenantA.id, sourceType, sourceId, sourceEvent],
  )
  return rows[0]
}

async function entriesFor(transactionId) {
  const { rows } = await pool.query(
    `SELECT account_code, debit_cents, credit_cents
       FROM ledger_entries WHERE tenant_id = $1 AND transaction_id = $2
       ORDER BY id`,
    [seed.tenantA.id, transactionId],
  )
  return rows
}

async function factsFor(transactionId) {
  const { rows } = await pool.query(
    `SELECT * FROM ledger_tax_facts
      WHERE tenant_id = $1 AND transaction_id = $2 ORDER BY id`,
    [seed.tenantA.id, transactionId],
  )
  return rows
}

function expectBalanced(entries) {
  expect(entries.reduce((sum, row) => sum + row.debit_cents, 0))
    .toBe(entries.reduce((sum, row) => sum + row.credit_cents, 0))
}

describe('VAT transaction-category posting', () => {
  it('stores confirmed facts and reconciles the Dutch boxes to the ledger', async () => {
    const invoice = await createSentInvoice()
    const purchase = (await createApprovedPurchase()).body

    const invoiceTx = await transactionFor('invoice', invoice.id, 'sent')
    const purchaseTx = await transactionFor('purchase', purchase.id, 'accrued')
    expect(await factsFor(invoiceTx.id)).toMatchObject([{
      category_code: 'domestic_standard',
      treatment: 'standard',
      taxable_base_cents: 200000,
      output_vat_cents: 42000,
      classification_status: 'confirmed',
    }])
    expect(await factsFor(purchaseTx.id)).toMatchObject([{
      category_code: 'domestic_standard',
      treatment: 'standard',
      deductible_input_vat_cents: 21000,
      classification_status: 'confirmed',
    }])
    expect(Number((await factsFor(purchaseTx.id))[0].recovery_percent)).toBe(100)

    const preview = await asUserA(
      request(app).get('/api/vat-returns/preview?year=2026&quarter=1'),
    ).expect(200)
    expect(preview.body).toMatchObject({
      calculation_mode: 'category_workpaper',
      output_vat_cents: 42000,
      input_vat_cents: 21000,
      boxes: {
        '1a': { base_cents: 200000, vat_cents: 42000 },
        '5b': { vat_cents: 21000 },
      },
      reconciliation: {
        output_difference_cents: 0,
        input_difference_cents: 0,
      },
      exceptions: [],
    })
    expect(preview.body.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        transaction_id: invoiceTx.id,
        transaction_description: expect.any(String),
        transaction_amount_cents: 242000,
        source_type: 'invoice',
        source_id: invoice.id,
      }),
      expect.objectContaining({
        transaction_id: purchaseTx.id,
        transaction_description: expect.any(String),
        transaction_amount_cents: 121000,
        source_type: 'purchase',
        source_id: purchase.id,
      }),
    ]))
  })

  it('does not deduct foreign VAT or post it to the Dutch input-VAT account', async () => {
    const purchase = (await createApprovedPurchase({
      amount_incl_cents: 12100,
      tax_category_code: 'foreign_vat',
      input_vat_recovery_percent: 100,
    })).body
    const transaction = await transactionFor('purchase', purchase.id, 'accrued')
    const [fact] = await factsFor(transaction.id)
    expect(fact).toMatchObject({
      category_code: 'foreign_vat',
      treatment: 'outside_scope',
      deductible_input_vat_cents: 0,
      non_deductible_input_vat_cents: 2100,
    })
    expect(Number(fact.recovery_percent)).toBe(0)
    const entries = await entriesFor(transaction.id)
    expectBalanced(entries)
    expect(entries.some((entry) => entry.account_code === '15000')).toBe(false)
    expect(entries.find((entry) => entry.account_code === '62100')).toMatchObject({
      debit_cents: 12100,
    })

    const preview = await asUserA(
      request(app).get('/api/vat-returns/preview?year=2026&quarter=1'),
    ).expect(200)
    expect(preview.body.boxes['5b'].vat_cents).toBe(0)
    expect(preview.body.input_vat_cents).toBe(0)
  })

  it('uses merchandise customer gross instead of gross journal debits for VAT review', async () => {
    const product = await asUserA(request(app).post('/api/merch/products')).send({
      name: "CD 'Good to see you'",
      unit_cost_cents: 400,
      default_price_incl_cents: 1500,
      vat_rate: 21,
      tax_category_code: 'domestic_standard',
      tax_jurisdiction_code: 'nl',
    }).expect(201)
    await createApprovedPurchase({
      description: 'CD stock',
      amount_incl_cents: 484,
      product_id: product.body.id,
      quantity: 1,
    })
    const sale = await asUserA(request(app).post('/api/merch/sales')).send({
      product_id: product.body.id,
      quantity: 1,
      unit_price_incl_cents: 1500,
      vat_rate: 21,
      sale_date: '2026-02-20',
    }).expect(201)
    const transaction = await transactionFor('merch_sale', sale.body.id, 'recorded')
    const entries = await entriesFor(transaction.id)
    expect(entries.reduce((sum, entry) => sum + entry.debit_cents, 0)).toBe(1900)

    const preview = await asUserA(
      request(app).get('/api/vat-returns/preview?year=2026&quarter=1'),
    ).expect(200)
    const merchFact = preview.body.facts.find((fact) => fact.transaction_id === transaction.id)
    expect(merchFact).toMatchObject({
      source_type: 'merch_sale',
      transaction_amount_cents: 1500,
      taxable_base_cents: 1240,
      tax_amount_cents: 260,
      output_vat_cents: 260,
      category_code: 'domestic_standard',
    })
  })

  it('books an intra-EU acquisition at gross cost with self-assessed VAT', async () => {
    const response = await createApprovedPurchase({
      amount_incl_cents: 10000,
      tax_category_code: 'intra_eu_acquisition_goods',
    })
    expect(response.body).toMatchObject({
      subtotal_cents: 10000,
      tax_cents: 0,
      total_cents: 10000,
    })
    const transaction = await transactionFor('purchase', response.body.id, 'accrued')
    const entries = await entriesFor(transaction.id)
    expectBalanced(entries)
    expect(entries.find((entry) => entry.account_code === '62100')).toMatchObject({
      debit_cents: 10000,
    })
    expect(entries.find((entry) => entry.account_code === '15000')).toMatchObject({
      debit_cents: 2100,
    })
    expect(entries.find((entry) => entry.account_code === '24000')).toMatchObject({
      credit_cents: 2100,
    })
  })

  it('keeps a KOR sales journal balanced and books the gross amount as revenue', async () => {
    await asUserA(request(app).post('/api/accounting-profile/schemes')).send({
      scheme_code: 'nl_kor',
      valid_from: '2020-01-01',
    }).expect(201)
    const journal = await asUserA(request(app).post('/api/journal')).send({
      entry_date: '2026-02-15',
      description: 'KOR cash sale',
      lines: [{
        account_code: '41000',
        vat_rate: 21,
        side: 'credit',
        amount_cents: 12100,
        balancing_account_code: '11000',
        position: 0,
      }],
    }).expect(201)
    await asUserA(request(app).post(`/api/journal/${journal.body.id}/approve`)).expect(200)

    const transaction = await transactionFor('journal', journal.body.id, 'posted')
    const entries = await entriesFor(transaction.id)
    expectBalanced(entries)
    expect(entries.find((entry) => entry.account_code === '41000')).toMatchObject({
      credit_cents: 12100,
    })
    expect(entries.some((entry) => entry.account_code === '24000')).toBe(false)
    expect(await factsFor(transaction.id)).toMatchObject([{
      category_code: 'small_business_exempt',
      output_vat_cents: 0,
      taxable_base_cents: 12100,
    }])
  })

  it('excludes both sides of an open-period generic void from the workpaper', async () => {
    const journal = await asUserA(request(app).post('/api/journal')).send({
      entry_date: '2026-02-15',
      description: 'Sale to void',
      lines: [{
        account_code: '41000',
        vat_rate: 21,
        side: 'credit',
        amount_cents: 12100,
        balancing_account_code: '11000',
        position: 0,
      }],
    }).expect(201)
    await asUserA(request(app).post(`/api/journal/${journal.body.id}/approve`)).expect(200)
    const original = await transactionFor('journal', journal.body.id, 'posted')
    await asUserA(request(app).post(`/api/ledger/${original.id}/void`)).expect(200)

    const preview = await asUserA(
      request(app).get('/api/vat-returns/preview?year=2026&quarter=1'),
    ).expect(200)
    expect(preview.body.facts).toEqual([])
    expect(preview.body.output_vat_cents).toBe(0)
    expect(preview.body.input_vat_cents).toBe(0)
  })

  it('excludes a merch sale and its void from the workpaper when both fall in an exemption period', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-02-20T12:00:00Z'))
    try {
      await asUserA(request(app).post('/api/accounting-profile/schemes')).send({
        scheme_code: 'nl_kor',
        valid_from: '2026-01-01',
      }).expect(201)
      const product = await asUserA(request(app).post('/api/merch/products')).send({
        name: 'LP Good to see you',
        unit_cost_cents: 400,
        default_price_incl_cents: 1500,
        vat_rate: 21,
        tax_category_code: 'domestic_standard',
        tax_jurisdiction_code: 'nl',
      }).expect(201)
      await pool.query(
        `UPDATE products
            SET quantity_on_hand = 1
          WHERE id = $1 AND tenant_id = $2`,
        [product.body.id, seed.tenantA.id],
      )
      const sale = await asUserA(request(app).post('/api/merch/sales')).send({
        product_id: product.body.id,
        quantity: 1,
        sale_date: '2026-02-15',
      }).expect(201)
      const original = await transactionFor('merch_sale', sale.body.id, 'recorded')

      const beforeVoid = await asUserA(
        request(app).get('/api/vat-returns/preview?year=2026&quarter=1'),
      ).expect(200)
      expect(beforeVoid.body.facts).toEqual([
        expect.objectContaining({
          transaction_id: original.id,
          category_code: 'small_business_exempt',
        }),
      ])

      await asUserA(request(app).post(`/api/merch/sales/${sale.body.id}/void`)).expect(200)
      const voidedOriginal = await transactionFor('merch_sale', sale.body.id, 'recorded')
      const voided = await transactionFor('ledger_transaction', original.id, 'void')
      expect(voidedOriginal).toMatchObject({
        source_event: 'recorded',
        voided_at: expect.any(Date),
        voided_by_transaction_id: voided.id,
      })
      expect(voided).toMatchObject({
        source_type: 'ledger_transaction',
        source_id: original.id,
        source_event: 'void',
      })
      expect(await factsFor(voidedOriginal.id)).toHaveLength(1)
      expect(await factsFor(voided.id)).toHaveLength(1)

      // Older merchandise cancellations identified the compensating journal by
      // source_event but did not always carry its own voided_at marker.
      await pool.query(
        `UPDATE ledger_transactions
            SET source_type = 'merch_sale',
                source_id = $3,
                source_event = 'voided',
                description = 'Merch sale voided: 1 × LP Good to see you',
                voided_at = NULL
          WHERE id = $1 AND tenant_id = $2`,
        [voided.id, seed.tenantA.id, sale.body.id],
      )

      const preview = await asUserA(
        request(app).get('/api/vat-returns/preview?year=2026&quarter=1'),
      ).expect(200)
      expect(preview.body.facts).toEqual([])
      expect(preview.body.exceptions).toEqual([])
      expect(preview.body.output_vat_cents).toBe(0)
      expect(preview.body.input_vat_cents).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not allow a stale workpaper to confirm a tax fact after its entry is voided', async () => {
    const { rows: [transaction] } = await pool.query(
      `INSERT INTO ledger_transactions (
         tenant_id, entry_date, description, source_type, source_id, source_event
       ) VALUES ($1, '2026-02-20', 'Legacy sale to void', 'legacy_test', 346, 'posted')
       RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO ledger_entries (
         tenant_id, transaction_id, account_code, debit_cents, credit_cents
       ) VALUES
         ($1, $2, '11000', 1995, 0),
         ($1, $2, '41000', 0, 1649),
         ($1, $2, '24000', 0, 346)`,
      [seed.tenantA.id, transaction.id],
    )
    await asSuper(
      request(app).post(`/api/admin/tenants/${seed.tenantA.id}/vat-tax-facts/backfill`),
    ).expect(200)
    const [fact] = await factsFor(transaction.id)

    await asUserA(request(app).post(`/api/ledger/${transaction.id}/void`)).expect(200)

    await asUserA(
      request(app).post(`/api/vat-returns/tax-facts/${fact.id}/confirm`),
    ).send({
      category_code: 'domestic_standard',
      tax_jurisdiction_code: 'nl',
      direction: 'sale',
      rate: 21,
      taxable_base_cents: 1649,
      tax_amount_cents: 346,
    }).expect(404)

    const [unchanged] = await factsFor(transaction.id)
    expect(unchanged.classification_status).toBe('unclassified')
  })
})

describe('VAT workpaper workflow and isolation', () => {
  it('confirms a €125 inventory purchase with €21.69 VAT and a €103.31 taxable amount', async () => {
    const { rows: [transaction] } = await pool.query(
      `INSERT INTO ledger_transactions (
         tenant_id, entry_date, description, source_type, source_id, source_event
       ) VALUES ($1, '2026-02-20', 'Inventory merchandise', 'legacy_test', 125, 'accrued')
       RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO ledger_entries (
         tenant_id, transaction_id, account_code, debit_cents, credit_cents
       ) VALUES
         ($1, $2, '12200', 10331, 0),
         ($1, $2, '15000', 2169, 0),
         ($1, $2, '21100', 0, 12500)`,
      [seed.tenantA.id, transaction.id],
    )

    await asSuper(
      request(app).post(`/api/admin/tenants/${seed.tenantA.id}/vat-tax-facts/backfill`),
    ).expect(200)
    const preview = await asUserA(
      request(app).get('/api/vat-returns/preview?year=2026&quarter=1'),
    ).expect(200)
    expect(preview.body.facts).toEqual([
      expect.objectContaining({
        transaction_id: transaction.id,
        transaction_amount_cents: 12500,
        tax_amount_cents: 2169,
        taxable_base_cents: 0,
        classification_status: 'unclassified',
      }),
    ])

    const fact = preview.body.facts[0]
    const confirmed = await asUserA(
      request(app).post(`/api/vat-returns/tax-facts/${fact.id}/confirm`),
    ).send({
      category_code: 'domestic_standard',
      tax_jurisdiction_code: 'nl',
      direction: 'purchase',
      rate: 21,
      taxable_base_cents: 10331,
      tax_amount_cents: 2169,
    }).expect(200)
    expect(confirmed.body).toMatchObject({
      category_code: 'domestic_standard',
      taxable_base_cents: 10331,
      deductible_input_vat_cents: 2169,
      classification_status: 'confirmed',
    })
    expect(Number(confirmed.body.rate)).toBe(21)
  })

  it('freezes a prepared return, submits it, and returns cross-tenant 404s', async () => {
    await createSentInvoice()
    const prepared = await asUserA(request(app).post('/api/vat-returns')).send({
      year: 2026,
      quarter: 1,
      calculation_mode: 'category_workpaper',
    }).expect(201)
    expect(prepared.body).toMatchObject({
      workflow_status: 'prepared',
      schema_country_code: 'nl',
      schema_version: 'nl-ob-2026.1',
    })
    expect(prepared.body.boxes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        box_code: '1a',
        base_raw_cents: 200000,
        vat_raw_cents: 42000,
      }),
    ]))
    expect(prepared.body.filed_at).toBeNull()

    const factId = prepared.body.facts[0].id
    await asUserB(request(app).get(`/api/vat-returns/${prepared.body.id}`)).expect(404)
    await asUserB(request(app).post(`/api/vat-returns/${prepared.body.id}/submit`))
      .send({ submission_reference: 'B-should-not-see-this' })
      .expect(404)
    await asUserB(request(app).post(`/api/vat-returns/tax-facts/${factId}/confirm`))
      .send({ category_code: 'domestic_standard' })
      .expect(404)

    const submitted = await asUserA(
      request(app).post(`/api/vat-returns/${prepared.body.id}/submit`),
    ).send({ submission_reference: 'NL-2026-Q1-test' }).expect(200)
    expect(submitted.body).toMatchObject({
      workflow_status: 'submitted',
      submission_reference: 'NL-2026-Q1-test',
    })
    expect(submitted.body.submitted_at).not.toBeNull()
  })

  it('hard-blocks preparation when a VAT control-account movement has no tax fact', async () => {
    await createSentInvoice()
    const { rows: [transaction] } = await pool.query(
      `INSERT INTO ledger_transactions (
         tenant_id, entry_date, description, source_type, source_id, source_event
       ) VALUES ($1, '2026-02-20', 'Legacy VAT movement', 'legacy_test', 1, 'posted')
       RETURNING id`,
      [seed.tenantA.id],
    )
    await pool.query(
      `INSERT INTO ledger_entries (
         tenant_id, transaction_id, account_code, debit_cents, credit_cents
       ) VALUES
         ($1, $2, '11000', 1000, 0),
         ($1, $2, '24000', 0, 1000)`,
      [seed.tenantA.id, transaction.id],
    )

    const preview = await asUserA(
      request(app).get('/api/vat-returns/preview?year=2026&quarter=1'),
    ).expect(200)
    expect(preview.body.reconciliation).toMatchObject({
      output_fact_cents: 42000,
      output_ledger_cents: 43000,
      output_difference_cents: -1000,
    })
    expect(preview.body.exceptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'ledger_reconciliation_difference',
        blocking: true,
      }),
    ]))

    const prepared = await asUserA(request(app).post('/api/vat-returns')).send({
      year: 2026,
      quarter: 1,
      calculation_mode: 'category_workpaper',
    }).expect(409)
    expect(prepared.body.code).toBe('vat_ledger_reconciliation_required')
  })

  it('requires a correcting journal instead of letting a posted base be rewritten', async () => {
    const journal = await asUserA(request(app).post('/api/journal')).send({
      entry_date: '2026-02-20',
      lines: [{
        account_code: '41000',
        vat_rate: 0,
        side: 'credit',
        amount_cents: 10000,
        balancing_account_code: '11000',
        position: 0,
        tax_category_code: 'outside_scope',
      }],
    }).expect(201)
    await asUserA(request(app).post(`/api/journal/${journal.body.id}/approve`)).expect(200)
    const transaction = await transactionFor('journal', journal.body.id, 'posted')
    const [fact] = await factsFor(transaction.id)
    await pool.query(
      `UPDATE ledger_tax_facts
          SET classification_status = 'legacy_inferred'
        WHERE id = $1 AND tenant_id = $2`,
      [fact.id, seed.tenantA.id],
    )

    const response = await asUserA(
      request(app).post(`/api/vat-returns/tax-facts/${fact.id}/confirm`),
    ).send({
      category_code: 'outside_scope',
      tax_jurisdiction_code: 'nl',
      rate: 0,
      taxable_base_cents: 999999,
      tax_amount_cents: 0,
    }).expect(409)
    expect(response.body.code).toBe('tax_fact_correction_required')
    const { rows: [unchanged] } = await pool.query(
      'SELECT taxable_base_cents, classification_status FROM ledger_tax_facts WHERE id = $1',
      [fact.id],
    )
    expect(unchanged).toMatchObject({
      taxable_base_cents: 10000,
      classification_status: 'legacy_inferred',
    })
  })
})

describe('VAT category boundary validation', () => {
  it('rejects unknown categories and unsupported jurisdictions before saving drafts', async () => {
    const invoice = await asUserA(request(app).post('/api/invoices')).send({
      customer_name: 'Bad VAT invoice',
      lines: [{
        description: 'Line',
        quantity: 1,
        unit_price_cents: 10000,
        tax_percentage: 21,
        tax_category_code: 'not_a_category',
      }],
    }).expect(400)
    expect(invoice.body).toMatchObject({ code: 'invalid_tax_category', line: 1 })

    const purchase = await asUserA(request(app).post('/api/purchases')).send({
      supplier_name: 'Bad VAT purchase',
      lines: [{
        description: 'Line',
        amount_incl_cents: 10000,
        tax_rate: 21,
        tax_jurisdiction_code: 'xx',
      }],
    }).expect(400)
    expect(purchase.body).toMatchObject({ code: 'invalid_tax_jurisdiction', line: 1 })

    const journal = await asUserA(request(app).post('/api/journal')).send({
      entry_date: '2026-02-01',
      lines: [{
        account_code: '41000',
        side: 'credit',
        amount_cents: 10000,
        tax_category_code: 'intra_eu_acquisition_goods',
      }],
    }).expect(400)
    expect(journal.body).toMatchObject({ code: 'invalid_tax_category', line: 1 })
  })
})
