import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { requireEntitlement } from '../middleware/entitlements.js'
import { FEATURES } from '../auth/entitlements.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listProducts,
  createProduct,
  updateProduct,
  archiveProduct,
  listMerchSales,
  merchSalesSummary,
  merchSalesPeriods,
  recordMerchSale,
  voidMerchSale,
} from '../services/merchService.js'
import { fetchRecentOrders } from '../services/shopifyService.js'
import { importShopifyOrders } from '../services/merchShopifyService.js'

const router = Router()

// ---------- products ----------

router.get('/products', async (req, res) => {
  const result = await listProducts(pool, req.tenantId)
  res.json(result.products)
})

router.post('/products', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const result = await createProduct(pool, req.tenantId, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.product)
})

router.patch('/products/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await updateProduct(pool, req.tenantId, id, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.json(result.product)
})

// Archive, not delete: sales and purchase lines keep referencing the product.
router.delete('/products/:id', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await archiveProduct(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.product)
})

// ---------- sales ----------

// Per-product totals for the selected period (master list).
router.get('/sales/summary', async (req, res) => {
  const result = await merchSalesSummary(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result.rows)
})

// Distinct sale dates for the period picker.
router.get('/sales/periods', async (req, res) => {
  res.json(await merchSalesPeriods(pool, req.tenantId))
})

router.get('/sales', async (req, res) => {
  const result = await listMerchSales(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result.sales)
})

router.post('/sales', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const result = await recordMerchSale(pool, req.tenantId, req.body || {}, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.status(201).json({ id: result.saleId })
})

router.post('/sales/:id/void', requirePermission(PERMISSIONS.FINANCE_MANAGE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await voidMerchSale(pool, req.tenantId, id, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.json({})
})

// ---------- shopify import ----------

// Recent Shopify orders for the import picker (fetched via the tenant's stored
// token + store domain). `cursor` pages older orders via the Link header.
// Shopify calls use the tenant's integration credentials, so they also need
// the integrations entitlement (finance: true with integrations: false must
// not reach Shopify — and this GET does a remote call, so the write-only
// finance gate doesn't cover it).
router.get('/shopify/orders', requirePermission(PERMISSIONS.FINANCE_MANAGE), requireEntitlement(FEATURES.INTEGRATIONS), async (req, res) => {
  const result = await fetchRecentOrders(pool, req.tenantId, { cursor: req.query.cursor, limit: req.query.limit })
  if (result.error) return sendError(res, result.error)
  res.json({ orders: result.orders, nextCursor: result.nextCursor })
})

// Import selected order lines (ids + mappings only; amounts re-fetched server-side).
router.post('/shopify/import', requirePermission(PERMISSIONS.FINANCE_MANAGE), requireEntitlement(FEATURES.INTEGRATIONS), async (req, res) => {
  const result = await importShopifyOrders(pool, req.tenantId, req.body || {}, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

export default router
