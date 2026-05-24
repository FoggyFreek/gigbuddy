import { randomUUID } from 'crypto'
import path from 'path'
import { Router } from 'express'
import multer from 'multer'
import QRCode from 'qrcode'
import pool from '../db/index.js'
import { storageClient, BUCKET } from '../utils/storage.js'
import { validateAndReencodeImage } from '../utils/imageProcess.js'
import { computeInvoiceTotals } from '../utils/computeInvoiceTotals.js'
import { renderInvoicePdf } from '../utils/renderInvoicePdf.js'
import {
  assertMollieConfigured,
  createTenantMollieClient,
  formatMollieAmountFromCents,
} from '../utils/mollieClient.js'

const router = Router()

const LOGO_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
})

const CONTENT_FIELDS = [
  'gig_id',
  'issue_date',
  'due_date',
  'payment_term_days',
  'customer_name',
  'customer_contact_title',
  'customer_contact_given_name',
  'customer_contact_family_name',
  'customer_address_street',
  'customer_address_postal_code',
  'customer_address_city',
  'customer_address_country',
  'customer_email',
  'customer_kvk',
  'customer_tax_id',
  'memo',
  'tax_inclusive',
  'discount_type',
  'discount_pct',
  'discount_cents',
  'invert_logo',
  'lines',
]
const CONTENT_FIELDS_SET = new Set(CONTENT_FIELDS)
const FINALIZED_LOCKED_FIELDS_SET = new Set(CONTENT_FIELDS.filter((field) => field !== 'memo'))
const STATUS_VALUES = new Set(['draft', 'sent', 'paid', 'void'])
const PAYMENT_TERM_DAYS = new Set([7, 14, 30, 60])

function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

function requireId(req, res) {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' })
    return null
  }
  return id
}

function pad4(n) { return String(n).padStart(4, '0') }

async function nextInvoiceNumber(executor, tenantId, year) {
  const { rows } = await executor.query(
    `INSERT INTO invoice_number_sequences (tenant_id, year, next_seq)
     VALUES ($1, $2, 2)
     ON CONFLICT (tenant_id, year)
     DO UPDATE SET next_seq = invoice_number_sequences.next_seq + 1
     RETURNING next_seq - 1 AS seq`,
    [tenantId, year],
  )
  return `${year}-${pad4(rows[0].seq)}`
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return []
  return lines.map((raw, idx) => ({
    description: String(raw.description ?? '').trim(),
    quantity: Number.isFinite(Number(raw.quantity)) ? Number(raw.quantity) : 1,
    unit_price_cents: Number.isInteger(Number(raw.unit_price_cents)) ? Number(raw.unit_price_cents) : 0,
    tax_percentage: Number.isFinite(Number(raw.tax_percentage)) ? Number(raw.tax_percentage) : 0,
    position: Number.isInteger(Number(raw.position)) ? Number(raw.position) : idx,
  }))
}

async function fetchTenant(executor, tenantId) {
  const { rows } = await executor.query('SELECT * FROM tenants WHERE id = $1', [tenantId])
  return rows[0] || null
}

async function fetchLines(executor, invoiceId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, description, quantity, unit_price_cents, tax_percentage, position
       FROM invoice_lines
      WHERE invoice_id = $1 AND tenant_id = $2
      ORDER BY position ASC, id ASC`,
    [invoiceId, tenantId],
  )
  return rows
}

async function validateGigIdForTenant(executor, rawGigId, tenantId) {
  const parsed = parseId(rawGigId)
  if (parsed === null) return null
  const { rowCount } = await executor.query(
    'SELECT 1 FROM gigs WHERE id = $1 AND tenant_id = $2',
    [parsed, tenantId],
  )
  return rowCount ? parsed : null
}

async function insertInvoiceLines(executor, invoiceId, tenantId, lines) {
  for (const line of lines) {
    await executor.query(
      `INSERT INTO invoice_lines (invoice_id, tenant_id, position, description, quantity, unit_price_cents, tax_percentage)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invoiceId, tenantId, line.position, line.description, line.quantity, line.unit_price_cents, line.tax_percentage],
    )
  }
}

async function loadLogoBuffer(tenant, customLogoPath) {
  const key = customLogoPath || tenant.logo_path
  if (!key) return null
  try {
    const stream = await storageClient.getObject(BUCKET, key)
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
  } catch (err) {
    console.warn('[invoices] failed to load logo:', err.message)
    return null
  }
}

async function renderAndStorePdf(invoiceId, tenantId) {
  const { rows } = await pool.query(
    'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2',
    [invoiceId, tenantId],
  )
  if (!rows.length) return null
  const invoice = rows[0]
  const tenant = await fetchTenant(pool, tenantId)
  const lines = await fetchLines(pool, invoiceId, tenantId)
  const logoBuffer = await loadLogoBuffer(tenant, invoice.custom_logo_path)

  const pdfBuffer = await renderInvoicePdf({ invoice, lines, tenant, logoBuffer })
  const previousKey = invoice.pdf_path
  const newKey = `tenants/${tenantId}/invoices/${randomUUID()}.pdf`

  await storageClient.putObject(BUCKET, newKey, pdfBuffer, pdfBuffer.length, {
    'Content-Type': 'application/pdf',
  })

  try {
    await pool.query(
      'UPDATE invoices SET pdf_path = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
      [newKey, invoiceId, tenantId],
    )
  } catch (err) {
    storageClient.removeObject(BUCKET, newKey).catch(() => {})
    throw err
  }

  if (previousKey && previousKey !== newKey) {
    storageClient.removeObject(BUCKET, previousKey).catch((e) =>
      console.warn('[invoices] failed to remove previous pdf:', e.message),
    )
  }

  return newKey
}

function computeAndApply(invoiceFields, lines, tenant) {
  return computeInvoiceTotals({
    lines,
    taxInclusive: invoiceFields.tax_inclusive,
    discountCents: invoiceFields.discount_cents,
    discountType: invoiceFields.discount_type,
    discountPct: invoiceFields.discount_pct,
    appliesKor: tenant.applies_kor,
  })
}

function computeDueDate(issueDate, paymentTermDays) {
  if (!issueDate || !paymentTermDays) return null
  const d = issueDate instanceof Date ? new Date(issueDate.getTime()) : new Date(issueDate)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + paymentTermDays)
  return d.toISOString().slice(0, 10)
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
  if (festival) {
    billingTargets.push({
      type: 'festival',
      id: festival.id,
      name: festival.organization_name || festival.name,
      contact_title: festival.title || null,
      contact_given_name: festival.given_name || null,
      contact_family_name: festival.family_name || null,
      address_street: festival.street_and_number || null,
      address_postal_code: festival.postal_code || null,
      address_city: festival.city || null,
      address_country: festival.country || null,
      email: festival.email || null,
    })
  }
  if (venue) {
    billingTargets.push({
      type: 'venue',
      id: venue.id,
      name: venue.organization_name || venue.name,
      contact_title: venue.title || null,
      contact_given_name: venue.given_name || null,
      contact_family_name: venue.family_name || null,
      address_street: venue.street_and_number || null,
      address_postal_code: venue.postal_code || null,
      address_city: venue.city || null,
      address_country: venue.country || null,
      email: venue.email || null,
    })
  }

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
  const { rows } = await pool.query(
    'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  const lines = await fetchLines(pool, id, req.tenantId)
  const tenant = await fetchTenant(pool, req.tenantId)
  const { mollie_api_key: _omit, ...safeTenant } = tenant || {}
  res.json({ ...rows[0], lines, tenant: safeTenant })
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
    await renderAndStorePdf(invoiceId, req.tenantId)
  } catch (err) {
    console.error('[invoices] PDF render failed (row persisted, retry via POST /:id/render):', err)
  }

  const { rows: created } = await pool.query(
    'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2',
    [invoiceId, req.tenantId],
  )
  const createdLines = await fetchLines(pool, invoiceId, req.tenantId)
  res.status(201).json({ ...created[0], lines: createdLines })
})

// ---------- patch ----------
router.patch('/:id', async (req, res) => {
  const id = requireId(req, res); if (id === null) return
  const body = req.body || {}

  const { rows: existingRows } = await pool.query(
    'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!existingRows.length) return res.status(404).json({ error: 'Not found' })
  const existing = existingRows[0]
  const isFinalized = existing.finalized_at !== null

  const requestedContentFields = Object.keys(body).filter((k) => FINALIZED_LOCKED_FIELDS_SET.has(k))
  if (isFinalized && requestedContentFields.length > 0) {
    return res.status(409).json({ error: 'Invoice is finalized', code: 'invoice_finalized' })
  }

  if (body.status !== undefined && !STATUS_VALUES.has(body.status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }
  if (body.gig_id !== undefined && body.gig_id !== null) {
    const gigId = await validateGigIdForTenant(pool, body.gig_id, req.tenantId)
    if (gigId === null) return res.status(400).json({ error: 'Invalid gig_id' })
    body.gig_id = gigId
  }

  const tenant = await fetchTenant(pool, req.tenantId)

  const client = await pool.connect()
  let contentChanged = false
  try {
    await client.query('BEGIN')

    const updates = []
    const values = []
    let idx = 1

    const simpleFields = [
      'gig_id', 'issue_date', 'due_date', 'payment_term_days',
      'customer_name', 'customer_contact_title', 'customer_contact_given_name', 'customer_contact_family_name',
      'customer_address_street', 'customer_address_postal_code',
      'customer_address_city', 'customer_address_country', 'customer_email',
      'customer_kvk', 'customer_tax_id', 'memo', 'tax_inclusive',
      'discount_type', 'discount_pct', 'invert_logo',
    ]
    for (const key of simpleFields) {
      if (key in body) {
        updates.push(`${key} = $${idx++}`)
        values.push(body[key])
        if (CONTENT_FIELDS_SET.has(key)) contentChanged = true
      }
    }

    if ('lines' in body) {
      contentChanged = true
      const lines = normalizeLines(body.lines)
      if (!lines.length) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'At least one line is required' })
      }
      await client.query(
        'DELETE FROM invoice_lines WHERE invoice_id = $1 AND tenant_id = $2',
        [id, req.tenantId],
      )
      await insertInvoiceLines(client, id, req.tenantId, lines)
    }

    if (contentChanged) {
      const { rows: cur } = await client.query(
        'SELECT tax_inclusive, discount_type, discount_pct, discount_cents, finalized_at FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [id, req.tenantId],
      )
      // Re-check finalization under row lock: a concurrent payment-link
      // creation may have finalized the invoice between the non-locking read
      // above (line ~461) and this point. Without this gate, the PATCH would
      // mutate content (e.g. line items, total_cents) on an invoice whose
      // Mollie payment link is already committed to the original amount.
      // Mirror the pre-tx gate's field set: memo and status are allowed
      // post-finalization, so only block when a FINALIZED_LOCKED field is in
      // the request body.
      if (cur[0].finalized_at !== null && requestedContentFields.length > 0) {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: 'Invoice is finalized', code: 'invoice_finalized' })
      }
      const taxInclusive = 'tax_inclusive' in body ? Boolean(body.tax_inclusive) : cur[0].tax_inclusive
      const discountType = 'discount_type' in body ? (body.discount_type === 'pct' ? 'pct' : 'eur') : cur[0].discount_type
      const discountPct = 'discount_pct' in body ? Math.max(0, Number(body.discount_pct) || 0) : Number(cur[0].discount_pct)
      const discountCents = 'discount_cents' in body ? Math.max(0, Number(body.discount_cents) || 0) : cur[0].discount_cents
      const currentLines = await fetchLines(client, id, req.tenantId)
      const totals = computeAndApply({ tax_inclusive: taxInclusive, discount_type: discountType, discount_pct: discountPct, discount_cents: discountCents }, currentLines, tenant)
      updates.push(`discount_cents = $${idx++}`); values.push(totals.discountCents)
      updates.push(`subtotal_cents = $${idx++}`); values.push(totals.subtotalCents)
      updates.push(`tax_cents = $${idx++}`); values.push(totals.taxCents)
      updates.push(`total_cents = $${idx++}`); values.push(totals.totalCents)
    }

    if (body.status !== undefined) {
      updates.push(`status = $${idx++}`); values.push(body.status)
      if (body.status !== 'draft' && existing.finalized_at === null) {
        updates.push(`finalized_at = NOW()`)
      }
    }

    if (!updates.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    updates.push(`updated_at = NOW()`)
    values.push(id, req.tenantId)
    await client.query(
      `UPDATE invoices SET ${updates.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1}`,
      values,
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  if (contentChanged) {
    try {
      await renderAndStorePdf(id, req.tenantId)
    } catch (err) {
      console.error('[invoices] PDF re-render failed:', err)
    }
  }

  const { rows: updated } = await pool.query(
    'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  const lines = await fetchLines(pool, id, req.tenantId)
  res.json({ ...updated[0], lines })
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
  if (rows[0].pdf_path) {
    storageClient.removeObject(BUCKET, rows[0].pdf_path).catch(() => {})
  }
  if (rows[0].custom_logo_path) {
    storageClient.removeObject(BUCKET, rows[0].custom_logo_path).catch(() => {})
  }
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
  await renderAndStorePdf(id, req.tenantId)
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
  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg'
  const objectKey = `tenants/${req.tenantId}/invoices/logo-${randomUUID()}${ext}`

  await storageClient.putObject(BUCKET, objectKey, image.buffer, image.size, {
    'Content-Type': image.mimetype,
  })

  try {
    await pool.query(
      'UPDATE invoices SET custom_logo_path = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
      [objectKey, id, req.tenantId],
    )
  } catch (err) {
    storageClient.removeObject(BUCKET, objectKey).catch(() => {})
    throw err
  }

  if (oldKey) {
    storageClient.removeObject(BUCKET, oldKey).catch((e) =>
      console.warn('[invoices] failed to delete old custom logo:', e.message),
    )
  }

  try {
    await renderAndStorePdf(id, req.tenantId)
  } catch (err) {
    console.error('[invoices] PDF re-render after logo upload failed:', err)
  }

  res.json({ custom_logo_path: objectKey })
})

// Mollie payment methods we explicitly accept; restricting up front gives a
// clearer error than a generic Mollie API error and prevents typos from
// silently being forwarded.
const SUPPORTED_PAYMENT_METHODS = new Set([
  'applepay', 'bancontact', 'banktransfer', 'belfius', 'creditcard',
  'eps', 'ideal', 'kbc', 'paypal', 'paysafecard', 'przelewy24',
])

function validatePaymentLinkOptions(body) {
  const result = { expiresAt: undefined, allowedMethods: undefined }

  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== 'string') {
      return { error: 'invalid_expires_at' }
    }
    const ts = Date.parse(body.expiresAt)
    if (Number.isNaN(ts)) return { error: 'invalid_expires_at' }
    if (ts <= Date.now()) return { error: 'expires_at_in_past' }
    result.expiresAt = body.expiresAt
  }

  if (body.allowedMethods !== undefined && body.allowedMethods !== null) {
    if (!Array.isArray(body.allowedMethods)) {
      return { error: 'invalid_allowed_methods' }
    }
    if (body.allowedMethods.length) {
      for (const m of body.allowedMethods) {
        if (typeof m !== 'string' || !SUPPORTED_PAYMENT_METHODS.has(m)) {
          return { error: 'unsupported_payment_method' }
        }
      }
      result.allowedMethods = body.allowedMethods
    }
  }

  return result
}

function isMollieWebhookDisabled() {
  return process.env.MOLLIE_DISABLE_WEBHOOK === 'true'
}

// ---------- payment link ----------
router.post('/:id/payment-link', async (req, res) => {
  const id = requireId(req, res); if (id === null) return

  const opts = validatePaymentLinkOptions(req.body || {})
  if (opts.error) return res.status(400).json({ error: opts.error })

  // Step 1: lock the invoice row, validate, and finalize (status='sent' if
  // draft, set finalized_at) BEFORE calling Mollie. Committing finalization
  // first means a concurrent PATCH that re-checks finalized_at under its own
  // row lock will 409 instead of mutating content (e.g. line totals) that
  // Mollie's amount is already pinned to.
  let invoice
  let alreadyLinkedResponse = null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [id, req.tenantId],
    )
    if (!locked.rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Not found' })
    }
    const current = locked.rows[0]
    if (current.status === 'void') {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'void_invoice' })
    }
    if (current.total_cents <= 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'zero_amount' })
    }

    if (current.mollie_payment_link_id) {
      // Sequential case — link already exists. Return the row as-is.
      await client.query('ROLLBACK')
      alreadyLinkedResponse = current
    } else {
      const finalized = await client.query(
        `UPDATE invoices
            SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
                finalized_at = COALESCE(finalized_at, NOW()),
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
        [id, req.tenantId],
      )
      invoice = finalized.rows[0]
      await client.query('COMMIT')
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  if (alreadyLinkedResponse) {
    const lines = await fetchLines(pool, id, req.tenantId)
    const tenant = await fetchTenant(pool, req.tenantId)
    const { mollie_api_key: _omit, ...safeTenant } = tenant || {}
    return res.json({ ...alreadyLinkedResponse, lines, tenant: safeTenant })
  }

  const tenant = await fetchTenant(pool, req.tenantId)
  assertMollieConfigured(tenant)

  const mollie = createTenantMollieClient(tenant.mollie_api_key)
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
  const webhookBase = (process.env.MOLLIE_WEBHOOK_BASE_URL || appUrl).replace(/\/$/, '')

  const tenantLabel = (tenant.band_name || tenant.formal_name || '').trim()
  const description = tenantLabel
    ? `Invoice ${invoice.invoice_number} - ${tenantLabel}`
    : `Invoice ${invoice.invoice_number}`

  const redirectQuery = new URLSearchParams({ invoice: String(id) })
  if (tenantLabel) redirectQuery.set('band', tenantLabel)

  const paymentLinkPayload = {
    amount: { currency: 'EUR', value: formatMollieAmountFromCents(invoice.total_cents) },
    description,
    redirectUrl: `${appUrl}/payment/thanks?${redirectQuery.toString()}`,
    reusable: false,
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    ...(opts.allowedMethods ? { allowedMethods: opts.allowedMethods } : {}),
  }

  if (!isMollieWebhookDisabled()) {
    paymentLinkPayload.webhookUrl = `${webhookBase}/api/public/mollie/payment-links/webhook?invoice=${id}`
  }

  const paymentLink = await mollie.paymentLinks.create(paymentLinkPayload)

  const checkoutUrl = paymentLink._links?.paymentLink?.href
  if (!checkoutUrl) {
    return res.status(502).json({ error: 'mollie_payment_link_url_missing' })
  }

  // Atomic update guard: only write if no other concurrent request beat us to it.
  // If a concurrent request stored its own link first, the Mollie link we just
  // created is orphaned — acceptable in the rare race window because Mollie
  // payment links carry no charge until used.
  const updateResult = await pool.query(
    `UPDATE invoices
        SET mollie_payment_link_id = $1,
            mollie_payment_link_url = $2,
            mollie_payment_link_created_at = NOW(),
            mollie_payment_link_expires_at = $3,
            mollie_payment_status = 'open',
            updated_at = NOW()
      WHERE id = $4 AND tenant_id = $5
        AND mollie_payment_link_id IS NULL
    RETURNING *`,
    [paymentLink.id, checkoutUrl, opts.expiresAt ?? null, id, req.tenantId],
  )

  let finalInvoice
  if (updateResult.rowCount === 0) {
    const { rows: refreshed } = await pool.query(
      'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2',
      [id, req.tenantId],
    )
    finalInvoice = refreshed[0]
  } else {
    finalInvoice = updateResult.rows[0]
  }

  // Re-render the PDF so it includes the QR code. Await so the response
  // carries the freshly-rendered pdf_path — renderAndStorePdf deletes the
  // previous PDF, so returning the stale key would 404 on download.
  try {
    await renderAndStorePdf(id, req.tenantId)
    const { rows: refreshed } = await pool.query(
      'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2',
      [id, req.tenantId],
    )
    if (refreshed.length) finalInvoice = refreshed[0]
  } catch (err) {
    console.error('[invoices] PDF re-render after payment-link creation failed:', err)
  }

  const lines = await fetchLines(pool, id, req.tenantId)
  const { mollie_api_key: _omit, ...safeTenant } = tenant || {}
  res.status(201).json({ ...finalInvoice, lines, tenant: safeTenant })
})

// ---------- payment link sync ----------
router.post('/:id/payment-link/sync', async (req, res) => {
  const id = requireId(req, res); if (id === null) return

  const { rows } = await pool.query(
    'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows.length) return res.status(404).json({ error: 'Not found' })
  const invoice = rows[0]

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
  if (oldKey) {
    storageClient.removeObject(BUCKET, oldKey).catch(() => {})
  }
  try {
    await renderAndStorePdf(id, req.tenantId)
  } catch (err) {
    console.error('[invoices] PDF re-render after logo remove failed:', err)
  }
  res.status(204).end()
})

// ---------- email (.eml) ----------

function escHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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
  return `Hartelijk dank voor de prettige samenwerking${gigPart}.\n\nIn de bijlage vindt u onze factuur met de bijbehorende specificaties.`
}

function buildEmailHtml({ bandName, invoiceNumber, issueDate, gigDate, greeting, personalMessage, paymentSectionHtml }) {
  const personalHtml = escHtml(personalMessage).replace(/\n/g, '<br>')
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
                          <p style="margin:0 0 2px 0;font-size:12px;color:#888888;">Factuurnummer</p>
                          <p style="margin:0;font-size:17px;font-weight:bold;color:#1a1a2e;">${escHtml(invoiceNumber)}</p>
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
  const subject = `Factuur ${invoiceNumber} – ${bandName}${subjectDate ? ` – ${subjectDate}` : ''}`

  const titlePart  = invoice.customer_contact_title ? `${invoice.customer_contact_title} ` : ''
  const familyName = invoice.customer_contact_family_name || ''
  const greeting   = familyName ? `Geachte ${titlePart}${familyName},` : 'Geachte heer/mevrouw,'

  const toAddress = invoice.customer_email
    ? invoice.customer_name
      ? `${invoice.customer_name} <${invoice.customer_email}>`
      : invoice.customer_email
    : ''

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
  const safeNumber = invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '-')

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
      const stream = await storageClient.getObject(BUCKET, invoice.pdf_path)
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

// Shared payment-status update logic used by both the sync endpoint and the webhook.
// Fetches current payment link state from Mollie, then checks the most recent payment.
//
// `expectedPaymentId` — when called from the webhook, this is the id Mollie posted.
// We refuse to mutate state unless the posted id matches the payment Mollie actually
// reports under the link, so callers who guess invoice ids can't even trigger a status
// flip with a random payment id.
// In @mollie/api-client v4.3+ payments-under-a-link is a helper iterator on
// the PaymentLink object, not a method on the paymentLinks binder. The API
// returns newest-first, so the first item is the latest payment.
async function getLatestPayment(paymentLink) {
  const iterator = paymentLink.getPayments().take(1)[Symbol.asyncIterator]()
  const { value, done } = await iterator.next()
  return done ? null : value
}

export async function syncInvoicePaymentStatus(mollie, db, invoice, expectedPaymentId = null) {
  const paymentLink = await mollie.paymentLinks.get(invoice.mollie_payment_link_id)

  const latestPayment = await getLatestPayment(paymentLink)

  if (expectedPaymentId && (!latestPayment || latestPayment.id !== expectedPaymentId)) {
    return invoice
  }

  let mollieStatus = paymentLink.status ?? 'open'
  let paymentId = invoice.mollie_payment_id
  let paidAt = invoice.mollie_paid_at
  let invoiceStatus = invoice.status

  if (latestPayment) {
    mollieStatus = latestPayment.status
    paymentId = latestPayment.id
    if (latestPayment.status === 'paid') {
      paidAt = latestPayment.paidAt ? new Date(latestPayment.paidAt) : new Date()
      if (invoice.status !== 'void') invoiceStatus = 'paid'
    }
  }

  const { rows } = await db.query(
    `UPDATE invoices
        SET mollie_payment_status = $1,
            mollie_payment_id     = $2,
            mollie_paid_at        = $3,
            status                = $4,
            updated_at            = NOW()
      WHERE id = $5 AND tenant_id = $6
      RETURNING *`,
    [mollieStatus, paymentId, paidAt, invoiceStatus, invoice.id, invoice.tenant_id],
  )
  return rows[0]
}

export default router
