import { abortTransaction, withTransaction } from '../../db/withTransaction.js'
import { hasPermission, PERMISSIONS } from '../../auth/permissions.js'
import { limitedCollection } from '../../platform/collections/limitedCollectionService.js'
import { badRequest, forbidden, notFound } from '../../platform/http/serviceErrors.js'
import { OUTREACH_FIELDS } from '../../../shared/outreachFields.js'
import { extractTokens, findUnresolvable, mergeBlocks, mergeTokens } from '../../../shared/outreachMerge.js'
import { formatOutreachValue } from './fields/formatters.js'
import { resolveOutreachRawValues } from './fields/resolvers.js'
import { renderOutreachBlocks } from './blocks/index.js'
import { logger } from '../../utils/logger.js'
import { getSenderIdentity } from './senderRepository.js'
import { isSuppressed } from './sendRepository.js'
import { fetchProfileTenant } from '../../people/profiles/profileRepository.js'
import {
  claimCampaignForSend,
  fetchCampaign, fetchContactForCampaign, fetchTemplateForCampaign,
  fetchVenueForCampaign, insertCampaign, insertRecipient, listCampaignRecipients, listCampaignRows,
  setCampaignStatus, setRecipientResult,
} from './campaignRepository.js'

const NOT_FOUND = notFound('Not found')
const callerCan = (caller, permission) => hasPermission(caller.role, permission, { isSuperAdmin: caller.isSuperAdmin })

// Only REQUIRED fields make a recipient unsendable. Optional ones (no payment
// link, a blank message, an invoice without a gig) merge to nothing.
const REQUIRED_KEYS = new Set(OUTREACH_FIELDS.filter((field) => field.required !== false).map((field) => field.key))

function requiredTokens(tokens) {
  return tokens.filter((token) => REQUIRED_KEYS.has(token.replace(/^#/, '')))
}

function formatValues(raw, locale) {
  return Object.fromEntries(OUTREACH_FIELDS.filter((field) => !field.block).map((field) => [field.key,
    formatOutreachValue(raw[field.key], field.format, { locale })]))
}

export async function createCampaign(db, tenantId, userId, body, caller) {
  if (!callerCan(caller, PERMISSIONS.PLANNING_WRITE)) return forbidden('Permission denied')
  const templateId = Number(body.templateId)
  const recipients = Array.isArray(body.recipients) ? body.recipients : []
  if (!Number.isInteger(templateId) || templateId < 1) return badRequest('templateId is required')
  if (!recipients.length) return badRequest('At least one recipient is required')
  if (recipients.some((recipient) => !['primary_contact', 'venue'].includes(recipient.addressSource ?? 'primary_contact'))) {
    return badRequest('Invalid recipient address source')
  }
  return withTransaction(async (client) => {
    const template = await fetchTemplateForCampaign(client, tenantId, templateId)
    const sender = await getSenderIdentity(client, tenantId)
    const tenant = await fetchProfileTenant(client, tenantId)
    if (!template) abortTransaction(NOT_FOUND)
    if (!sender?.resend_configured || !sender.outreach_from_email || !sender.outreach_from_name) {
      abortTransaction(badRequest('Resend sender is not configured in settings', { code: 'sender_not_configured' }))
    }
    const campaign = await insertCampaign(client, tenantId, {
      templateId, subject: template.subject, bodyHtml: template.body_html, bodyText: template.body_text,
      fromName: sender.outreach_from_name, fromEmail: sender.outreach_from_email, replyTo: sender.outreach_reply_to,
      userId,
    })
    const created = []
    for (const [index, input] of recipients.entries()) {
      const venueId = input.venueId
      const venue = venueId ? await fetchVenueForCampaign(client, tenantId, Number(venueId)) : null
      if (venueId && !venue) abortTransaction(NOT_FOUND)
      const contactId = Number(input.contactId)
      const hasContactId = Number.isInteger(contactId) && contactId > 0
      const contact = hasContactId ? await fetchContactForCampaign(client, tenantId, contactId) : null
      if (input.contactId != null && !contact) abortTransaction(NOT_FOUND)
      const addressSource = input.addressSource ?? 'primary_contact'
      if (addressSource === 'venue' && !venue) abortTransaction(badRequest('Venue recipient requires a venue'))
      const destination = addressSource === 'venue'
        ? { email: venue.email, name: venue.organization_name || venue.name, missing: 'Venue has no email address' }
        : { email: contact?.email, name: contact?.name, missing: 'Primary contact has no email address' }
      const raw = resolveOutreachRawValues({
        tenant, venue: venue ?? {}, contact: contact ?? {},
      }, { locale: template.locale })
      const values = formatValues(raw, template.locale)
      const blockKeys = extractTokens(`${template.body_html}\n${template.body_text}`).filter((token) => token.startsWith('#')).map((token) => token.slice(1))
      const blocks = renderOutreachBlocks(blockKeys, { tenant, venue, contact, locale: template.locale })
      const resolvedFields = { ...values, ...blocks }
      const unresolved = findUnresolvable(requiredTokens(extractTokens(`${template.subject}\n${template.body_html}\n${template.body_text}`)), resolvedFields)
      const status = !destination.email || unresolved.length ? 'skipped' : 'pending'
      created.push(await insertRecipient(client, tenantId, campaign.id, {
        contactId: contact?.id ?? null, venueId: venue?.id ?? null,
        toEmail: destination.email ?? '', toName: destination.name ?? null, mergedSubject: mergeTokens(template.subject, values),
        resolvedFields, status, errorMessage: !destination.email ? destination.missing : unresolved.length ? `Unresolvable tokens: ${unresolved.join(', ')}` : null,
      }, index))
    }
    return { campaign: { ...campaign, recipients: created } }
  }, { db })
}

// Creates a campaign whose content is already resolved by the owning domain
// (the invoice slice merges its own fields). Outreach still owns the tables and
// the single-recipient invariant; the caller owns the invoice semantics.
export async function createResolvedCampaign(db, tenantId, userId, input) {
  return withTransaction(async (client) => {
    const sender = await getSenderIdentity(client, tenantId)
    if (!sender?.resend_configured || !sender.outreach_from_email || !sender.outreach_from_name) {
      abortTransaction(badRequest('Resend sender is not configured in settings', { code: 'sender_not_configured' }))
    }
    const campaign = await insertCampaign(client, tenantId, {
      templateId: input.templateId, subject: input.subject, bodyHtml: input.bodyHtml, bodyText: input.bodyText,
      fromName: sender.outreach_from_name, fromEmail: sender.outreach_from_email, replyTo: sender.outreach_reply_to,
      userId, type: input.type, invoiceId: input.invoiceId, attachments: input.attachments,
    })
    const recipient = await insertRecipient(client, tenantId, campaign.id, {
      contactId: null, venueId: null,
      toEmail: input.toEmail, toName: input.toName ?? null,
      mergedSubject: input.subject, resolvedFields: input.resolvedFields ?? {},
      status: input.toEmail ? 'pending' : 'skipped',
      errorMessage: input.toEmail ? null : 'The invoice has no customer email address',
    }, 0)
    return { campaign: { ...campaign, recipients: [recipient] } }
  }, { db })
}

export async function listCampaigns(db, tenantId, query = {}) {
  const type = query.type === 'invoice' || query.type === 'outreach' ? query.type : null
  return limitedCollection(query.limit, (limit) => listCampaignRows(db, tenantId, limit, type))
}
export async function getCampaign(db, tenantId, campaignId) {
  const campaign = await fetchCampaign(db, tenantId, campaignId)
  if (!campaign) return NOT_FOUND
  return { campaign: { ...campaign, recipients: await listCampaignRecipients(db, tenantId, campaignId) } }
}

export async function sendCampaign(db, tenantId, campaignId, caller, { batchDispatcher, singleDispatcher, attachmentLoader } = {}) {
  const existing = await fetchCampaign(db, tenantId, campaignId)
  if (!existing) return NOT_FOUND
  const isInvoice = existing.type === 'invoice'
  // An invoice email is a finance action; venue outreach is a planning one.
  if (!callerCan(caller, isInvoice ? PERMISSIONS.FINANCE_MANAGE : PERMISSIONS.PLANNING_WRITE)) return forbidden('Permission denied')
  // Atomic claim: a lost response replayed against the same campaign id must not
  // dispatch a second time.
  const campaign = await claimCampaignForSend(db, tenantId, campaignId)
  if (!campaign) return getCampaign(db, tenantId, campaignId)
  const dispatcher = isInvoice ? singleDispatcher : batchDispatcher
  if (isInvoice && !dispatcher?.supportsAttachments) {
    await setCampaignStatus(db, tenantId, campaignId, 'draft')
    return badRequest('The selected dispatcher cannot send this invoice campaign')
  }
  let attachments = null
  if (isInvoice) {
    const loaded = await attachmentLoader(campaign)
    if (loaded?.error) {
      await setCampaignStatus(db, tenantId, campaignId, 'draft')
      return loaded
    }
    attachments = loaded.attachments
  }
  const recipients = await listCampaignRecipients(db, tenantId, campaignId)
  const messages = []
  for (const recipient of recipients) {
    if (recipient.status !== 'pending') continue
    // Suppressions are marketing opt-outs. An invoice is transactional and must
    // never be withheld because someone unsubscribed from venue outreach.
    if (!isInvoice && await isSuppressed(db, tenantId, recipient.to_email)) {
      await setRecipientResult(db, tenantId, recipient.id, { status: 'skipped', error: 'Recipient is suppressed' })
      continue
    }
    const values = recipient.resolved_fields
    const html = mergeBlocks(mergeTokens(campaign.body_html_snapshot, values, { escape: true }), values)
    const text = mergeBlocks(mergeTokens(campaign.body_text_snapshot, values), values)
    const payload = {
      from: `${campaign.from_name} <${campaign.from_email}>`, to: recipient.to_email, subject: recipient.merged_subject,
      html, text, replyTo: campaign.reply_to ?? undefined,
      // Transactional mail carries its attachments and no unsubscribe headers;
      // bulk outreach carries the headers and never attachments.
      ...(isInvoice
        ? { attachments }
        : { headers: { 'List-Unsubscribe': `<mailto:${campaign.reply_to ?? campaign.from_email}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
    }
    messages.push({ recipientId: recipient.id, idempotencyKey: recipient.idempotency_key, payload })
  }
  const results = await dispatcher.dispatch(messages)
  for (const result of results) {
    await setRecipientResult(db, tenantId, result.recipientId, result.error
      ? { status: 'failed', error: result.error }
      : { status: 'sent', providerMessageId: result.providerMessageId })
    logger.info('outreach.send', {
      tenantId,
      campaignId,
      recipientId: result.recipientId,
      providerMessageId: result.providerMessageId ?? null,
      status: result.error ? 'failed' : 'sent',
    })
  }
  const finalRecipients = await listCampaignRecipients(db, tenantId, campaignId)
  const sent = finalRecipients.filter((row) => row.status === 'sent').length
  const failed = finalRecipients.filter((row) => row.status === 'failed').length
  const finalStatus = failed && sent ? 'partial' : failed || !sent ? 'failed' : 'sent'
  const finalCampaign = await setCampaignStatus(db, tenantId, campaignId, finalStatus, true)
  return { campaign: { ...finalCampaign, recipients: finalRecipients } }
}
