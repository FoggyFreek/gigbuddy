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
import { fetchContract, markContractSent } from './contractRepository.js'
import { fetchProfileTenant } from '../../people/profiles/profileRepository.js'
import {
  fetchCampaign, fetchContactForCampaign, fetchTemplateForCampaign,
  fetchVenueForCampaign, insertCampaign, insertRecipient, listCampaignRecipients, listCampaignRows,
  setCampaignStatus, setRecipientResult,
} from './campaignRepository.js'

const NOT_FOUND = notFound('Not found')
const callerCan = (caller, permission) => hasPermission(caller.role, permission, { isSuperAdmin: caller.isSuperAdmin })

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
  if (body.contractId && recipients.length !== 1) return badRequest('A contract campaign must have exactly one recipient')
  if (body.contractId && !callerCan(caller, PERMISSIONS.FINANCE_MANAGE)) return forbidden('Permission denied')

  return withTransaction(async (client) => {
    const template = await fetchTemplateForCampaign(client, tenantId, templateId)
    const sender = await getSenderIdentity(client, tenantId)
    const tenant = await fetchProfileTenant(client, tenantId)
    if (!template) abortTransaction(NOT_FOUND)
    if (!sender?.resend_configured || !sender.outreach_from_email || !sender.outreach_from_name) {
      abortTransaction(badRequest('Resend sender is not configured in settings', { code: 'sender_not_configured' }))
    }
    let selectedContract = null
    if (body.contractId) {
      selectedContract = await fetchContract(client, tenantId, Number(body.contractId))
      if (!selectedContract) abortTransaction(NOT_FOUND)
      if (!selectedContract.pdf_object_key || selectedContract.status !== 'draft') abortTransaction(badRequest('The selected contract is not available to send'))
    }
    const campaign = await insertCampaign(client, tenantId, {
      templateId, subject: template.subject, bodyHtml: template.body_html, bodyText: template.body_text,
      fromName: sender.outreach_from_name, fromEmail: sender.outreach_from_email, replyTo: sender.outreach_reply_to,
      userId, contractId: body.contractId ?? null,
    })
    const created = []
    for (const [index, input] of recipients.entries()) {
      const venueId = input.venueId
      const venue = venueId ? await fetchVenueForCampaign(client, tenantId, Number(venueId)) : null
      if (venueId && !venue) abortTransaction(NOT_FOUND)
      if (selectedContract) {
        const contractVenueId = selectedContract.terms_snapshot?.gig?.venue_id
          ?? selectedContract.terms_snapshot?.venue?.id
        if (!venue || Number(contractVenueId) !== Number(venue.id)) {
          abortTransaction(badRequest('The contract does not belong to the selected venue'))
        }
      }
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
      const unresolved = findUnresolvable(extractTokens(`${template.subject}\n${template.body_html}\n${template.body_text}`), resolvedFields)
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

export async function listCampaigns(db, tenantId, query = {}) {
  return limitedCollection(query.limit, (limit) => listCampaignRows(db, tenantId, limit))
}
export async function getCampaign(db, tenantId, campaignId) {
  const campaign = await fetchCampaign(db, tenantId, campaignId)
  if (!campaign) return NOT_FOUND
  return { campaign: { ...campaign, recipients: await listCampaignRecipients(db, tenantId, campaignId) } }
}

export async function sendCampaign(db, tenantId, campaignId, caller, { singleDispatcher, batchDispatcher, attachmentLoader }) {
  const campaign = await fetchCampaign(db, tenantId, campaignId)
  if (!campaign) return NOT_FOUND
  const required = campaign.contract_id ? PERMISSIONS.FINANCE_MANAGE : PERMISSIONS.PLANNING_WRITE
  if (!callerCan(caller, required)) return forbidden('Permission denied')
  if (['sent', 'partial', 'failed'].includes(campaign.status)) return getCampaign(db, tenantId, campaignId)
  const recipients = await listCampaignRecipients(db, tenantId, campaignId)
  const dispatcher = campaign.contract_id ? singleDispatcher : batchDispatcher
  if (campaign.contract_id && (!dispatcher.supportsAttachments || recipients.length !== 1)) return badRequest('The selected dispatcher cannot send this contract campaign')
  await setCampaignStatus(db, tenantId, campaignId, 'sending')
  const attachment = campaign.contract_id ? await attachmentLoader(campaign.contract_id) : null
  const messages = []
  for (const recipient of recipients) {
    if (recipient.status !== 'pending') continue
    if (await isSuppressed(db, tenantId, recipient.to_email)) {
      await setRecipientResult(db, tenantId, recipient.id, { status: 'skipped', error: 'Recipient is suppressed' })
      continue
    }
    const values = recipient.resolved_fields
    const html = mergeBlocks(mergeTokens(campaign.body_html_snapshot, values, { escape: true }), values)
    const text = mergeBlocks(mergeTokens(campaign.body_text_snapshot, values), values)
    const payload = {
      from: `${campaign.from_name} <${campaign.from_email}>`, to: recipient.to_email, subject: recipient.merged_subject,
      html, text, replyTo: campaign.reply_to ?? undefined,
      ...(campaign.contract_id ? { attachments: [attachment] } : {
        headers: { 'List-Unsubscribe': `<mailto:${campaign.reply_to ?? campaign.from_email}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
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
  if (campaign.contract_id && sent) await markContractSent(db, tenantId, campaign.contract_id, campaignId)
  return { campaign: { ...finalCampaign, recipients: finalRecipients } }
}
