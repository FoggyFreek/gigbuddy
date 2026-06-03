import { Router } from 'express'
import pool from '../db/index.js'
import { statObject, getObject } from '../services/storageService.js'

const router = Router()

// Unauthenticated. Serves the tenant logo for an invoice that has a Mollie
// payment link — used by the post-payment thanks page which has no session.
// Gating on `mollie_payment_link_id` means random callers can't enumerate
// logos for invoices that were never shared for payment.
router.get('/:id/logo', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(404).end()

  const { rows } = await pool.query(
    `SELECT t.logo_path
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
      WHERE i.id = $1 AND i.mollie_payment_link_id IS NOT NULL`,
    [id],
  )
  const logoPath = rows[0]?.logo_path
  if (!logoPath) return res.status(404).end()

  try {
    const stat = await statObject(logoPath)
    res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream')
    res.setHeader('Content-Length', stat.size)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    const stream = await getObject(logoPath)
    stream.on('error', (streamErr) => {
      console.error('[public-invoices] storage stream error:', streamErr)
      if (!res.headersSent) res.status(502).end()
      else res.destroy()
    })
    stream.pipe(res)
  } catch (err) {
    if (err.code === 'NoSuchKey' || err.message?.includes('Not Found')) {
      return res.status(404).end()
    }
    throw err
  }
})

export default router
