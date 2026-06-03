import { Router, urlencoded } from 'express'
import pool from '../db/index.js'
import { createTenantMollieClient } from '../utils/mollieClient.js'
import { notifyInvoicePaid } from '../services/invoiceService.js'
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
        // paymentId is only a "go check now" hint from Mollie — authoritative
        // status is re-fetched from Mollie inside syncInvoicePaymentStatus using
        // the secret key, so we never trust the posted id alone.
        const mollie = createTenantMollieClient(mollieApiKey)
        const updated = await syncInvoicePaymentStatus(mollie, pool, invoice)

        // Notify the band only on the transition to paid. Gating on the app
        // invoice status (not mollie_payment_status) keeps void invoices silent:
        // syncInvoicePaymentStatus leaves a void invoice 'void' even when Mollie
        // reports paid. Comparing the pre-read row against the update suppresses
        // Mollie's sequential retries — once status is 'paid', later reads skip.
        const becamePaid =
          updated &&
          invoice.status !== 'paid' &&
          updated.status === 'paid' &&
          updated.mollie_payment_status === 'paid'

        if (becamePaid) {
          notifyInvoicePaid(invoice.tenant_id, updated)
        }
      }
    }
  } catch (err) {
    console.error('[mollie-webhook] error processing payment update:', err.message)
  }

  res.status(200).end()
})

export default router
