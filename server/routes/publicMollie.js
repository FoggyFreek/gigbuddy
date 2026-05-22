import { Router } from 'express'
import { urlencoded } from 'express'
import pool from '../db/index.js'
import { createTenantMollieClient } from '../utils/mollieClient.js'
import { syncInvoicePaymentStatus } from './invoices.js'

const router = Router()

// Mollie sends form-encoded bodies: id=tr_xxx
router.use(urlencoded({ extended: false }))

// Unauthenticated, CSRF-exempt.
// The webhook URL includes ?invoice=<id> so we can route to the right tenant
// without scanning all tenants. Security: we re-fetch state from Mollie using
// the tenant's stored key — we never trust the incoming id alone.
// Responds 200 always — Mollie retries on non-2xx. DB work is awaited so that
// test assertions run after the update is committed.
router.post('/payment-links/webhook', async (req, res) => {
  const paymentId = req.body?.id ?? req.query?.id ?? null
  const invoiceId = req.query?.invoice ? Number(req.query.invoice) : null

  if (!paymentId || !invoiceId || !Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(200).end()
  }

  try {
    const { rows } = await pool.query(
      `SELECT i.*, t.mollie_api_key
         FROM invoices i
         JOIN tenants t ON t.id = i.tenant_id
        WHERE i.id = $1 AND i.mollie_payment_link_id IS NOT NULL`,
      [invoiceId],
    )
    if (rows.length) {
      const invoice = rows[0]
      const mollieApiKey = invoice.mollie_api_key
      if (mollieApiKey) {
        const mollie = createTenantMollieClient(mollieApiKey)
        await syncInvoicePaymentStatus(mollie, pool, invoice, paymentId)
      }
    }
  } catch (err) {
    console.error('[mollie-webhook] error processing payment update:', err.message)
  }

  res.status(200).end()
})

export default router
