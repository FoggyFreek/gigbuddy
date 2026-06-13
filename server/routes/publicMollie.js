import { Router, urlencoded } from 'express'
import pool from '../db/index.js'
import { notifyInvoicePaid } from '../services/invoiceService.js'
import { handlePaymentWebhook } from '../services/molliePaymentLinkService.js'

const router = Router()

// Mollie sends form-encoded bodies: id=tr_xxx
router.use(urlencoded({ extended: false }))

// Unauthenticated, CSRF-exempt.
// The webhook URL includes ?invoice=<id> so we can route to the right tenant
// without scanning all tenants. Security: state is re-fetched from Mollie using
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
    const result = await handlePaymentWebhook(pool, invoiceId)
    if (result.notify) {
      notifyInvoicePaid(result.notify.tenantId, result.notify.invoice)
    }
  } catch (err) {
    console.error('[mollie-webhook] error processing payment update:', err.message)
  }

  res.status(200).end()
})

export default router
