import { randomUUID } from 'crypto'
import path from 'path'
import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { storageClient, BUCKET } from '../utils/storage.js'
import { validateAndReencodeImage } from '../utils/imageProcess.js'
import { computeInvoiceTotals } from '../utils/computeInvoiceTotals.js'
import { renderInvoicePdf } from '../utils/renderInvoicePdf.js'

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
  'customer_address_street',
  'customer_address_postal_code',
  'customer_address_city',
  'customer_address_country',
  'customer_email',
  'customer_kvk',
  'customer_tax_id',
  'memo',
  'tax_inclusive',
  'discount_cents',
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
  res.json({ ...rows[0], lines })
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
  const discountCents = Math.max(0, Number.isInteger(Number(body.discount_cents)) ? Number(body.discount_cents) : 0)
  const lines = normalizeLines(body.lines)
  if (!lines.length) return res.status(400).json({ error: 'At least one line is required' })

  const tenant = await fetchTenant(pool, req.tenantId)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

  const totals = computeAndApply({ tax_inclusive: taxInclusive, discount_cents: discountCents }, lines, tenant)
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
        customer_name, customer_address_street, customer_address_postal_code,
        customer_address_city, customer_address_country, customer_email,
        customer_kvk, customer_tax_id, memo, tax_inclusive, discount_cents,
        subtotal_cents, tax_cents, total_cents
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20
      ) RETURNING id`
    const { rows } = await client.query(insertSql, [
      req.tenantId, gigId, invoiceNumber, issueDate, dueDate, paymentTermDays,
      customerName, body.customer_address_street || null, body.customer_address_postal_code || null,
      body.customer_address_city || null, body.customer_address_country || null, body.customer_email || null,
      body.customer_kvk || null, body.customer_tax_id || null, body.memo || null, taxInclusive, discountCents,
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
      'customer_name', 'customer_address_street', 'customer_address_postal_code',
      'customer_address_city', 'customer_address_country', 'customer_email',
      'customer_kvk', 'customer_tax_id', 'memo', 'tax_inclusive', 'discount_cents',
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
        'SELECT tax_inclusive, discount_cents FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [id, req.tenantId],
      )
      const taxInclusive = 'tax_inclusive' in body ? Boolean(body.tax_inclusive) : cur[0].tax_inclusive
      const discountCents = 'discount_cents' in body ? Math.max(0, Number(body.discount_cents) || 0) : cur[0].discount_cents
      const currentLines = await fetchLines(client, id, req.tenantId)
      const totals = computeAndApply({ tax_inclusive: taxInclusive, discount_cents: discountCents }, currentLines, tenant)
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

export default router
