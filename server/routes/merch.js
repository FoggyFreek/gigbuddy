import { Router } from 'express'
import pool from '../db/index.js'
import { parseId } from '../validators/purchaseValidators.js'
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

const router = Router()

function requireId(req, res) {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

// ---------- products ----------

router.get('/products', async (req, res) => {
  const result = await listProducts(pool, req.tenantId)
  res.json(result.products)
})

router.post('/products', async (req, res) => {
  const result = await createProduct(pool, req.tenantId, req.body || {})
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.status(201).json(result.product)
})

router.patch('/products/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await updateProduct(pool, req.tenantId, id, req.body || {})
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json(result.product)
})

// Archive, not delete: sales and purchase lines keep referencing the product.
router.delete('/products/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await archiveProduct(pool, req.tenantId, id)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json(result.product)
})

// ---------- sales ----------

// Per-product totals for the selected period (master list).
router.get('/sales/summary', async (req, res) => {
  const result = await merchSalesSummary(pool, req.tenantId, req.query)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json(result.rows)
})

// Distinct sale dates for the period picker.
router.get('/sales/periods', async (req, res) => {
  res.json(await merchSalesPeriods(pool, req.tenantId))
})

router.get('/sales', async (req, res) => {
  const result = await listMerchSales(pool, req.tenantId, req.query)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json(result.sales)
})

router.post('/sales', async (req, res) => {
  const result = await recordMerchSale(pool, req.tenantId, req.body || {}, req.user.id)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.status(201).json({ id: result.saleId })
})

router.post('/sales/:id/void', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await voidMerchSale(pool, req.tenantId, id, req.user.id)
  if (result.error) return res.status(result.error.status).json(result.error.body)
  res.json({})
})

export default router
