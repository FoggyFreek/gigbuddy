// Merch domain logic: products with stock on hand, and sales that post a
// combined revenue + COGS journal. Route handlers stay thin and delegate here.
//
// Functions return a discriminated result like purchaseService:
//   { error: { status, body } }   — caller responds with that status/body
//   anything else                 — success payload
//
// Costing is moving average: each purchase stock-in re-averages the product's
// unit_cost_cents (see applyPurchaseStockIn in purchaseService.js), and each
// sale snapshots the average at sale time so voids reverse exactly and later
// cost changes don't rewrite history. Inventory in the ledger therefore always
// matches quantity × average cost.
import { ALLOWED_TAX_RATES } from '../validators/purchaseValidators.js'
import { isValidCalendarDate } from '../validators/accountValidators.js'
import { buildPeriodWhere } from '../utils/periodQuery.js'
import { validateGigIdForTenant } from '../repositories/invoiceRepository.js'
import { isAccountAtOrBelow } from '../repositories/accountRepository.js'
import { getSettings } from './accountService.js'
import {
  ledgerErrorResult,
  postMerchSaleRecorded,
  postMerchSaleVoided,
} from './ledgerService.js'

const ALLOWED_TAX_RATES_SET = new Set(ALLOWED_TAX_RATES)
const PAYMENT_METHODS = new Set(['bank', 'cash'])

function parseCents(val) {
  const n = Number(val)
  return Number.isInteger(n) && n >= 0 ? n : null
}

function parsePositiveInt(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

// ---------- products ----------

const PRODUCT_COLUMNS = `id, name, unit_cost_cents, default_price_incl_cents,
  vat_rate, quantity_on_hand, revenue_account_code, archived_at, created_at, updated_at`

// A product may book its merch revenue to the band's merch revenue account
// (merch_revenue_account_code) or any hierarchical descendant of it. Returns
// { value } (the trimmed code, or null to clear → falls back to the band
// default) or { error } on a bad reference. Needs DB access, so it lives outside
// the pure validateProductBody.
async function resolveProductRevenueAccount(executor, tenantId, raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { value: null }
  }
  const code = String(raw).trim()
  const { settings } = await getSettings(executor, tenantId)
  const parent = settings?.merch_revenue_account_code
  if (!parent) {
    return { error: { status: 400, body: { error: 'Merch revenue account not configured', code: 'merch_revenue_account_not_configured' } } }
  }
  const ok = await isAccountAtOrBelow(executor, tenantId, code, parent)
  if (!ok) {
    return {
      error: {
        status: 400,
        body: {
          error: 'Invalid revenue account',
          code: 'product_validation',
          fields: [{ field: 'revenue_account_code', message: 'Must be the merch revenue account or a sub-account of it' }],
        },
      },
    }
  }
  return { value: code }
}

export async function listProducts(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${PRODUCT_COLUMNS} FROM products
      WHERE tenant_id = $1
      ORDER BY archived_at IS NOT NULL, name ASC`,
    [tenantId],
  )
  return { products: rows }
}

// For a full create every field is set; for a partial (PATCH) only fields
// present in the body are.
function shouldSet(partial, body, field) {
  return !partial || field in body
}

function validateProductBody(body, { partial = false } = {}) {
  const errors = []
  const out = {}

  if (shouldSet(partial, body, 'name')) {
    const name = String(body.name ?? '').trim()
    if (name) out.name = name
    else errors.push({ field: 'name', message: 'Enter a name' })
  }
  for (const field of ['unit_cost_cents', 'default_price_incl_cents']) {
    if (shouldSet(partial, body, field)) {
      const cents = parseCents(body[field] ?? 0)
      if (cents === null) errors.push({ field, message: 'Enter a non-negative amount' })
      else out[field] = cents
    }
  }
  if (shouldSet(partial, body, 'vat_rate')) {
    const rate = Number(body.vat_rate ?? 21)
    if (ALLOWED_TAX_RATES_SET.has(rate)) out.vat_rate = rate
    else errors.push({ field: 'vat_rate', message: 'Invalid VAT rate' })
  }

  if (errors.length) {
    return { error: { status: 400, body: { error: 'Invalid product', code: 'product_validation', fields: errors } } }
  }
  return { values: out }
}

export async function createProduct(executor, tenantId, body) {
  const validated = validateProductBody(body)
  if (validated.error) return validated
  const v = validated.values
  const revenue = await resolveProductRevenueAccount(executor, tenantId, body.revenue_account_code)
  if (revenue.error) return revenue
  const { rows } = await executor.query(
    `INSERT INTO products (tenant_id, name, unit_cost_cents, default_price_incl_cents, vat_rate, revenue_account_code)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${PRODUCT_COLUMNS}`,
    [tenantId, v.name, v.unit_cost_cents, v.default_price_incl_cents, v.vat_rate, revenue.value],
  )
  return { product: rows[0] }
}

export async function updateProduct(executor, tenantId, id, body) {
  const validated = validateProductBody(body, { partial: true })
  if (validated.error) return validated
  const values = { ...validated.values }
  if ('revenue_account_code' in body) {
    const revenue = await resolveProductRevenueAccount(executor, tenantId, body.revenue_account_code)
    if (revenue.error) return revenue
    values.revenue_account_code = revenue.value
  }
  const entries = Object.entries(values)
  if (!entries.length) return { error: { status: 400, body: { error: 'No valid fields to update' } } }

  const setClauses = entries.map(([k], i) => `${k} = $${i + 1}`)
  setClauses.push('updated_at = NOW()')
  const params = entries.map(([, v]) => v)
  params.push(id, tenantId)

  const { rows } = await executor.query(
    `UPDATE products SET ${setClauses.join(', ')}
      WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
      RETURNING ${PRODUCT_COLUMNS}`,
    params,
  )
  if (!rows[0]) return { error: { status: 404, body: { error: 'Not found' } } }
  return { product: rows[0] }
}

// Products are archived, never deleted: purchase lines and sales reference
// them (composite FKs RESTRICT) and the history must stay readable.
export async function archiveProduct(executor, tenantId, id) {
  const { rows } = await executor.query(
    `UPDATE products SET archived_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL
      RETURNING ${PRODUCT_COLUMNS}`,
    [id, tenantId],
  )
  if (!rows[0]) return { error: { status: 404, body: { error: 'Not found' } } }
  return { product: rows[0] }
}

// ---------- sales ----------

const SALE_COLUMNS = `s.id, s.product_id, p.name AS product_name, s.gig_id,
  to_char(s.sale_date, 'YYYY-MM-DD') AS sale_date,
  s.quantity, s.unit_price_incl_cents, s.vat_rate, s.unit_cost_cents,
  s.payment_method, s.revenue_account_code, s.status, s.voided_at, s.created_at`

// Lists individual sales for the detail pane. Optional period (sale_date) and
// product_id filters; returns all statuses so voided rows still show greyed.
export async function listMerchSales(executor, tenantId, query = {}) {
  const period = buildPeriodWhere(query, 's.sale_date')
  if (period.error) return { error: { status: 400, body: { error: period.error } } }

  let productSql = ''
  const params = [tenantId, ...period.values]
  if (query.product_id !== undefined && query.product_id !== null && String(query.product_id) !== '') {
    const productId = parsePositiveInt(query.product_id)
    if (!productId) return { error: { status: 400, body: { error: 'Invalid product_id' } } }
    params.push(productId)
    productSql = ` AND s.product_id = $${params.length}`
  }

  const { rows } = await executor.query(
    `SELECT ${SALE_COLUMNS}
       FROM merch_sales s
       JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1
        ${period.sql}${productSql}
      ORDER BY s.sale_date DESC, s.id DESC`,
    params,
  )
  return { sales: rows }
}

// Per-product summary for the master list. Lists one row per product that had
// at least one non-voided sale in the period (voided sales add no row and no
// total). Account resolves per product (current revenue_account_code, else the
// band default) so each product is exactly one row.
export async function merchSalesSummary(executor, tenantId, query = {}) {
  const period = buildPeriodWhere(query, 's.sale_date')
  if (period.error) return { error: { status: 400, body: { error: period.error } } }

  const { rows } = await executor.query(
    `SELECT s.product_id,
            p.name AS product_name,
            COALESCE(p.revenue_account_code, tas.merch_revenue_account_code) AS revenue_account_code,
            coa.name AS revenue_account_name,
            SUM(s.quantity)::int AS total_qty,
            SUM(s.quantity * s.unit_price_incl_cents)::int AS total_amount_cents
       FROM merch_sales s
       JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
       JOIN tenant_accounting_settings tas ON tas.tenant_id = s.tenant_id
       LEFT JOIN chart_of_accounts coa
         ON coa.tenant_id = s.tenant_id
        AND coa.code = COALESCE(p.revenue_account_code, tas.merch_revenue_account_code)
      WHERE s.tenant_id = $1
        AND s.status = 'recorded'
        ${period.sql}
      GROUP BY s.product_id, p.name,
               COALESCE(p.revenue_account_code, tas.merch_revenue_account_code), coa.name
      ORDER BY total_amount_cents DESC, p.name ASC`,
    [tenantId, ...period.values],
  )
  return { rows }
}

// Distinct sale dates (recorded only, matching the summary) feeding the period
// picker so it never offers a period whose sales are all voided.
export async function merchSalesPeriods(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT DISTINCT to_char(sale_date, 'YYYY-MM-DD') AS date
       FROM merch_sales
      WHERE tenant_id = $1 AND status = 'recorded'
      ORDER BY date DESC`,
    [tenantId],
  )
  return rows.map((row) => row.date)
}

export async function recordMerchSale(pool, tenantId, body, actorUserId = null) {
  const productId = parsePositiveInt(body.product_id)
  if (!productId) return { error: { status: 400, body: { error: 'Invalid product_id' } } }

  const quantity = parsePositiveInt(body.quantity)
  if (!quantity) return { error: { status: 400, body: { error: 'quantity must be a positive integer' } } }

  const saleDate = body.sale_date ?? new Date().toISOString().slice(0, 10)
  if (!isValidCalendarDate(saleDate)) return { error: { status: 400, body: { error: 'Invalid sale_date' } } }

  const paymentMethod = body.payment_method ?? 'bank'
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    return { error: { status: 400, body: { error: 'Invalid payment_method', code: 'invalid_payment_method' } } }
  }

  let gigId = null
  if (body.gig_id != null) {
    gigId = await validateGigIdForTenant(pool, body.gig_id, tenantId)
    if (gigId === null) return { error: { status: 400, body: { error: 'Invalid gig_id' } } }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Lock the product row: serializes concurrent sales of the same product so
    // the stock check below can't race (CHECK quantity_on_hand >= 0 backstops).
    const { rows: productRows } = await client.query(
      'SELECT * FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [productId, tenantId],
    )
    const product = productRows[0]
    if (!product) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'Invalid product_id' } } }
    }
    if (product.archived_at) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'Product is archived', code: 'product_archived' } } }
    }
    if (product.quantity_on_hand < quantity) {
      await client.query('ROLLBACK')
      return {
        error: {
          status: 409,
          body: { error: 'Insufficient stock', code: 'insufficient_stock', available: product.quantity_on_hand },
        },
      }
    }

    const unitPriceInclCents = parseCents(body.unit_price_incl_cents ?? product.default_price_incl_cents)
    if (unitPriceInclCents === null) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'Invalid unit_price_incl_cents' } } }
    }
    const vatRate = Number(body.vat_rate ?? product.vat_rate)
    if (!ALLOWED_TAX_RATES_SET.has(vatRate)) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'Invalid vat_rate' } } }
    }

    // Snapshot the revenue account at sale time (the product's chosen account,
    // else null → the ledger falls back to the band's merch_revenue_account_code)
    // so a later void reverses to the exact same account.
    const revenueAccountCode = product.revenue_account_code ?? null

    const { rows: inserted } = await client.query(
      `INSERT INTO merch_sales
         (tenant_id, product_id, gig_id, sale_date, quantity,
          unit_price_incl_cents, vat_rate, unit_cost_cents, payment_method,
          revenue_account_code, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [tenantId, productId, gigId, saleDate, quantity,
        unitPriceInclCents, vatRate, product.unit_cost_cents, paymentMethod,
        revenueAccountCode, actorUserId],
    )
    const saleId = inserted[0].id

    await client.query(
      `UPDATE products SET quantity_on_hand = quantity_on_hand - $1, updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3`,
      [quantity, productId, tenantId],
    )

    await postMerchSaleRecorded(client, tenantId, {
      id: saleId,
      sale_date: saleDate,
      quantity,
      unit_price_incl_cents: unitPriceInclCents,
      vat_rate: vatRate,
      unit_cost_cents: product.unit_cost_cents,
      payment_method: paymentMethod,
      revenue_account_code: revenueAccountCode,
      product_name: product.name,
    }, { actorUserId })

    await client.query('COMMIT')
    return { saleId }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped) return mapped
    throw err
  } finally {
    client.release()
  }
}

export async function voidMerchSale(pool, tenantId, id, actorUserId = null) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT s.*, p.name AS product_name,
              p.quantity_on_hand AS product_quantity_on_hand,
              p.unit_cost_cents AS product_unit_cost_cents
         FROM merch_sales s
         JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
        WHERE s.id = $1 AND s.tenant_id = $2
        FOR UPDATE OF s, p`,
      [id, tenantId],
    )
    const sale = rows[0]
    if (!sale) {
      await client.query('ROLLBACK')
      return { error: { status: 404, body: { error: 'Not found' } } }
    }
    if (sale.status === 'voided') {
      await client.query('ROLLBACK')
      return { error: { status: 409, body: { error: 'Sale is already voided', code: 'already_voided' } } }
    }

    await client.query(
      `UPDATE merch_sales SET status = 'voided', voided_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    )
    // The units come back on hand at their snapshotted cost (what the reversal
    // journal puts back into inventory), so the moving average re-absorbs them.
    const newQty = sale.product_quantity_on_hand + sale.quantity
    const newCost = Math.round(
      (sale.product_quantity_on_hand * sale.product_unit_cost_cents
        + sale.quantity * sale.unit_cost_cents) / newQty,
    )
    await client.query(
      `UPDATE products SET quantity_on_hand = $1, unit_cost_cents = $2, updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4`,
      [newQty, newCost, sale.product_id, tenantId],
    )

    await postMerchSaleVoided(client, tenantId, sale, { actorUserId })

    await client.query('COMMIT')
    return {}
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped) return mapped
    throw err
  } finally {
    client.release()
  }
}
