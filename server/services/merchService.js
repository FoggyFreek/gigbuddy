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
import { validateGigIdForTenant } from '../repositories/invoiceRepository.js'
import {
  ledgerErrorResult,
  postMerchSaleRecorded,
  postMerchSaleVoided,
} from './ledgerService.js'

const ALLOWED_TAX_RATES_SET = new Set(ALLOWED_TAX_RATES)

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
  vat_rate, quantity_on_hand, archived_at, created_at, updated_at`

export async function listProducts(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${PRODUCT_COLUMNS} FROM products
      WHERE tenant_id = $1
      ORDER BY archived_at IS NOT NULL, name ASC`,
    [tenantId],
  )
  return { products: rows }
}

function validateProductBody(body, { partial = false } = {}) {
  const errors = []
  const out = {}

  if (!partial || 'name' in body) {
    const name = String(body.name ?? '').trim()
    if (!name) errors.push({ field: 'name', message: 'Enter a name' })
    else out.name = name
  }
  for (const field of ['unit_cost_cents', 'default_price_incl_cents']) {
    if (!partial || field in body) {
      const cents = parseCents(body[field] ?? 0)
      if (cents === null) errors.push({ field, message: 'Enter a non-negative amount' })
      else out[field] = cents
    }
  }
  if (!partial || 'vat_rate' in body) {
    const rate = Number(body.vat_rate ?? 21)
    if (!ALLOWED_TAX_RATES_SET.has(rate)) errors.push({ field: 'vat_rate', message: 'Invalid VAT rate' })
    else out.vat_rate = rate
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
  const { rows } = await executor.query(
    `INSERT INTO products (tenant_id, name, unit_cost_cents, default_price_incl_cents, vat_rate)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${PRODUCT_COLUMNS}`,
    [tenantId, v.name, v.unit_cost_cents, v.default_price_incl_cents, v.vat_rate],
  )
  return { product: rows[0] }
}

export async function updateProduct(executor, tenantId, id, body) {
  const validated = validateProductBody(body, { partial: true })
  if (validated.error) return validated
  const entries = Object.entries(validated.values)
  if (!entries.length) return { error: { status: 400, body: { error: 'No valid fields to update' } } }

  const setClauses = entries.map(([k], i) => `${k} = $${i + 1}`)
  setClauses.push('updated_at = NOW()')
  const values = entries.map(([, v]) => v)
  values.push(id, tenantId)

  const { rows } = await executor.query(
    `UPDATE products SET ${setClauses.join(', ')}
      WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
      RETURNING ${PRODUCT_COLUMNS}`,
    values,
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
  s.status, s.voided_at, s.created_at`

export async function listMerchSales(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT ${SALE_COLUMNS}
       FROM merch_sales s
       JOIN products p ON p.id = s.product_id AND p.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1
      ORDER BY s.sale_date DESC, s.id DESC`,
    [tenantId],
  )
  return { sales: rows }
}

export async function recordMerchSale(pool, tenantId, body, actorUserId = null) {
  const productId = parsePositiveInt(body.product_id)
  if (!productId) return { error: { status: 400, body: { error: 'Invalid product_id' } } }

  const quantity = parsePositiveInt(body.quantity)
  if (!quantity) return { error: { status: 400, body: { error: 'quantity must be a positive integer' } } }

  const saleDate = body.sale_date ?? new Date().toISOString().slice(0, 10)
  if (!isValidCalendarDate(saleDate)) return { error: { status: 400, body: { error: 'Invalid sale_date' } } }

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

    const { rows: inserted } = await client.query(
      `INSERT INTO merch_sales
         (tenant_id, product_id, gig_id, sale_date, quantity,
          unit_price_incl_cents, vat_rate, unit_cost_cents, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [tenantId, productId, gigId, saleDate, quantity,
        unitPriceInclCents, vatRate, product.unit_cost_cents, actorUserId],
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
