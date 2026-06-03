// Invoice domain logic. Route handlers stay thin and delegate here.
//
// Functions return a discriminated result so the HTTP layer can map outcomes
// to status codes without knowing the rules:
//   { error: { status, body } }   — caller should respond with that status/body
//   anything else                 — success payload (see each function)
import { randomUUID } from 'node:crypto'
import { getObject, uploadObject, removeObject, safeRemove, invoicePdfKey } from './storageService.js'
import { computeInvoiceTotals } from '../utils/computeInvoiceTotals.js'
import { renderInvoicePdf } from '../utils/renderInvoicePdf.js'
import {
  createTenantMollieClient,
  formatMollieAmountFromCents,
} from '../utils/mollieClient.js'
import { sendPushToTenant } from '../utils/sendPush.js'
import {
  fetchTenant,
  fetchInvoice,
  fetchLines,
  replaceInvoiceLines,
  validateGigIdForTenant,
} from '../repositories/invoiceRepository.js'
import {
  SIMPLE_PATCH_FIELDS,
  CONTENT_FIELDS_SET,
  FINALIZED_LOCKED_FIELDS_SET,
  STATUS_VALUES,
  normalizeLines,
} from '../validators/invoiceValidators.js'

// ---------- totals ----------

export function computeAndApply(invoiceFields, lines, tenant) {
  return computeInvoiceTotals({
    lines,
    taxInclusive: invoiceFields.tax_inclusive,
    discountCents: invoiceFields.discount_cents,
    discountType: invoiceFields.discount_type,
    discountPct: invoiceFields.discount_pct,
    appliesKor: tenant.applies_kor,
  })
}

// ---------- PDF ----------

async function loadLogoBuffer(tenant, customLogoPath) {
  const key = customLogoPath || tenant.logo_path
  if (!key) return null
  try {
    const stream = await getObject(key)
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
  } catch (err) {
    console.warn('[invoices] failed to load logo:', err.message)
    return null
  }
}

export async function renderAndStorePdf(pool, invoiceId, tenantId) {
  const invoice = await fetchInvoice(pool, tenantId, invoiceId)
  if (!invoice) return null
  const tenant = await fetchTenant(pool, tenantId)
  const lines = await fetchLines(pool, invoiceId, tenantId)
  const logoBuffer = await loadLogoBuffer(tenant, invoice.custom_logo_path)

  const pdfBuffer = await renderInvoicePdf({ invoice, lines, tenant, logoBuffer })
  const previousKey = invoice.pdf_path
  const newKey = invoicePdfKey(tenantId, randomUUID())

  await uploadObject(newKey, pdfBuffer, pdfBuffer.length, 'application/pdf')

  try {
    await pool.query(
      'UPDATE invoices SET pdf_path = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
      [newKey, invoiceId, tenantId],
    )
  } catch (err) {
    removeObject(newKey).catch(() => {})
    throw err
  }

  safeRemove(previousKey !== newKey ? previousKey : null, '[invoices] failed to remove previous pdf:')

  return newKey
}

// ---------- patch ----------

// Accumulates SET clauses for the dynamic invoice UPDATE. Parameterised columns
// and raw SQL expressions (e.g. finalized_at = NOW()) are tracked separately so
// the final placeholder numbering stays correct.
function createUpdateBuilder() {
  const columns = []
  const rawExpressions = []
  return {
    set(column, value) { columns.push({ column, value }) },
    setRaw(expression) { rawExpressions.push(expression) },
    get size() { return columns.length + rawExpressions.length },
    build(invoiceId, tenantId) {
      const assignments = []
      const values = []
      let idx = 1
      for (const { column, value } of columns) {
        assignments.push(`${column} = $${idx++}`)
        values.push(value)
      }
      assignments.push(...rawExpressions, 'updated_at = NOW()')
      values.push(invoiceId, tenantId)
      return {
        sql: `UPDATE invoices SET ${assignments.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1}`,
        values,
      }
    },
  }
}

// Copies the straight-through columns into the update. discount_cents is
// deliberately NOT here: it is a derived column written only by recomputeTotals
// (the stored value is the *effective* discount), so assigning it here too would
// produce a duplicate column in the UPDATE. It still counts as a content field
// (see hasContentChange) so a discount_cents-only PATCH triggers a recompute.
function collectSimpleFields(body, builder) {
  for (const key of SIMPLE_PATCH_FIELDS) {
    if (key in body) builder.set(key, body[key])
  }
}

// True when the patch touches any field of the invoice content model (lines,
// discount inputs incl. discount_cents, customer fields, …) — i.e. anything
// that should re-derive totals and re-render the PDF.
function hasContentChange(body) {
  return Object.keys(body).some((key) => CONTENT_FIELDS_SET.has(key))
}

function applyStatusFields(body, existing, builder) {
  if (body.status === undefined) return
  builder.set('status', body.status)
  if (body.status !== 'draft' && existing.finalized_at === null) {
    builder.setRaw('finalized_at = NOW()')
  }
}

const FINALIZED_ERROR = { status: 409, body: { error: 'Invoice is finalized', code: 'invoice_finalized' } }

async function recomputeTotals(client, tenantId, invoiceId, body, tenant, requestedContentFields, builder) {
  const { rows: cur } = await client.query(
    'SELECT tax_inclusive, discount_type, discount_pct, discount_cents, finalized_at FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [invoiceId, tenantId],
  )
  // Re-check finalization under row lock: a concurrent payment-link creation may
  // have finalized the invoice between the initial read and here. Block only
  // when a finalized-locked field is in the body (memo/status stay allowed).
  if (cur[0].finalized_at !== null && requestedContentFields.length > 0) {
    return { error: FINALIZED_ERROR }
  }
  const current = cur[0]
  const taxInclusive = 'tax_inclusive' in body ? Boolean(body.tax_inclusive) : current.tax_inclusive
  const discountType = 'discount_type' in body ? normalizeDiscountType(body.discount_type) : current.discount_type
  const discountPct = 'discount_pct' in body ? clampNonNegative(body.discount_pct) : Number(current.discount_pct)
  const discountCents = 'discount_cents' in body ? clampNonNegative(body.discount_cents) : current.discount_cents
  const currentLines = await fetchLines(client, invoiceId, tenantId)
  const totals = computeAndApply(
    { tax_inclusive: taxInclusive, discount_type: discountType, discount_pct: discountPct, discount_cents: discountCents },
    currentLines,
    tenant,
  )
  builder.set('discount_cents', totals.discountCents)
  builder.set('subtotal_cents', totals.subtotalCents)
  builder.set('tax_cents', totals.taxCents)
  builder.set('total_cents', totals.totalCents)
  return null
}

function normalizeDiscountType(value) {
  return value === 'pct' ? 'pct' : 'eur'
}

function clampNonNegative(value) {
  return Math.max(0, Number(value) || 0)
}

async function runPatchTransaction({ pool, tenantId, invoiceId, body, existing, tenant, requestedContentFields }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const builder = createUpdateBuilder()
    collectSimpleFields(body, builder)
    const contentChanged = hasContentChange(body)

    if ('lines' in body) {
      const lines = normalizeLines(body.lines)
      if (!lines.length) {
        await client.query('ROLLBACK')
        return { error: { status: 400, body: { error: 'At least one line is required' } } }
      }
      await replaceInvoiceLines(client, invoiceId, tenantId, lines)
    }

    if (contentChanged) {
      const guard = await recomputeTotals(client, tenantId, invoiceId, body, tenant, requestedContentFields, builder)
      if (guard?.error) {
        await client.query('ROLLBACK')
        return guard
      }
    }

    applyStatusFields(body, existing, builder)

    if (builder.size === 0) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'No valid fields to update' } } }
    }

    const { sql, values } = builder.build(invoiceId, tenantId)
    await client.query(sql, values)
    await client.query('COMMIT')
    return { contentChanged }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

function validatePatchRequest(body, existing) {
  const requestedContentFields = Object.keys(body).filter((k) => FINALIZED_LOCKED_FIELDS_SET.has(k))
  if (existing.finalized_at !== null && requestedContentFields.length > 0) {
    return { error: FINALIZED_ERROR }
  }
  if (body.status !== undefined && !STATUS_VALUES.has(body.status)) {
    return { error: { status: 400, body: { error: 'Invalid status' } } }
  }
  return { requestedContentFields }
}

// Validates and applies a PATCH. Returns { error } or { contentChanged }.
export async function applyInvoicePatch(pool, tenantId, invoiceId, body) {
  const existing = await fetchInvoice(pool, tenantId, invoiceId)
  if (!existing) return { error: { status: 404, body: { error: 'Not found' } } }

  const validation = validatePatchRequest(body, existing)
  if (validation.error) return validation

  // Normalize gig_id into a copy so the caller's request body stays immutable.
  let patch = body
  if (body.gig_id !== undefined && body.gig_id !== null) {
    const gigId = await validateGigIdForTenant(pool, body.gig_id, tenantId)
    if (gigId === null) return { error: { status: 400, body: { error: 'Invalid gig_id' } } }
    patch = { ...body, gig_id: gigId }
  }

  const tenant = await fetchTenant(pool, tenantId)
  return runPatchTransaction({
    pool, tenantId, invoiceId, body: patch, existing, tenant,
    requestedContentFields: validation.requestedContentFields,
  })
}

// ---------- payment links ----------

export function isMollieWebhookDisabled() {
  return process.env.MOLLIE_DISABLE_WEBHOOK === 'true'
}

// Locks the invoice, validates it can take a payment link, and finalizes it
// (draft -> sent, sets finalized_at) BEFORE any external Mollie call. Returns
// { error } | { alreadyLinked: invoice } | { invoice: finalizedInvoice }.
export async function finalizeInvoiceForPaymentLink(pool, tenantId, invoiceId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [invoiceId, tenantId],
    )
    if (!locked.rows.length) {
      await client.query('ROLLBACK')
      return { error: { status: 404, body: { error: 'Not found' } } }
    }
    const current = locked.rows[0]
    if (current.status === 'void') {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'void_invoice' } } }
    }
    if (current.total_cents <= 0) {
      await client.query('ROLLBACK')
      return { error: { status: 400, body: { error: 'zero_amount' } } }
    }
    if (current.mollie_payment_link_id) {
      await client.query('ROLLBACK')
      return { alreadyLinked: current }
    }
    const finalized = await client.query(
      `UPDATE invoices
          SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
              finalized_at = COALESCE(finalized_at, NOW()),
              updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
      [invoiceId, tenantId],
    )
    await client.query('COMMIT')
    return { invoice: finalized.rows[0] }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

function buildPaymentLinkPayload({ tenant, invoice, invoiceId, opts }) {
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
  const webhookBase = (process.env.MOLLIE_WEBHOOK_BASE_URL || appUrl).replace(/\/$/, '')
  const tenantLabel = (tenant.band_name || tenant.formal_name || '').trim()
  const description = tenantLabel
    ? `Invoice ${invoice.invoice_number} - ${tenantLabel}`
    : `Invoice ${invoice.invoice_number}`

  const redirectQuery = new URLSearchParams({ invoice: String(invoiceId) })
  if (tenantLabel) redirectQuery.set('band', tenantLabel)

  const payload = {
    amount: { currency: 'EUR', value: formatMollieAmountFromCents(invoice.total_cents) },
    description,
    redirectUrl: `${appUrl}/payment/thanks?${redirectQuery.toString()}`,
    reusable: false,
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    ...(opts.allowedMethods ? { allowedMethods: opts.allowedMethods } : {}),
  }
  if (!isMollieWebhookDisabled()) {
    payload.webhookUrl = `${webhookBase}/api/public/mollie/payment-links/webhook?invoice=${invoiceId}`
  }
  return payload
}

// Creates the Mollie payment link and stores it on the invoice with an atomic
// guard against concurrent creation. Returns { error } | { invoice }.
export async function createMolliePaymentLink({ pool, tenant, invoice, tenantId, invoiceId, opts }) {
  const mollie = createTenantMollieClient(tenant.mollie_api_key)
  const payload = buildPaymentLinkPayload({ tenant, invoice, invoiceId, opts })
  const paymentLink = await mollie.paymentLinks.create(payload)

  const checkoutUrl = paymentLink._links?.paymentLink?.href
  if (!checkoutUrl) return { error: { status: 502, body: { error: 'mollie_payment_link_url_missing' } } }

  // Atomic update guard: only write if no other concurrent request beat us to
  // it. A link orphaned by losing this race carries no charge until used.
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
    [paymentLink.id, checkoutUrl, opts.expiresAt ?? null, invoiceId, tenantId],
  )

  if (updateResult.rowCount === 0) {
    return { invoice: await fetchInvoice(pool, tenantId, invoiceId) }
  }
  return { invoice: updateResult.rows[0] }
}

// In @mollie/api-client v4.3+ payments-under-a-link is a helper iterator on the
// PaymentLink object, not a method on the paymentLinks binder. The API returns
// newest-first, so the first item is the latest payment.
async function getLatestPayment(paymentLink) {
  const iterator = paymentLink.getPayments().take(1)[Symbol.asyncIterator]()
  const { value, done } = await iterator.next()
  return done ? null : value
}

// Shared payment-status update logic used by both the sync endpoint and the
// webhook. Authoritative payment state always comes from re-fetching the
// payment link from Mollie with the tenant's secret key — never from the
// caller. The webhook body's payment id is only a "go check now" hint and is
// intentionally NOT used as a gate: a caller who guesses an invoice id cannot
// forge a paid status, because paid/open is read from Mollie, not the request.
// (An earlier review-#4 guard matched the posted id against the link's single
// latest payment; that wrongly blocked legitimate webhooks whenever a link had
// more than one payment attempt, so it was removed.)
export async function syncInvoicePaymentStatus(mollie, db, invoice) {
  const paymentLink = await mollie.paymentLinks.get(invoice.mollie_payment_link_id)
  const latestPayment = await getLatestPayment(paymentLink)

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

// Fire-and-forget push to all approved members of the invoice's tenant that an
// invoice was paid. Mirrors the notify* helpers in gigService.js: the caller
// owns the "should we notify?" decision; this owns payload + dispatch + logging.
export function notifyInvoicePaid(tenantId, invoice) {
  const amount = `€${((invoice.total_cents ?? 0) / 100).toFixed(2)}`
  sendPushToTenant(tenantId, {
    title: 'Invoice paid',
    body: [invoice.invoice_number, invoice.customer_name, amount]
      .filter(Boolean).join(' · '),
    tag: 'invoice-paid',
    url: `/invoices/${invoice.id}`,
  }).catch((err) => console.error('[push] invoice paid notify failed', err))
}
