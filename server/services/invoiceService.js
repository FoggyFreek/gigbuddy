// Invoice domain logic. Route handlers stay thin and delegate here.
//
// Functions return a discriminated result so the HTTP layer can map outcomes
// to status codes without knowing the rules:
//   { error: { status, body } }   — caller should respond with that status/body
//   anything else                 — success payload (see each function)
import { randomUUID } from 'node:crypto'
import { getObject, uploadObject, removeObject, safeRemove, invoicePdfKey, invoiceLogoKey } from './storageService.js'
import { computeInvoiceTotals } from '../utils/computeInvoiceTotals.js'
import { renderInvoicePdf } from '../utils/renderInvoicePdf.js'
import { validateAndReencodeImage, extensionForImageMime } from '../utils/imageProcess.js'
import { buildPeriodWhere } from '../utils/periodQuery.js'
import { createTenantMollieClient, assertMollieConfigured } from '../utils/mollieClient.js'
import {
  createMolliePaymentLink,
  removeMolliePaymentLink,
  syncInvoicePaymentStatus,
} from './molliePaymentLinkService.js'
import { sendPushToTenant } from '../utils/sendPush.js'
import {
  fetchTenant,
  fetchInvoice,
  fetchLines,
  replaceInvoiceLines,
  validateGigIdForTenant,
  listInvoices as listInvoiceRows,
  listInvoicePeriodDates,
  fetchGig,
  fetchVenue,
  insertInvoice,
  insertInvoiceLines,
  nextInvoiceNumber,
  deleteInvoiceRow,
  setCustomLogoPath,
  stripMollieKey,
  fetchPublicInvoiceLogoPath,
} from '../repositories/invoiceRepository.js'
import {
  SIMPLE_PATCH_FIELDS,
  CONTENT_FIELDS_SET,
  FINALIZED_LOCKED_FIELDS_SET,
  STATUS_VALUES,
  normalizeLines,
  parseCreateInvoiceBody,
  computeDueDate,
  validatePaymentLinkOptions,
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

async function loadLogoBuffer(tenant, customLogoPath, useDarkLogo = false) {
  const key = customLogoPath || (useDarkLogo && tenant.logo_dark_path ? tenant.logo_dark_path : tenant.logo_path)
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
  const logoBuffer = await loadLogoBuffer(tenant, invoice.custom_logo_path, !!invoice.invert_logo)

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

  safeRemove(previousKey === newKey ? null : previousKey, '[invoices] failed to remove previous pdf:')

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

// ---------- payment links ----------

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

// ---------- route-facing operations ----------

const NOT_FOUND = { error: { status: 404, body: { error: 'Not found' } } }

export async function listInvoices(pool, tenantId, query) {
  const period = buildPeriodWhere(query, 'issue_date')
  if (period.error) return { error: { status: 400, body: { error: period.error } } }
  return { invoices: await listInvoiceRows(pool, tenantId, period) }
}

export async function listInvoicePeriods(pool, tenantId) {
  return listInvoicePeriodDates(pool, tenantId)
}

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

// Pre-fills an invoice draft from a gig. Returns { error } | { draft payload }.
export async function buildDraftFromGig(pool, tenantId, gigId) {
  const gig = await fetchGig(pool, tenantId, gigId)
  if (!gig) return { error: { status: 404, body: { error: 'Gig not found' } } }

  const venue = gig.venue_id ? await fetchVenue(pool, tenantId, gig.venue_id) : null
  const festival = gig.festival_id ? await fetchVenue(pool, tenantId, gig.festival_id) : null

  const tenant = await fetchTenant(pool, tenantId)
  if (!tenant) return { error: { status: 404, body: { error: 'Tenant not found' } } }

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

  return {
    draftResponse: {
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
    },
  }
}

export async function getInvoice(pool, tenantId, invoiceId) {
  const invoice = await fetchInvoice(pool, tenantId, invoiceId)
  if (!invoice) return NOT_FOUND
  const lines = await fetchLines(pool, invoiceId, tenantId)
  const tenant = await fetchTenant(pool, tenantId)
  return { invoice: { ...invoice, lines, tenant: stripMollieKey(tenant) } }
}

// Creates an invoice with its lines, then renders the PDF (best-effort — the
// row persists and rendering can be retried via POST /:id/render).
export async function createInvoice(pool, tenantId, userId, body) {
  const parsed = parseCreateInvoiceBody(body)
  if (parsed.error) return { error: { status: 400, body: { error: parsed.error } } }

  const tenant = await fetchTenant(pool, tenantId)
  if (!tenant) return { error: { status: 404, body: { error: 'Tenant not found' } } }

  const totals = computeAndApply(
    { tax_inclusive: parsed.taxInclusive, discount_type: parsed.discountType, discount_pct: parsed.discountPct, discount_cents: parsed.discountCents },
    parsed.lines,
    tenant,
  )
  const year = new Date(parsed.issueDate).getUTCFullYear() || new Date().getUTCFullYear()

  let gigId = null
  if (body.gig_id != null) {
    gigId = await validateGigIdForTenant(pool, body.gig_id, tenantId)
    if (gigId === null) return { error: { status: 400, body: { error: 'Invalid gig_id' } } }
  }

  const client = await pool.connect()
  let invoiceId
  try {
    await client.query('BEGIN')
    const invoiceNumber = await nextInvoiceNumber(client, tenantId, year)
    invoiceId = await insertInvoice(client, {
      tenant_id: tenantId,
      gig_id: gigId,
      invoice_number: invoiceNumber,
      issue_date: parsed.issueDate,
      due_date: parsed.dueDate,
      payment_term_days: parsed.paymentTermDays,
      customer_name: parsed.customerName,
      customer_contact_title: body.customer_contact_title || null,
      customer_contact_given_name: body.customer_contact_given_name || null,
      customer_contact_family_name: body.customer_contact_family_name || null,
      customer_address_street: body.customer_address_street || null,
      customer_address_postal_code: body.customer_address_postal_code || null,
      customer_address_city: body.customer_address_city || null,
      customer_address_country: body.customer_address_country || null,
      customer_email: body.customer_email || null,
      customer_kvk: body.customer_kvk || null,
      customer_tax_id: body.customer_tax_id || null,
      memo: body.memo || null,
      tax_inclusive: parsed.taxInclusive,
      discount_type: parsed.discountType,
      discount_pct: parsed.discountPct,
      discount_cents: totals.discountCents,
      invert_logo: Boolean(body.invert_logo),
      subtotal_cents: totals.subtotalCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      created_by_user_id: userId,
    })
    await insertInvoiceLines(client, invoiceId, tenantId, parsed.lines)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  try {
    await renderAndStorePdf(pool, invoiceId, tenantId)
  } catch (err) {
    console.error('[invoices] PDF render failed (row persisted, retry via POST /:id/render):', err)
  }

  const created = await fetchInvoice(pool, tenantId, invoiceId)
  const createdLines = await fetchLines(pool, invoiceId, tenantId)
  return { invoice: { ...created, lines: createdLines } }
}

// Applies a PATCH, re-renders the PDF when needed, and returns the fresh
// invoice with lines. Returns { error } | { invoice }.
export async function patchInvoice(pool, tenantId, invoiceId, body, actorUserId = null) {
  const result = await applyInvoicePatch(pool, tenantId, invoiceId, body, actorUserId)
  if (result.error) return result

  // linkRemoved: voiding retracted the Mollie payment link, so the stored PDF
  // (which embeds the payment QR/URL) must be refreshed too.
  if (result.contentChanged || result.linkRemoved) {
    try {
      await renderAndStorePdf(pool, invoiceId, tenantId)
    } catch (err) {
      console.error('[invoices] PDF re-render failed:', err)
    }
  }

  const updated = await fetchInvoice(pool, tenantId, invoiceId)
  const lines = await fetchLines(pool, invoiceId, tenantId)
  return { invoice: { ...updated, lines } }
}

export async function deleteInvoice(pool, tenantId, invoiceId) {
  const existing = await fetchInvoice(pool, tenantId, invoiceId)
  if (!existing) return NOT_FOUND
  if (existing.status !== 'draft') {
    return { error: { status: 409, body: { error: 'Only draft invoices can be deleted', code: 'invoice_finalized' } } }
  }
  await deleteInvoiceRow(pool, tenantId, invoiceId)
  safeRemove(existing.pdf_path, '[invoices] failed to delete pdf on invoice delete:')
  safeRemove(existing.custom_logo_path, '[invoices] failed to delete custom logo on invoice delete:')
  return {}
}

export async function retryRenderPdf(pool, tenantId, invoiceId) {
  const existing = await fetchInvoice(pool, tenantId, invoiceId)
  if (!existing) return NOT_FOUND
  const pdfPath = await renderAndStorePdf(pool, invoiceId, tenantId)
  return { pdf_path: pdfPath }
}

// ---------- custom logo ----------

export async function uploadInvoiceLogo(pool, tenantId, invoiceId, file) {
  const existing = await fetchInvoice(pool, tenantId, invoiceId)
  if (!existing) return NOT_FOUND
  if (existing.finalized_at !== null) {
    return { error: { status: 409, body: { error: 'Invoice is finalized', code: 'invoice_finalized' } } }
  }
  const oldKey = existing.custom_logo_path || null

  const image = await validateAndReencodeImage(file.buffer, file.mimetype)
  const ext = extensionForImageMime(image.mimetype)
  const objectKey = invoiceLogoKey(tenantId, randomUUID(), ext)

  await uploadObject(objectKey, image.buffer, image.size, image.mimetype)

  try {
    await setCustomLogoPath(pool, tenantId, invoiceId, objectKey)
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }

  safeRemove(oldKey, '[invoices] failed to delete old custom logo:')

  try {
    await renderAndStorePdf(pool, invoiceId, tenantId)
  } catch (err) {
    console.error('[invoices] PDF re-render after logo upload failed:', err)
  }

  return { custom_logo_path: objectKey }
}

export async function removeInvoiceLogo(pool, tenantId, invoiceId) {
  const existing = await fetchInvoice(pool, tenantId, invoiceId)
  if (!existing) return NOT_FOUND
  if (existing.finalized_at !== null) {
    return { error: { status: 409, body: { error: 'Invoice is finalized', code: 'invoice_finalized' } } }
  }
  const oldKey = existing.custom_logo_path
  await setCustomLogoPath(pool, tenantId, invoiceId, null)
  safeRemove(oldKey, '[invoices] failed to delete custom logo on remove:')
  try {
    await renderAndStorePdf(pool, invoiceId, tenantId)
  } catch (err) {
    console.error('[invoices] PDF re-render after logo remove failed:', err)
  }
  return {}
}

// ---------- payment-link route operations ----------

const PAYMENT_LINK_LOCK_NAMESPACE = 53001

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

// Finalizes the invoice and creates a Mollie payment link under a per-invoice
// advisory lock. Returns { error } | { invoice, created } where created is
// false when an existing link was returned instead of a new one.
export async function createInvoicePaymentLink(pool, tenantId, invoiceId, actorUserId, rawOptions) {
  const opts = validatePaymentLinkOptions(rawOptions || {})
  if (opts.error) return { error: { status: 400, body: { error: opts.error } } }

  return withPaymentLinkCreationLock(pool, invoiceId, async () => {
    // Finalize the invoice before calling Mollie, so a concurrent PATCH sees
    // finalized_at. The advisory lock also makes the Mollie create single-flight.
    const finalize = await finalizeInvoiceForPaymentLink(pool, tenantId, invoiceId, actorUserId)
    if (finalize.error) return finalize

    const tenant = await fetchTenant(pool, tenantId)

    if (finalize.alreadyLinked) {
      const lines = await fetchLines(pool, invoiceId, tenantId)
      return { invoice: { ...finalize.alreadyLinked, lines, tenant: stripMollieKey(tenant) }, created: false }
    }

    assertMollieConfigured(tenant)
    const created = await createMolliePaymentLink({
      pool, tenant, invoice: finalize.invoice, tenantId, invoiceId, opts,
    })
    if (created.error) return created

    // Re-render the PDF so it includes the QR code. Await so the response carries
    // the freshly-rendered pdf_path; renderAndStorePdf deletes the previous PDF,
    // so returning the stale key would 404 on download.
    let finalInvoice = created.invoice
    try {
      await renderAndStorePdf(pool, invoiceId, tenantId)
      const refreshed = await fetchInvoice(pool, tenantId, invoiceId)
      if (refreshed) finalInvoice = refreshed
    } catch (err) {
      console.error('[invoices] PDF re-render after payment-link creation failed:', err)
    }

    const lines = await fetchLines(pool, invoiceId, tenantId)
    return { invoice: { ...finalInvoice, lines, tenant: stripMollieKey(tenant) }, created: true }
  })
}

// Deletes the Mollie payment link (or archives it when Mollie refuses deletion
// for an opened/attempted link) and clears the link columns. 409 when the link
// turns out to be paid — the invoice is then marked paid instead.
export async function removeInvoicePaymentLink(pool, tenantId, invoiceId) {
  const invoice = await fetchInvoice(pool, tenantId, invoiceId)
  if (!invoice) return NOT_FOUND
  if (!invoice.mollie_payment_link_id) {
    return { error: { status: 400, body: { error: 'no_payment_link' } } }
  }

  const tenant = await fetchTenant(pool, tenantId)
  const result = await removeMolliePaymentLink({
    pool, tenant, invoice, tenantId, invoiceId,
  })
  if (result.error) return result

  // The stored PDF embeds the payment QR/URL — refresh it now the link is gone.
  let finalInvoice = result.invoice
  try {
    await renderAndStorePdf(pool, invoiceId, tenantId)
    const refreshed = await fetchInvoice(pool, tenantId, invoiceId)
    if (refreshed) finalInvoice = refreshed
  } catch (err) {
    console.error('[invoices] PDF re-render after payment-link removal failed:', err)
  }

  const lines = await fetchLines(pool, invoiceId, tenantId)
  return { invoice: { ...finalInvoice, lines, tenant: stripMollieKey(tenant) } }
}

// Pulls authoritative payment state from Mollie. Returns { error } | { sync }.
export async function syncInvoicePaymentLink(pool, tenantId, invoiceId) {
  const invoice = await fetchInvoice(pool, tenantId, invoiceId)
  if (!invoice) return NOT_FOUND
  if (!invoice.mollie_payment_link_id) {
    return { error: { status: 400, body: { error: 'no_payment_link' } } }
  }

  const tenant = await fetchTenant(pool, tenantId)
  assertMollieConfigured(tenant)

  const mollie = createTenantMollieClient(tenant.mollie_api_key)
  const updated = await syncInvoicePaymentStatus(mollie, pool, invoice)

  return {
    sync: {
      paymentLinkId: updated.mollie_payment_link_id,
      paymentLinkUrl: updated.mollie_payment_link_url,
      paymentId: updated.mollie_payment_id,
      status: updated.mollie_payment_status,
      paidAt: updated.mollie_paid_at,
      invoiceStatus: updated.status,
    },
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

// Public (unauthenticated) tenant logo for an invoice shared via a Mollie
// payment link. Returns the object key, or null when not shareable/none set.
export async function getPublicInvoiceLogoPath(db, invoiceId) {
  return fetchPublicInvoiceLogoPath(db, invoiceId)
}
