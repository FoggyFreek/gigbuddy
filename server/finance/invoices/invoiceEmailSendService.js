// Sends an invoice email through the tenant's Resend integration, recorded as an
// outreach campaign of type 'invoice' so one send history covers both bulk venue
// outreach and single transactional mail.
//
// The flow is deliberately two calls — create, then send that campaign id. A
// create-and-send endpoint could not be retried safely: the per-recipient
// idempotency key is derived from the inserted rows, so a replay would mint a new
// campaign and deliver the invoice twice.
import { getResendClientForTenant } from '../../platform/integrations/resendService.js'
import { createSingleDispatcher } from '../../promotion/outreach/dispatch/index.js'
import { createResolvedCampaign, sendCampaign } from '../../promotion/outreach/campaignService.js'
import { fetchCampaign } from '../../promotion/outreach/campaignRepository.js'
import { fetchTemplate } from '../../promotion/outreach/templateRepository.js'
import { fetchInvoiceWithGig } from './invoiceRepository.js'
import { isAttachmentMode, materializeInvoiceAttachments, resolveInvoiceEmailContent } from './invoiceEmailService.js'
import { badRequest, notFound } from '../../platform/http/serviceErrors.js'

const NOT_FOUND = notFound('Not found')

export async function createInvoiceEmailCampaign(db, tenantId, userId, invoiceId, body = {}) {
  const attachments = body.attachments ?? 'pdf'
  if (!isAttachmentMode(attachments)) return badRequest('Invalid attachments option')
  const resolved = await resolveInvoiceEmailContent(db, tenantId, invoiceId, {
    templateId: body.templateId, message: body.message,
  })
  if (resolved.error) return resolved
  const { content } = resolved
  if (!content.toEmail) {
    return badRequest('The invoice has no valid customer email address', { code: 'invoice_customer_email_missing' })
  }
  const created = await createResolvedCampaign(db, tenantId, userId, {
    type: 'invoice',
    invoiceId,
    attachments,
    templateId: content.template.id,
    subject: content.subject,
    bodyHtml: content.html,
    bodyText: content.text,
    toEmail: content.toEmail,
    toName: content.toName,
    resolvedFields: content.resolvedFields,
  })
  if (created.error) return created
  return { campaign: created.campaign }
}

export async function sendInvoiceEmailCampaign(db, tenantId, invoiceId, campaignId, caller) {
  const campaign = await fetchCampaign(db, tenantId, campaignId)
  // The campaign must belong to this tenant AND this invoice — never trust a
  // client-supplied id to address another invoice's send.
  if (!campaign || campaign.type !== 'invoice' || campaign.invoice_id !== invoiceId) return NOT_FOUND

  const clientResult = await getResendClientForTenant(db, tenantId)
  if (clientResult.error) return clientResult

  return sendCampaign(db, tenantId, campaignId, caller, {
    singleDispatcher: createSingleDispatcher(clientResult.resend),
    attachmentLoader: async (row) => {
      const invoice = await fetchInvoiceWithGig(db, tenantId, row.invoice_id)
      if (!invoice) return NOT_FOUND
      // Attachment filenames follow the template's language, like the body did.
      const template = row.template_id ? await fetchTemplate(db, row.template_id, tenantId) : null
      const materialized = await materializeInvoiceAttachments(db, tenantId, invoice, {
        attachments: row.attachments,
        locale: template?.locale === 'en' ? 'en' : 'nl',
      })
      if (materialized.error) return materialized
      return { attachments: [
        ...materialized.files.map((file) => ({
          filename: file.filename, content: file.contentBase64, contentType: file.contentType,
        })),
        // Inline parts use the SDK's camelCase contentId (the REST field is
        // content_id) so cid: references in the body resolve.
        ...materialized.inline.map((file) => ({
          filename: file.filename, content: file.contentBase64, contentType: file.contentType,
          contentId: file.contentId,
        })),
      ] }
    },
  })
}
