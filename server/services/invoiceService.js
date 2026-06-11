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
  assertMollieConfigured,
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
import {
  ledgerErrorResult,
  assertInvoiceVoidPostable,
  postInvoiceSent,
  postInvoicePaid,
  postInvoiceVoid,
  ACCOUNTING_SETTINGS_LOCK_NAMESPACE,
} from './ledgerService.js'

// Holds a session-level per-tenant accounting-settings advisory lock for the
// duration of `fn`, which receives the lock-holding client. Session and
// transaction advisory locks share a lock space, so the settings PATCH (which
// takes pg_advisory_xact_lock on the same key) blocks until fn completes.
// IMPORTANT: any work inside fn that itself takes the xact lock (e.g. anything
// calling loadAccountingSettings) must run on the provided client — advisory
// locks are re-entrant within a session but deadlock across connections.
async function withAccountingSettingsSessionLock(pool, tenantId, fn) {
  const client = await pool.connect()
  let releaseError = null
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [ACCOUNTING_SETTINGS_LOCK_NAMESPACE, tenantId])
    return await fn(client)
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [ACCOUNTING_SETTINGS_LOCK_NAMESPACE, tenantId])
    } catch (err) {
      releaseError = err
      console.error('[invoices] failed to release accounting-settings advisory lock:', err)
    }
    client.release(releaseError)
  }
}

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

// `client` is optional: when provided (the void flow's lock-holding session),
// the transaction runs on it and the caller keeps ownership of the connection.
async function runPatchTransaction({ pool, client: providedClient, tenantId, invoiceId, body, existing, tenant, requestedContentFields, actorUserId }) {
  const client = providedClient ?? await pool.connect()
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

    if (body.status !== undefined) {
      await postInvoiceTransition(client, tenantId, invoiceId, existing.status, body.status, actorUserId)
    }

    await client.query('COMMIT')
    return { contentChanged }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped) return mapped
    throw err
  } finally {
    if (!providedClient) client.release()
  }
}

const CANNOT_VOID_PAID_ERROR = {
  status: 409,
  body: { error: 'Cannot void a paid invoice', code: 'cannot_void_paid_invoice' },
}

// Forward-only status machine. A posted journal can never be left dangling by a
// regression: once sent the revenue leg exists, once paid the cash leg exists,
// and neither may be silently un-recorded. A paid invoice must be corrected via
// a credit note (out of scope), never voided — that would orphan the cash leg.
const ALLOWED_TRANSITIONS = {
  draft: new Set(['sent', 'paid', 'void']),
  sent: new Set(['paid', 'void']),
  paid: new Set(),
  void: new Set(),
}

function validatePatchRequest(body, existing) {
  const requestedContentFields = Object.keys(body).filter((k) => FINALIZED_LOCKED_FIELDS_SET.has(k))
  if (existing.finalized_at !== null && requestedContentFields.length > 0) {
    return { error: FINALIZED_ERROR }
  }
  if (body.status !== undefined && !STATUS_VALUES.has(body.status)) {
    return { error: { status: 400, body: { error: 'Invalid status' } } }
  }
  if (body.status !== undefined && body.status !== existing.status
      && !ALLOWED_TRANSITIONS[existing.status]?.has(body.status)) {
    if (body.status === 'void' && existing.status === 'paid') {
      return { error: CANNOT_VOID_PAID_ERROR }
    }
    return {
      error: {
        status: 409,
        body: {
          error: `Cannot change invoice status from ${existing.status} to ${body.status}`,
          code: 'invalid_status_transition',
          from: existing.status,
          to: body.status,
        },
      },
    }
  }
  return { requestedContentFields }
}

// Posts the ledger journal for a status transition, inside the patch transaction.
// Idempotent per (invoice, event), so re-running a transition is a no-op. A
// direct draft->paid jump still records the revenue leg first (postInvoiceSent).
async function postInvoiceTransition(client, tenantId, invoiceId, prevStatus, newStatus, actorUserId) {
  if (!['sent', 'paid', 'void'].includes(newStatus) || newStatus === prevStatus) return
  const fresh = await fetchInvoice(client, tenantId, invoiceId)
  if (!fresh) return
  const opts = { actorUserId }
  if (newStatus === 'sent') {
    await postInvoiceSent(client, tenantId, fresh, opts)
  } else if (newStatus === 'paid') {
    await postInvoiceSent(client, tenantId, fresh, opts)
    await postInvoicePaid(client, tenantId, fresh, opts)
  } else if (newStatus === 'void' && prevStatus === 'sent') {
    await postInvoiceVoid(client, tenantId, fresh, opts)
  }
}

// Validates and applies a PATCH. Returns { error } or { contentChanged, linkRemoved }.
export async function applyInvoicePatch(pool, tenantId, invoiceId, body, actorUserId = null) {
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

  // Voiding always retracts any live Mollie payment link first, so a voided
  // invoice can never receive money. Before touching Mollie, verify the void's
  // reversal journal can actually post (accounts configured, period open) —
  // otherwise a doomed void would delete the link and then fail, leaving a
  // sent invoice with no way to be paid. The whole flow (preflight → Mollie
  // removal → posting) runs under the per-tenant session-level settings lock so
  // a concurrent settings change (closing the books, clearing an account code)
  // cannot invalidate the preflight mid-flight. If Mollie reports the link as
  // already paid, removeMolliePaymentLink marks the invoice paid and errors —
  // the void is then refused (paid invoices cannot be voided).
  if (patch.status === 'void' && existing.status !== 'void' && existing.mollie_payment_link_id) {
    return withAccountingSettingsSessionLock(pool, tenantId, async (lockClient) => {
      if (existing.status === 'sent') {
        try {
          await assertInvoiceVoidPostable(lockClient, tenantId, existing)
        } catch (err) {
          const mapped = ledgerErrorResult(err)
          if (mapped) return mapped
          throw err
        }
      }
      const removal = await removeMolliePaymentLink({
        pool, tenant, invoice: existing, tenantId, invoiceId, client: lockClient,
      })
      if (removal.error) return removal

      const result = await runPatchTransaction({
        pool, client: lockClient, tenantId, invoiceId, body: patch, existing, tenant,
        requestedContentFields: validation.requestedContentFields,
        actorUserId,
      })
      if (result.error) return result
      return { ...result, linkRemoved: true }
    })
  }

  const result = await runPatchTransaction({
    pool, tenantId, invoiceId, body: patch, existing, tenant,
    requestedContentFields: validation.requestedContentFields,
    actorUserId,
  })
  if (result.error) return result
  return { ...result, linkRemoved: false }
}

// ---------- payment link removal ----------

function mollieStatusCode(err) {
  return err?.statusCode ?? err?.status ?? null
}

// Removes the Mollie payment link from an invoice: deletes it at Mollie when it
// was never opened (DELETE /v2/payment-links/:id → 204; 404 = already gone), and
// otherwise — Mollie 422s for any opened/attempted link — syncs authoritative
// payment state and, when no payment turned out paid, archives the link
// (PATCH { archived: true }) so it can no longer take payments. Either way the
// invoice's link columns are cleared. Returns { error } | { invoice }.
// `client` is optional: the void flow passes its lock-holding session so the
// 422→sync posting path and the column updates run on that connection (see
// withAccountingSettingsSessionLock — a fresh pooled connection would deadlock
// on the settings advisory lock the caller already holds).
export async function removeMolliePaymentLink({ pool, tenant, invoice, tenantId, invoiceId, client = null }) {
  const executor = client ?? pool
  try {
    assertMollieConfigured(tenant)
  } catch (err) {
    return { error: { status: err.status || 400, body: { error: err.message, code: err.code } } }
  }
  const mollie = createTenantMollieClient(tenant.mollie_api_key)
  const linkId = invoice.mollie_payment_link_id

  try {
    await mollie.paymentLinks.delete(linkId)
  } catch (err) {
    const status = mollieStatusCode(err)
    if (status === 422) {
      // Link was opened or has payment attempts. Pull authoritative state first.
      const synced = await syncInvoicePaymentStatus(mollie, pool, invoice, { client })
      if (synced?.status === 'paid') {
        return { error: { status: 409, body: { error: 'Payment link has a paid payment', code: 'payment_link_paid' } } }
      }
      try {
        await mollie.paymentLinks.update(linkId, { archived: true })
      } catch (archiveErr) {
        console.error('[invoices] failed to archive payment link:', archiveErr)
        return { error: { status: 502, body: { error: 'mollie_error', code: 'mollie_error' } } }
      }
    } else if (status !== 404) {
      console.error('[invoices] failed to delete payment link:', err)
      return { error: { status: 502, body: { error: 'mollie_error', code: 'mollie_error' } } }
    }
  }

  await executor.query(
    `UPDATE invoices
        SET mollie_payment_link_id = NULL,
            mollie_payment_link_url = NULL,
            mollie_payment_link_created_at = NULL,
            mollie_payment_link_expires_at = NULL,
            mollie_payment_status = NULL,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [invoiceId, tenantId],
  )
  return { invoice: await fetchInvoice(executor, tenantId, invoiceId) }
}

// ---------- payment links ----------

export function isMollieWebhookDisabled() {
  return process.env.MOLLIE_DISABLE_WEBHOOK === 'true'
}

// Locks the invoice, validates it can take a payment link, and finalizes it
// (draft -> sent, sets finalized_at) BEFORE any external Mollie call. Returns
// { error } | { alreadyLinked: invoice } | { invoice: finalizedInvoice }.
export async function finalizeInvoiceForPaymentLink(pool, tenantId, invoiceId, actorUserId = null) {
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
    // The invoice is now sent (revenue recognised). Idempotent if already posted
    // by a prior PATCH-to-sent.
    await postInvoiceSent(client, tenantId, finalized.rows[0], { actorUserId })
    await client.query('COMMIT')
    return { invoice: finalized.rows[0] }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const mapped = ledgerErrorResult(err)
    if (mapped) return mapped
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
// `opts.client` lets the void flow run the update + posting on its
// lock-holding session (see withAccountingSettingsSessionLock); the caller
// keeps ownership of a provided client.
export async function syncInvoicePaymentStatus(mollie, db, invoice, { client: providedClient = null } = {}) {
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

  const becamePaid = invoiceStatus === 'paid' && invoice.status !== 'paid'
  const client = providedClient ?? await db.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
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
    const updated = rows[0]
    if (becamePaid && updated) {
      // Ensure the revenue leg exists, then record the cash receipt. Both are
      // idempotent per (invoice, event). System posting: no actor, and a closed
      // period clamps the entry date instead of rejecting — Mollie holds the
      // cash either way, so the receipt must always be booked.
      const opts = { actorUserId: null, clampToOpenPeriod: true }
      await postInvoiceSent(client, invoice.tenant_id, updated, opts)
      await postInvoicePaid(client, invoice.tenant_id, updated, opts)
    }
    await client.query('COMMIT')
    return updated
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    if (!providedClient) client.release()
  }
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
