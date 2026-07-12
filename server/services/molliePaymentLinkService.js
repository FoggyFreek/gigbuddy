// Mollie payment-link integration for invoices: creating, removing, and
// syncing links against the Mollie API. Invoice domain rules (finalization,
// status machine, PDF rendering) stay in invoiceService.js — this module owns
// the conversation with Mollie plus the link/payment columns on the invoice.
//
// Same result contract as the other services: expected failures return
// { error: { status, body } }, success returns a named payload.
import {
  createTenantMollieClient,
  formatMollieAmountFromCents,
} from '../utils/mollieClient.js'
import {
  fetchInvoice,
  fetchPublicMollieInvoice,
  setInvoicePaymentLink,
  clearInvoicePaymentLink,
  updateInvoicePaymentState,
} from '../repositories/invoiceRepository.js'
import { postInvoiceSent, postInvoicePaid } from './ledgerService.js'
import { withTransaction } from '../db/withTransaction.js'
import { CREDENTIAL_TYPES } from '../security/integrationSecrets.js'
import { loadIntegrationCredential, loadRetainedIntegrationCredential } from './integrationCredentialService.js'
import { withIntegrationWriteLock } from './featureGuards.js'
import { logger } from '../utils/logger.js'

export function isMollieWebhookDisabled() {
  return process.env.MOLLIE_DISABLE_WEBHOOK === 'true'
}

function mollieStatusCode(err) {
  return err?.statusCode ?? err?.status ?? null
}

// `includeRetained` opts into the internal accessor that still decrypts a key
// whose value is retained after an integrations purge (paid links needing
// webhook/sync). Creation flows must NOT pass it — a retained key reads as
// "not configured" so no new links can be minted with it.
export async function getMollieClientForTenant(executor, tenantId, { includeRetained = false } = {}) {
  let apiKey
  try {
    apiKey = includeRetained
      ? await loadRetainedIntegrationCredential(executor, tenantId, CREDENTIAL_TYPES.MOLLIE_API_KEY)
      : await loadIntegrationCredential(executor, tenantId, CREDENTIAL_TYPES.MOLLIE_API_KEY)
  } catch (err) {
    logger.error('mollie.credential_decryption_failed', { err, tenantId })
    return { error: { status: 503, body: { error: 'mollie_credential_unavailable' } } }
  }
  if (!apiKey) {
    return { error: { status: 400, body: { error: 'Mollie API key is not configured', code: 'mollie_not_configured' } } }
  }
  return { mollie: createTenantMollieClient(apiKey) }
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
// The whole remote+local workflow runs under the per-tenant integration-write
// session lock so it can't interleave with the integrations purge: purge-first
// leaves the key deleted/retained → the credential load here fails cleanly;
// create-first → the purge's remote phase sees and removes the new link.
export async function createMolliePaymentLink({ pool, tenant, invoice, tenantId, invoiceId, opts }) {
  return withIntegrationWriteLock(pool, tenantId, async () => {
    const configured = await getMollieClientForTenant(pool, tenantId)
    if (configured.error) return configured
    const { mollie } = configured
    const payload = buildPaymentLinkPayload({ tenant, invoice, invoiceId, opts })
    const paymentLink = await mollie.paymentLinks.create(payload)

    const checkoutUrl = paymentLink._links?.paymentLink?.href
    if (!checkoutUrl) return { error: { status: 502, body: { error: 'mollie_payment_link_url_missing' } } }

    // A link orphaned by losing the concurrent-creation race carries no charge
    // until used.
    const updated = await setInvoicePaymentLink(pool, tenantId, invoiceId, {
      linkId: paymentLink.id,
      url: checkoutUrl,
      expiresAt: opts.expiresAt,
    })

    if (!updated) {
      return { invoice: await fetchInvoice(pool, tenantId, invoiceId) }
    }
    return { invoice: updated }
  })
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
export async function deactivateMolliePaymentLink({ pool, invoice, tenantId, invoiceId, client = null }) {
  const executor = client ?? pool
  const configured = await getMollieClientForTenant(executor, tenantId, { includeRetained: true })
  if (configured.error) return configured
  const { mollie } = configured
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
        logger.error('mollie.payment_link_archive_failed', { err: archiveErr, tenantId, invoiceId })
        return { error: { status: 502, body: { error: 'mollie_error', code: 'mollie_error' } } }
      }
    } else if (status !== 404) {
      logger.error('mollie.payment_link_delete_failed', { err, tenantId, invoiceId })
      return { error: { status: 502, body: { error: 'mollie_error', code: 'mollie_error' } } }
    }
  }

  return { deactivated: true }
}

export async function removeMolliePaymentLink({ pool, tenant: _tenant, invoice, tenantId, invoiceId, client = null }) {
  const result = await deactivateMolliePaymentLink({ pool, invoice, tenantId, invoiceId, client })
  if (result.error) return result
  const executor = client ?? pool
  await clearInvoicePaymentLink(executor, tenantId, invoiceId)
  return { invoice: await fetchInvoice(executor, tenantId, invoiceId) }
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
  return withTransaction(async (client) => {
    const updated = await updateInvoicePaymentState(client, invoice.tenant_id, invoice.id, {
      mollieStatus, paymentId, paidAt, invoiceStatus,
    })
    if (becamePaid && updated) {
      // Ensure the revenue leg exists, then record the cash receipt. Both are
      // idempotent per (invoice, event). System posting: no actor, and a closed
      // period clamps the entry date instead of rejecting — Mollie holds the
      // cash either way, so the receipt must always be booked.
      //
      // This is the same paid posting that invoiceService.settleInvoice() owns for
      // the manual-PATCH and bank-import channels. Keep this pair in sync with settleInvoice.
      const opts = { actorUserId: null, clampToOpenPeriod: true }
      await postInvoiceSent(client, invoice.tenant_id, updated, opts)
      await postInvoicePaid(client, invoice.tenant_id, updated, opts)
    }
    return updated
  }, { client: providedClient, db })
}

// Processes a Mollie payment-link webhook for one invoice. The posted payment id
// is only a "go check now" hint — authoritative status is re-fetched from Mollie
// using the tenant's secret key, so the posted id is never trusted. Returns
// { notify: { tenantId, invoice } } only on the transition to paid (so the route
// pings the band once), otherwise {}.
export async function handlePaymentWebhook(db, invoiceId) {
  const invoice = await fetchPublicMollieInvoice(db, invoiceId)
  if (!invoice) return {}

  const configured = await getMollieClientForTenant(db, invoice.tenant_id, { includeRetained: true })
  if (configured.error) return {}
  const { mollie } = configured
  const updated = await syncInvoicePaymentStatus(mollie, db, invoice)

  // Gate on the app invoice status (not mollie_payment_status) so void invoices
  // stay silent, and compare the pre-read row against the update to suppress
  // Mollie's sequential retries — once status is 'paid', later reads skip.
  const becamePaid =
    updated &&
    invoice.status !== 'paid' &&
    updated.status === 'paid' &&
    updated.mollie_payment_status === 'paid'

  return becamePaid ? { notify: { tenantId: invoice.tenant_id, invoice: updated } } : {}
}
