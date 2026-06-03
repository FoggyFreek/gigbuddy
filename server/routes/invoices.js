import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import QRCode from 'qrcode'
import pool from '../db/index.js'
import { uploadObject, removeObject, safeRemove, getObject, invoiceLogoKey } from '../services/storageService.js'
import { validateAndReencodeImage, extensionForImageMime } from '../utils/imageProcess.js'
import { assertMollieConfigured, createTenantMollieClient } from '../utils/mollieClient.js'
import {
  parseId,
  normalizeLines,
  computeDueDate,
  validatePaymentLinkOptions,
  PAYMENT_TERM_DAYS,
} from '../validators/invoiceValidators.js'
import {
  fetchTenant,
  fetchInvoice,
  fetchLines,
  insertInvoiceLines,
  nextInvoiceNumber,
  validateGigIdForTenant,
  stripMollieKey,
} from '../repositories/invoiceRepository.js'
import {
  computeAndApply,
  renderAndStorePdf,
  applyInvoicePatch,
  finalizeInvoiceForPaymentLink,
  createMolliePaymentLink,
  syncInvoicePaymentStatus,
} from '../services/invoiceService.js'

const router = Router()

const PAYMENT_LINK_LOCK_NAMESPACE = 53001
const LOGO_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
})

async function withPaymentLinkCreationLock(db, invoiceId, fn) {
  const client = await db.connect()
  let releaseError = null
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [PAYMENT_LINK_LOCK_NAMESPACE, invoiceId])
    return await fn()
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [PAYMENT_LINK_LOCK_NAMESPACE, invoiceId])
    } catch (err) {
      releaseError = err
      console.error('[invoices] failed to release payment-link advisory lock:', err)
    }
    client.release(releaseError)
  }
}

function requireId(req, res) {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

// ---------- list ----------
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, invoice_number, gig_id, issue_date, due_date,
            customer_name, total_cents, status, pdf_path, finalized_at,
            mollie_payment_link_id, mollie_payment_link_url,
            mollie_payment_status, mollie_paid_at,
            created_at, updated_at
       FROM invoices
      WHERE tenant_id = $1
      ORDER BY issue_date DESC, id DESC`,
    [req.tenantId],
  )
  res.json(rows)
})

// ---------- draft (from gig) ----------
function buildBillingTarget(type, row) {
  return {
    type,
    id: row.id,
    name: row.organization_name || row.name,
    contact_title: row.title || null,
    contact_given_name: row.given_name || null,
    contact_family_name: row.family_name || null,
    address_street: row.street_and_number || null,
    address_postal_code: row.postal_code || null,
    address_city: row.city || null,
    address_country: row.country || null,
    email: row.email || null,
  }
}

router.get('/draft-from-gig/:gigId', async (req, res) => {
  const gigId = parseId(req.params.gigId)
  if (gigId === null) return res.status(400).json({ error: 'Invalid gigId' })

  const { rows: gigs } = await pool.query(
    'SELECT * FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, req.tenantId],
  )
  if (!gigs.length) return res.status(404).json({ error: 'Gig not found' })
  const gig = gigs[0]

  let venue = null
  if (gig.venue_id) {
    const { rows } = await pool.query(
      'SELECT * FROM venues WHERE id = $1 AND tenant_id = $2',
      [gig.venue_id, req.tenantId],
    )
    venue = rows[0] || null
  }

  let festival = null
  if (gig.festival_id) {
    const { rows } = await pool.query(
      'SELECT * FROM venues WHERE id = $1 AND tenant_id = $2',
      [gig.festival_id, req.tenantId],
    )
    festival = rows[0] || null
  }

  const tenant = await fetchTenant(pool, req.tenantId)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

  const issueDate = new Date().toISOString().slice(0, 10)
  const paymentTermDays = 14
  const taxPercentage = tenant.applies_kor ? 0 : Number(tenant.tax_percentage ?? 9)

  const eventDateStr = gig.event_date
    ? new Date(gig.event_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''
  const description = `${tenant.band_name || ''} optreden tijdens ${gig.event_description || ''} op ${eventDateStr}`.trim()

  // Default billing target: festival when present, otherwise venue
  const defaultTarget = festival ?? venue

  // Build billing_targets list when both are present (enables choice in UI)
  const billingTargets = []
  if (festival) billingTargets.push(buildBillingTarget('festival', festival))
  if (venue) billingTargets.push(buildBillingTarget('venue', venue))

  res.json({
    gig: {
      id: gig.id,
      event_date: gig.event_date,
      event_description: gig.event_description,
      booking_fee_cents: gig.booking_fee_cents,
    },
    tenant: {
      id: tenant.id,
      band_name: tenant.band_name,
      formal_name: tenant.formal_name,
      address_street: tenant.address_street,
      address_postal_code: tenant.address_postal_code,
      address_city: tenant.address_city,
      address_country: tenant.address_country,
      email: null,
      phone: null,
      website: null,
      kvk_number: tenant.kvk_number,
      iban: tenant.iban,
      tax_id: tenant.tax_id,
      tax_percentage: tenant.tax_percentage,
      applies_kor: tenant.applies_kor,
      logo_path: tenant.logo_path,
    },
    billing_targets: billingTargets.length > 1 ? billingTargets : [],
    draft: {
      gig_id: gig.id,
      issue_date: issueDate,
      payment_term_days: paymentTermDays,
      due_date: computeDueDate(issueDate, paymentTermDays),
      customer_name: defaultTarget?.organization_name || defaultTarget?.name || '',
      customer_contact_title: defaultTarget?.title || null,
      customer_contact_given_name: defaultTarget?.given_name || null,
      customer_contact_family_name: defaultTarget?.family_name || null,
      customer_address_street: defaultTarget?.street_and_number || null,
      customer_address_postal_code: defaultTarget?.postal_code || null,
      customer_address_city: defaultTarget?.city || null,
      customer_address_country: defaultTarget?.country || 'NL',
      customer_email: defaultTarget?.email || null,
      customer_kvk: null,
      customer_tax_id: null,
      memo: null,
      tax_inclusive: false,
      discount_cents: 0,
      lines: [
        {
          description,
          quantity: 1,
          unit_price_cents: gig.booking_fee_cents ?? 0,
          tax_percentage: taxPercentage,
          position: 0,
        },
      ],
    },
  })
})

// ---------- single ----------
router.get('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const invoice = await fetchInvoice(pool, req.tenantId, id)
  if (!invoice) return res.status(404).json({ error: 'Not found' })
  const lines = await fetchLines(pool, id, req.tenantId)
  const tenant = await fetchTenant(pool, req.tenantId)
  res.json({ ...invoice, lines, tenant: stripMollieKey(tenant) })
})

// ---------- create ----------
router.post('/', async (req, res) => {
  const body = req.body || {}
  const customerName = String(body.customer_name ?? '').trim()
  if (!customerName) return res.status(400).json({ error: 'customer_name is required' })

  const paymentTermDays = PAYMENT_TERM_DAYS.has(Number(body.payment_term_days))
    ? Number(body.payment_term_days)
    : 14
  const issueDate = body.issue_date || new Date().toISOString().slice(0, 10)
  const dueDate = body.due_date || computeDueDate(issueDate, paymentTermDays)
  const taxInclusive = Boolean(body.tax_inclusive)
  const discountType = body.discount_type === 'pct' ? 'pct' : 'eur'
  const discountPct = Math.max(0, Number(body.discount_pct) || 0)
  const discountCents = Math.max(0, Number.isInteger(Number(body.discount_cents)) ? Number(body.discount_cents) : 0)
  const lines = normalizeLines(body.lines)
  if (!lines.length) return res.status(400).json({ error: 'At least one line is required' })

  const tenant = await fetchTenant(pool, req.tenantId)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

  const totals = computeAndApply({ tax_inclusive: taxInclusive, discount_type: discountType, discount_pct: discountPct, discount_cents: discountCents }, lines, tenant)
  const year = new Date(issueDate).getUTCFullYear() || new Date().getUTCFullYear()

  let gigId = null
  if (body.gig_id != null) {
    gigId = await validateGigIdForTenant(pool, body.gig_id, req.tenantId)
    if (gigId === null) return res.status(400).json({ error: 'Invalid gig_id' })
  }

  const client = await pool.connect()
  let invoiceId
  try {
    await client.query('BEGIN')
    const invoiceNumber = await nextInvoiceNumber(client, req.tenantId, year)
    const insertSql = `
      INSERT INTO invoices (
        tenant_id, gig_id, invoice_number, issue_date, due_date, payment_term_days,
        customer_name, customer_contact_title, customer_contact_given_name, customer_contact_family_name,
        customer_address_street, customer_address_postal_code,
        customer_address_city, customer_address_country, customer_email,
        customer_kvk, customer_tax_id, memo, tax_inclusive,
        discount_type, discount_pct, discount_cents,
        invert_logo,
        subtotal_cents, tax_cents, total_cents
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22,
        $23,
        $24, $25, $26
      ) RETURNING id`
    const { rows } = await client.query(insertSql, [
      req.tenantId, gigId, invoiceNumber, issueDate, dueDate, paymentTermDays,
      customerName, body.customer_contact_title || null, body.customer_contact_given_name || null, body.customer_contact_family_name || null,
      body.customer_address_street || null, body.customer_address_postal_code || null,
      body.customer_address_city || null, body.customer_address_country || null, body.customer_email || null,
      body.customer_kvk || null, body.customer_tax_id || null, body.memo || null, taxInclusive,
      discountType, discountPct, totals.discountCents,
      Boolean(body.invert_logo),
      totals.subtotalCents, totals.taxCents, totals.totalCents,
    ])
    invoiceId = rows[0].id

    await insertInvoiceLines(client, invoiceId, req.tenantId, lines)

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  try {
    await renderAndStorePdf(pool, invoiceId, req.tenantId)
  } catch (err) {
    console.error('[invoices] PDF render failed (row persisted, retry via POST /:id/render):', err)
  }

  const created = await fetchInvoice(pool, req.tenantId, invoiceId)
  const createdLines = await fetchLines(pool, invoiceId, req.tenantId)
  res.status(201).json({ ...created, lines: createdLines })
})

// ---------- patch ----------
router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return

  const result = await applyInvoicePatch(pool, req.tenantId, id, req.body || {})
  if (result.error) return res.status(result.error.status).json(result.error.body)

  if (result.contentChanged) {
    try {
      await renderAndStorePdf(pool, id, req.tenantId)
    } catch (err) {
      console.error('[invoices] PDF re-render failed:', err)
    }
  }

  const updated = await fetchInvoice(pool, req.tenantId, id)
  const lines = await fetchLines(pool, id, req.tenantId)
  res.json({ ...updated, lines })
})

// ---------- delete ----------
router.delete('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query(
    'SELECT pdf_path, custom_logo_path, status FROM invoices WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  if (rows[0].status !== 'draft') {
    return res.status(409).json({ error: 'Only draft invoices can be deleted', code: 'invoice_finalized' })
  }
  await pool.query('DELETE FROM invoices WHERE id = $1 AND tenant_id = $2', [id, req.tenantId])
  safeRemove(rows[0].pdf_path, '[invoices] failed to delete pdf on invoice delete:')
  safeRemove(rows[0].custom_logo_path, '[invoices] failed to delete custom logo on invoice delete:')
  res.status(204).end()
})

// ---------- render retry ----------
router.post('/:id/render', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rowCount } = await pool.query(
    'SELECT 1 FROM invoices WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  await renderAndStorePdf(pool, id, req.tenantId)
  const { rows } = await pool.query(
    'SELECT pdf_path FROM invoices WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  res.json({ pdf_path: rows[0].pdf_path })
})

// ---------- logo ----------
router.post('/:id/logo', logoUpload.single('logo'), async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!LOGO_ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }

  const { rows: existing } = await pool.query(
    'SELECT custom_logo_path, finalized_at FROM invoices WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!existing.length) return res.status(404).json({ error: 'Not found' })
  if (existing[0].finalized_at !== null) {
    return res.status(409).json({ error: 'Invoice is finalized', code: 'invoice_finalized' })
  }
  const oldKey = existing[0].custom_logo_path || null

  const image = await validateAndReencodeImage(req.file.buffer, req.file.mimetype)
  const ext = extensionForImageMime(image.mimetype)
  const objectKey = invoiceLogoKey(req.tenantId, randomUUID(), ext)

  await uploadObject(objectKey, image.buffer, image.size, image.mimetype)

  try {
    await pool.query(
      'UPDATE invoices SET custom_logo_path = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
      [objectKey, id, req.tenantId],
    )
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }

  safeRemove(oldKey, '[invoices] failed to delete old custom logo:')

  try {
    await renderAndStorePdf(pool, id, req.tenantId)
  } catch (err) {
    console.error('[invoices] PDF re-render after logo upload failed:', err)
  }

  res.json({ custom_logo_path: objectKey })
})

// ---------- payment link ----------
router.post('/:id/payment-link', async (req, res) => {
  const id = requireId(req, res); if (id === null) return

  const opts = validatePaymentLinkOptions(req.body || {})
  if (opts.error) return res.status(400).json({ error: opts.error })

  return withPaymentLinkCreationLock(pool, id, async () => {
    // Finalize the invoice before calling Mollie, so a concurrent PATCH sees
    // finalized_at. The advisory lock also makes the Mollie create single-flight.
    const finalize = await finalizeInvoiceForPaymentLink(pool, req.tenantId, id)
    if (finalize.error) return res.status(finalize.error.status).json(finalize.error.body)

    const tenant = await fetchTenant(pool, req.tenantId)

    if (finalize.alreadyLinked) {
      const lines = await fetchLines(pool, id, req.tenantId)
      return res.json({ ...finalize.alreadyLinked, lines, tenant: stripMollieKey(tenant) })
    }

    assertMollieConfigured(tenant)
    const created = await createMolliePaymentLink({
      pool, tenant, invoice: finalize.invoice, tenantId: req.tenantId, invoiceId: id, opts,
    })
    if (created.error) return res.status(created.error.status).json(created.error.body)

    // Re-render the PDF so it includes the QR code. Await so the response carries
    // the freshly-rendered pdf_path; renderAndStorePdf deletes the previous PDF,
    // so returning the stale key would 404 on download.
    let finalInvoice = created.invoice
    try {
      await renderAndStorePdf(pool, id, req.tenantId)
      const refreshed = await fetchInvoice(pool, req.tenantId, id)
      if (refreshed) finalInvoice = refreshed
    } catch (err) {
      console.error('[invoices] PDF re-render after payment-link creation failed:', err)
    }

    const lines = await fetchLines(pool, id, req.tenantId)
    return res.status(201).json({ ...finalInvoice, lines, tenant: stripMollieKey(tenant) })
  })
})

// ---------- payment link sync ----------
router.post('/:id/payment-link/sync', async (req, res) => {
  const id = requireId(req, res); if (id === null) return

  const invoice = await fetchInvoice(pool, req.tenantId, id)
  if (!invoice) return res.status(404).json({ error: 'Not found' })

  if (!invoice.mollie_payment_link_id) {
    return res.status(400).json({ error: 'no_payment_link' })
  }

  const tenant = await fetchTenant(pool, req.tenantId)
  assertMollieConfigured(tenant)

  const mollie = createTenantMollieClient(tenant.mollie_api_key)
  const updated = await syncInvoicePaymentStatus(mollie, pool, invoice)

  res.json({
    paymentLinkId: updated.mollie_payment_link_id,
    paymentLinkUrl: updated.mollie_payment_link_url,
    paymentId: updated.mollie_payment_id,
    status: updated.mollie_payment_status,
    paidAt: updated.mollie_paid_at,
    invoiceStatus: updated.status,
  })
})

router.delete('/:id/logo', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const { rows } = await pool.query(
    'SELECT custom_logo_path, finalized_at FROM invoices WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  if (rows[0].finalized_at !== null) {
    return res.status(409).json({ error: 'Invoice is finalized', code: 'invoice_finalized' })
  }
  const oldKey = rows[0].custom_logo_path
  await pool.query(
    'UPDATE invoices SET custom_logo_path = NULL, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  safeRemove(oldKey, '[invoices] failed to delete custom logo on remove:')
  try {
    await renderAndStorePdf(pool, id, req.tenantId)
  } catch (err) {
    console.error('[invoices] PDF re-render after logo remove failed:', err)
  }
  res.status(204).end()
})

// ---------- email (.eml) ----------

function escHtml(str) {
  if (!str) return ''
  return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function wrapBase64Lines(str) {
  return str.match(/.{1,76}/g).join('\r\n')
}

function buildPaymentSectionHtml(url, invoiceNumber, qrBase64) {
  const qrCell = qrBase64 ? `
            <td style="vertical-align:top;text-align:center;padding-left:24px;min-width:144px;width:144px;">
              <img src="cid:qr-betaallink" alt="QR-code betaallink" width="120" height="120"
                   style="display:block;border:1px solid #dddddd;padding:4px;background:#ffffff;margin:0 auto;" />
              <p style="margin:6px 0 0 0;font-size:11px;color:#888888;text-align:center;">Scan om te betalen</p>
            </td>` : ''
  return `
                <tr>
                  <td style="padding-top:8px;padding-bottom:16px;">
                    <table cellpadding="0" cellspacing="0" border="0" width="100%"
                           style="background:#f0f4ff;border:1px solid #c8d4f0;border-radius:3px;padding:20px;">
                      <tr>
                        <td style="vertical-align:top;">
                          <p style="margin:0 0 6px 0;font-size:13px;font-weight:bold;color:#1a1a2e;">Betaallink</p>
                          <p style="margin:0 0 14px 0;font-size:14px;color:#333333;line-height:1.6;">
                            U kunt uw factuur voldoen via de onderstaande betaallink:
                          </p>
                          <p style="margin:0 0 10px 0;">
                            <a href="${escHtml(url)}"
                               style="display:inline-block;padding:10px 22px;background:#1a1a2e;color:#ffffff;
                                      text-decoration:none;font-size:14px;font-weight:bold;border-radius:3px;">
                              Factuur ${escHtml(invoiceNumber)} betalen
                            </a>
                          </p>
                          <p style="margin:0;font-size:12px;color:#888888;word-break:break-all;">${escHtml(url)}</p>
                        </td>${qrCell}
                      </tr>
                    </table>
                  </td>
                </tr>`
}

function defaultPersonalMessage(bandName, gigDate) {
  const gigPart = gigDate ? ` tijdens het optreden van ${bandName} op ${gigDate}` : ''
  return `Hartelijk dank voor de prettige samenwerking${gigPart}.\n\nIn de bijlage vindt u onze factuur.`
}

function buildEmailHtml({ bandName, invoiceNumber, issueDate, gigDate, greeting, personalMessage, paymentSectionHtml }) {
  const personalHtml = escHtml(personalMessage).replaceAll('\n', '<br>')
  const issueDateCell = issueDate
    ? `<td style="padding-left:32px;">
                        <p style="margin:0 0 2px 0;font-size:12px;color:#888888;">Factuurdatum</p>
                        <p style="margin:0;font-size:17px;font-weight:bold;color:#1a1a2e;">${escHtml(issueDate)}</p>
                      </td>`
    : ''
  const footerGigPart = gigDate ? ` &nbsp;&middot;&nbsp; Optreden: ${escHtml(gigDate)}` : ''

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Factuur ${escHtml(invoiceNumber)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600"
               style="max-width:600px;background:#ffffff;border:1px solid #dddddd;">
          <tr>
            <td style="background:#1a1a2e;padding:24px 32px;">
              <p style="margin:0;font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${escHtml(bandName)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding-bottom:18px;font-size:15px;color:#333333;line-height:1.6;">${escHtml(greeting)}</td>
                </tr>
                <tr>
                  <td style="padding-bottom:18px;font-size:15px;color:#333333;line-height:1.7;">${personalHtml}</td>
                </tr>
                <tr>
                  <td style="padding-bottom:18px;">
                    <table cellpadding="0" cellspacing="0" border="0" width="100%"
                           style="background:#f8f8f8;border-left:4px solid #1a1a2e;padding:16px 20px;">
                      <tr>
                        <td>
                          <p style="margin:6px;font-size:12px;color:#888888;">Factuurnummer</p>
                          <p style="margin:6px;font-size:17px;font-weight:bold;color:#1a1a2e;">${escHtml(invoiceNumber)}</p>
                        </td>
                        ${issueDateCell}
                      </tr>
                    </table>
                  </td>
                </tr>
                ${paymentSectionHtml || ''}
                <tr>
                  <td style="padding-top:8px;padding-bottom:8px;font-size:15px;color:#333333;line-height:1.7;">
                    Mocht u vragen hebben omtrent deze factuur, neemt u dan gerust contact met ons op.
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:4px;font-size:15px;color:#333333;line-height:1.7;">Met vriendelijke groet,</td>
                </tr>
                <tr>
                  <td style="font-size:15px;font-weight:bold;color:#1a1a2e;line-height:1.7;">${escHtml(bandName)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#f8f8f8;padding:14px 32px;border-top:1px solid #dddddd;">
              <p style="margin:0;font-size:11px;color:#aaaaaa;">
                Factuur ${escHtml(invoiceNumber)}${footerGigPart} &nbsp;&middot;&nbsp; ${escHtml(bandName)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// RFC 5322 "specials" that force a display name to be quoted or MIME-encoded.
const HEADER_ADDR_SPECIALS_RE = /[()<>[\]:;@\\,."]/
// Conservative email check: no whitespace/control chars, a single @, a dotted domain.
const HEADER_EMAIL_RE = /^[^\s@<>]+@[^.\s@<>]+(?:\.[^.\s@<>]+)+$/

function stripHeaderControlChars(value) {
  // Drop CR, LF, and other C0 control chars so user fields can't inject headers.
  // eslint-disable-next-line no-control-regex -- matching control chars is the intent
  return String(value ?? '').replaceAll(/[\u0000-\u001f\u007f]/g, '').trim()
}

function encodeDisplayName(rawName) {
  const name = stripHeaderControlChars(rawName)
  if (!name) return ''
  const isAscii = /^[\u0020-\u007e]*$/.test(name)
  if (!isAscii) {
    return `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`
  }
  if (HEADER_ADDR_SPECIALS_RE.test(name)) {
    return `"${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  }
  return name
}

// Builds a safe RFC 5322 address for the To header, or '' when the email is
// missing/invalid. customer_name and customer_email are user-controlled invoice
// fields, so CR/LF are stripped and the email is validated before it reaches the
// raw header (the subject is already MIME encoded-word'd).
function formatHeaderAddress(name, email) {
  const cleanEmail = stripHeaderControlChars(email)
  if (!HEADER_EMAIL_RE.test(cleanEmail)) return ''
  const display = encodeDisplayName(name)
  return display ? `${display} <${cleanEmail}>` : cleanEmail
}

async function resolveEmlData(id, tenantId) {
  const { rows } = await pool.query(
    `SELECT i.*, g.event_date, g.event_description
       FROM invoices i
       LEFT JOIN gigs g ON g.id = i.gig_id AND g.tenant_id = i.tenant_id
      WHERE i.id = $1 AND i.tenant_id = $2`,
    [id, tenantId],
  )
  if (!rows.length) return null
  const invoice = rows[0]
  const tenant = await fetchTenant(pool, tenantId)
  if (!tenant) return null

  const fmtNl = (d) =>
    d ? new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  const gigDate   = fmtNl(invoice.event_date)
  const issueDate = fmtNl(invoice.issue_date)
  const bandName  = tenant.formal_name || tenant.band_name || ''
  const invoiceNumber = invoice.invoice_number || 'concept'

  const subjectDate = gigDate || issueDate || ''
  const subjectVenue = invoice.event_description ? ` – ${invoice.event_description}` : ''
  const subjectDateSuffix = subjectDate ? ` – ${subjectDate}` : ''
  const subject = `Factuur ${invoiceNumber} – ${bandName}${subjectDateSuffix}${subjectVenue}`

  const titlePart  = invoice.customer_contact_title ? `${invoice.customer_contact_title} ` : ''
  const familyName = invoice.customer_contact_family_name || ''
  const greeting   = familyName ? `Geachte ${titlePart}${familyName},` : 'Geachte heer/mevrouw,'

  const toAddress = formatHeaderAddress(invoice.customer_name, invoice.customer_email)

  return { invoice, tenant, bandName, invoiceNumber, gigDate, issueDate, subject, greeting, toAddress }
}

// Returns the pre-filled defaults for the email compose dialog.
router.get('/:id/eml-defaults', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const data = await resolveEmlData(id, req.tenantId)
  if (!data) return res.status(404).json({ error: 'Not found' })
  const { bandName, gigDate, subject, greeting, toAddress } = data
  res.json({
    subject,
    to: toAddress,
    greeting,
    personalMessage: defaultPersonalMessage(bandName, gigDate),
  })
})

// Generates and streams the .eml file.
// X-Unsent: 1 verified working in Outlook 1.2026.105.100 (WebView2 143).
router.post('/:id/eml', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const data = await resolveEmlData(id, req.tenantId)
  if (!data) return res.status(404).json({ error: 'Not found' })

  const { invoice, bandName, invoiceNumber, gigDate, issueDate, subject, greeting, toAddress } = data
  const personalMessage = String(req.body?.personalMessage || defaultPersonalMessage(bandName, gigDate)).slice(0, 4000)
  const safeNumber = invoiceNumber.replaceAll(/[^a-zA-Z0-9-]/g, '-')

  const hasPaymentLink = Boolean(invoice.mollie_payment_link_url)
  let qrBase64 = null
  if (hasPaymentLink) {
    try {
      const qrBuffer = await QRCode.toBuffer(invoice.mollie_payment_link_url, { type: 'png', width: 200, margin: 1 })
      qrBase64 = qrBuffer.toString('base64')
    } catch (err) {
      console.warn('[invoices/eml] QR generation failed:', err.message)
    }
  }

  const paymentSectionHtml = hasPaymentLink
    ? buildPaymentSectionHtml(invoice.mollie_payment_link_url, invoiceNumber, qrBase64)
    : ''

  const html = buildEmailHtml({ bandName, invoiceNumber, issueDate, gigDate, greeting, personalMessage, paymentSectionHtml })
  const htmlBase64 = Buffer.from(html, 'utf8').toString('base64')

  let pdfBase64 = null
  if (invoice.pdf_path) {
    try {
      const stream = await getObject(invoice.pdf_path)
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      pdfBase64 = Buffer.concat(chunks).toString('base64')
    } catch (err) {
      console.warn('[invoices/eml] PDF fetch failed:', err.message)
    }
  }

  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
  const dateHeader = new Date().toUTCString()
  const msgId = `<invoice-${id}-${Date.now()}@gigbuddy>`
  const ts = Date.now()
  const relatedBoundary = `----=_Related_GigBuddy_${ts}`
  const mixedBoundary   = `----=_Mixed_GigBuddy_${ts}`
  const pdfFilename = `factuur-${safeNumber}.pdf`

  const bodySection = qrBase64
    ? [
        `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
        '',
        `--${relatedBoundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64Lines(htmlBase64),
        '',
        `--${relatedBoundary}`,
        'Content-Type: image/png; name="qr-betaallink.png"',
        'Content-Transfer-Encoding: base64',
        'Content-ID: <qr-betaallink>',
        'Content-Disposition: inline; filename="qr-betaallink.png"',
        '',
        wrapBase64Lines(qrBase64),
        '',
        `--${relatedBoundary}--`,
      ].join('\r\n')
    : [
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64Lines(htmlBase64),
      ].join('\r\n')

  const outerHeaders = [
    'MIME-Version: 1.0',
    `Date: ${dateHeader}`,
    `Message-ID: ${msgId}`,
    'X-Unsent: 1',
    ...(toAddress ? [`To: ${toAddress}`] : []),
    `Subject: ${encodedSubject}`,
  ]

  let emlContent
  if (pdfBase64) {
    const pdfSection = [
      `Content-Type: application/pdf; name="${pdfFilename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${pdfFilename}"`,
      '',
      wrapBase64Lines(pdfBase64),
    ].join('\r\n')
    emlContent = [
      ...outerHeaders,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      `--${mixedBoundary}`,
      bodySection,
      '',
      `--${mixedBoundary}`,
      pdfSection,
      '',
      `--${mixedBoundary}--`,
    ].join('\r\n')
  } else {
    emlContent = [...outerHeaders, bodySection].join('\r\n')
  }

  res.setHeader('Content-Type', 'message/rfc822')
  res.setHeader('Content-Disposition', `attachment; filename="factuur-${safeNumber}.eml"`)
  res.send(emlContent)
})

export { syncInvoicePaymentStatus }
export default router
