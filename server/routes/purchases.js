import { Router } from 'express'
import pool from '../db/index.js'
import { parseId } from '../validators/purchaseValidators.js'
import { fetchPurchase, fetchPurchaseLines } from '../repositories/purchaseRepository.js'
import { createPurchase, applyPurchasePatch, registerPayment } from '../services/purchaseService.js'

const router = Router()

function requireId(req, res) {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

// ---------- list ----------
// Includes the first line's description so the table/search has something to show
// (the per-line description lives in purchase_lines, not on the purchase row).
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.receipt_number, p.supplier_name, p.supplier_contact_id,
            p.receipt_date, p.due_date, p.currency, p.status,
            p.subtotal_cents, p.tax_cents, p.total_cents,
            p.finalized_at, p.paid_at, p.created_at, p.updated_at,
            fl.description
       FROM purchases p
       LEFT JOIN LATERAL (
         SELECT description FROM purchase_lines pl
          WHERE pl.purchase_id = p.id AND pl.tenant_id = p.tenant_id
          ORDER BY position ASC, id ASC
          LIMIT 1
       ) fl ON TRUE
      WHERE p.tenant_id = $1
      ORDER BY p.receipt_date DESC, p.id DESC`,
    [req.tenantId],
  )
  res.json(rows)
})

// ---------- single ----------
router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const purchase = await fetchPurchase(pool, req.tenantId, id)
  if (!purchase) return res.status(404).json({ error: 'Not found' })
  const lines = await fetchPurchaseLines(pool, id, req.tenantId)
  res.json({ ...purchase, lines })
})

// ---------- create ----------
router.post('/', async (req, res) => {
  const result = await createPurchase(pool, req.tenantId, req.body || {})
  if (result.error) return res.status(result.error.status).json(result.error.body)
  const created = await fetchPurchase(pool, req.tenantId, result.purchaseId)
  const lines = await fetchPurchaseLines(pool, result.purchaseId, req.tenantId)
  res.status(201).json({ ...created, lines })
})

// ---------- patch ----------
router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await applyPurchasePatch(pool, req.tenantId, id, req.body || {})
  if (result.error) return res.status(result.error.status).json(result.error.body)
  const updated = await fetchPurchase(pool, req.tenantId, id)
  const lines = await fetchPurchaseLines(pool, id, req.tenantId)
  res.json({ ...updated, lines })
})

// ---------- delete (draft only) ----------
router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query(
    'SELECT status FROM purchases WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  if (rows[0].status !== 'draft') {
    return res.status(409).json({ error: 'Only draft purchases can be deleted', code: 'purchase_finalized' })
  }
  await pool.query('DELETE FROM purchases WHERE id = $1 AND tenant_id = $2', [id, req.tenantId])
  res.status(204).end()
})

// ---------- register payment ----------
router.post('/:id/payment', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const result = await registerPayment(pool, req.tenantId, id, req.body || {})
  if (result.error) return res.status(result.error.status).json(result.error.body)
  const updated = await fetchPurchase(pool, req.tenantId, id)
  const lines = await fetchPurchaseLines(pool, id, req.tenantId)
  res.json({ ...updated, lines })
})

export default router
