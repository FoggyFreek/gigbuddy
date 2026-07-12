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
import {
  listProducts as listProductRows,
  insertProduct,
  updateProduct as updateProductRow,
  archiveProduct as archiveProductRow,
  listSales,
  summarizeSales,
  listSaleDates,
  lockProduct,
  insertSale,
  decrementProductStock,
  lockSaleWithProduct,
  markSaleVoided,
  setProductStock,
} from '../repositories/merchRepository.js'
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
  return { products: await listProductRows(executor, tenantId) }
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
  const product = await insertProduct(executor, tenantId, { ...v, revenue_account_code: revenue.value })
  return { product }
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
  if (!Object.keys(values).length) return { error: { status: 400, body: { error: 'No valid fields to update' } } }
  const product = await updateProductRow(executor, tenantId, id, values)
  if (!product) return { error: { status: 404, body: { error: 'Not found' } } }
  return { product }
}

// Products are archived, never deleted: purchase lines and sales reference
// them (composite FKs RESTRICT) and the history must stay readable.
export async function archiveProduct(executor, tenantId, id) {
  const product = await archiveProductRow(executor, tenantId, id)
  if (!product) return { error: { status: 404, body: { error: 'Not found' } } }
  return { product }
}

// ---------- sales ----------

// Lists individual sales for the detail pane. Optional period (sale_date) and
// product_id filters; returns all statuses so voided rows still show greyed.
export async function listMerchSales(executor, tenantId, query = {}) {
  const period = buildPeriodWhere(query, 's.sale_date')
  if (period.error) return { error: { status: 400, body: { error: period.error } } }

  let productId = null
  if (query.product_id !== undefined && query.product_id !== null && String(query.product_id) !== '') {
    productId = parsePositiveInt(query.product_id)
    if (!productId) return { error: { status: 400, body: { error: 'Invalid product_id' } } }
  }
  return { sales: await listSales(executor, tenantId, period.sql, period.values, productId) }
}

// Per-product summary for the master list. Lists one row per product that had
// at least one non-voided sale in the period (voided sales add no row and no
// total). Account resolves per product (current revenue_account_code, else the
// band default) so each product is exactly one row.
export async function merchSalesSummary(executor, tenantId, query = {}) {
  const period = buildPeriodWhere(query, 's.sale_date')
  if (period.error) return { error: { status: 400, body: { error: period.error } } }

  return { rows: await summarizeSales(executor, tenantId, period.sql, period.values) }
}

// Distinct sale dates (recorded only, matching the summary) feeding the period
// picker so it never offers a period whose sales are all voided.
export async function merchSalesPeriods(executor, tenantId) {
  return listSaleDates(executor, tenantId)
}

// Core of recording one sale, operating on a caller-supplied in-transaction
// `client` (no BEGIN/COMMIT here — the caller owns the transaction and rolls
// back on a returned { error }). Shared by the manual sale path (recordMerchSale)
// and the Shopify import (merchShopifyService), which records many lines across
// its own per-line transactions.
//
// `body.gross_incl_cents` is the exact inclusive line total override used by
// imports whose discounted gross isn't divisible by quantity; manual sales omit
// it and the gross stays quantity * unit_price_incl_cents.
export async function recordMerchSaleTx(client, tenantId, body, { actorUserId = null } = {}) {
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
    gigId = await validateGigIdForTenant(client, body.gig_id, tenantId)
    if (gigId === null) return { error: { status: 400, body: { error: 'Invalid gig_id' } } }
  }

  // Lock the product row: serializes concurrent sales of the same product so
  // the stock check below can't race (CHECK quantity_on_hand >= 0 backstops).
  const product = await lockProduct(client, tenantId, productId)
  if (!product) return { error: { status: 400, body: { error: 'Invalid product_id' } } }
  if (product.archived_at) {
    return { error: { status: 400, body: { error: 'Product is archived', code: 'product_archived' } } }
  }
  if (product.quantity_on_hand < quantity) {
    return {
      error: {
        status: 409,
        body: { error: 'Insufficient stock', code: 'insufficient_stock', available: product.quantity_on_hand },
      },
    }
  }

  const unitPriceInclCents = parseCents(body.unit_price_incl_cents ?? product.default_price_incl_cents)
  if (unitPriceInclCents === null) {
    return { error: { status: 400, body: { error: 'Invalid unit_price_incl_cents' } } }
  }
  const vatRate = Number(body.vat_rate ?? product.vat_rate)
  if (!ALLOWED_TAX_RATES_SET.has(vatRate)) {
    return { error: { status: 400, body: { error: 'Invalid vat_rate' } } }
  }

  let grossInclCents = null
  if (body.gross_incl_cents != null) {
    grossInclCents = parseCents(body.gross_incl_cents)
    if (grossInclCents === null) return { error: { status: 400, body: { error: 'Invalid gross_incl_cents' } } }
  }

  // Snapshot the revenue account at sale time (the product's chosen account,
  // else null → the ledger falls back to the band's merch_revenue_account_code)
  // so a later void reverses to the exact same account.
  const revenueAccountCode = product.revenue_account_code ?? null

  const saleId = await insertSale(client, tenantId, {
    productId, gigId, saleDate, quantity, unitPriceInclCents, grossInclCents,
    vatRate, unitCostCents: product.unit_cost_cents, paymentMethod,
    revenueAccountCode, actorUserId,
  })

  await decrementProductStock(client, tenantId, productId, quantity)

  await postMerchSaleRecorded(client, tenantId, {
    id: saleId,
    sale_date: saleDate,
    quantity,
    unit_price_incl_cents: unitPriceInclCents,
    gross_incl_cents: grossInclCents,
    vat_rate: vatRate,
    unit_cost_cents: product.unit_cost_cents,
    payment_method: paymentMethod,
    revenue_account_code: revenueAccountCode,
    product_name: product.name,
  }, { actorUserId })

  return { saleId }
}

export async function recordMerchSale(pool, tenantId, body, actorUserId = null) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await recordMerchSaleTx(client, tenantId, body, { actorUserId })
    if (result.error) {
      await client.query('ROLLBACK')
      return result
    }
    await client.query('COMMIT')
    return { saleId: result.saleId }
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
    const sale = await lockSaleWithProduct(client, tenantId, id)
    if (!sale) {
      await client.query('ROLLBACK')
      return { error: { status: 404, body: { error: 'Not found' } } }
    }
    if (sale.status === 'voided') {
      await client.query('ROLLBACK')
      return { error: { status: 409, body: { error: 'Sale is already voided', code: 'already_voided' } } }
    }

    await markSaleVoided(client, tenantId, id)
    // The units come back on hand at their snapshotted cost (what the reversal
    // journal puts back into inventory), so the moving average re-absorbs them.
    const newQty = sale.product_quantity_on_hand + sale.quantity
    const newCost = Math.round(
      (sale.product_quantity_on_hand * sale.product_unit_cost_cents
        + sale.quantity * sale.unit_cost_cents) / newQty,
    )
    await setProductStock(client, tenantId, sale.product_id, newQty, newCost)

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
