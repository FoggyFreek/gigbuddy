// Builds the invoice email from an outreach TEMPLATE (context 'invoice'), and
// assembles the .eml for download. Content resolution is shared by the preview,
// the .eml and the Resend send so the three cannot drift; attachments are
// materialized separately, because the preview must not fetch the stored PDF on
// every keystroke and cid: cannot resolve inside a preview iframe.
import QRCode from 'qrcode'
import { getObject } from '../../platform/files/storageService.js'
import { fetchInvoiceWithGig } from './invoiceRepository.js'
import { fetchProfileTenant } from '../../people/profiles/profileRepository.js'
import { listTemplates, fetchTemplate } from '../../promotion/outreach/templateRepository.js'
import { resolveOutreachRawValues } from '../../promotion/outreach/fields/resolvers.js'
import { formatOutreachValue } from '../../promotion/outreach/fields/formatters.js'
import { renderOutreachBlocks } from '../../promotion/outreach/blocks/index.js'
import { QR_CONTENT_ID } from '../../promotion/outreach/blocks/invoicePayment.js'
import { buildInvoiceUbl } from './invoiceUblService.js'
import { OUTREACH_FIELDS } from '../../../shared/outreachFields.js'
import { extractTokens, mergeBlocks, mergeTokens } from '../../../shared/outreachMerge.js'
import { TEMPLATE_CONTEXTS } from '../../../shared/outreachContexts.js'
import { getInvoiceEmailT } from '../../utils/invoiceEmailI18n.js'
import { logger } from '../../utils/logger.js'
import { EMAIL_RE } from '../../utils/email.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'

const NOT_FOUND = notFound('Not found')
const TEMPLATE_LIST_LIMIT = 100

export const ATTACHMENT_MODES = Object.freeze(['pdf', 'pdf_xml', 'pdf_xml_embedded'])
export const isAttachmentMode = (value) => ATTACHMENT_MODES.includes(value)

function wrapBase64Lines(str) {
  return str.match(/.{1,76}/g).join('\r\n')
}

// RFC 5322 "specials" that force a display name to be quoted or MIME-encoded.
const HEADER_ADDR_SPECIALS_RE = /[()<>[\]:;@\\,."]/

function stripHeaderControlChars(value) {
  // Drop CR, LF, and other C0 control chars so user fields can't inject headers.
  // eslint-disable-next-line no-control-regex -- matching control chars is the intent
  return String(value ?? '').replaceAll(/[\u0000-\u001f\u007f]/g, '').trim()
}

function encodeDisplayName(rawName) {
  const name = stripHeaderControlChars(rawName)
  if (!name) return ''
  const isAscii = /^[ -~]*$/.test(name)
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
  if (!EMAIL_RE.test(cleanEmail)) return ''
  const display = encodeDisplayName(name)
  return display ? `${display} <${cleanEmail}>` : cleanEmail
}

const safeNumber = (invoice) => String(invoice.invoice_number || 'concept').replaceAll(/[^a-zA-Z0-9-]/g, '-')

function greetingFor(invoice, t) {
  const familyName = invoice.customer_contact_family_name || ''
  if (!familyName) return t('greeting.fallback')
  const title = invoice.customer_contact_title ? `${invoice.customer_contact_title} ` : ''
  return t('greeting.named', { title, familyName })
}

export function defaultInvoiceMessage({ bandName, gigDate, locale }) {
  const t = getInvoiceEmailT(locale)
  const gigPart = gigDate ? t('gigPart', { band: bandName, date: gigDate }) : ''
  return t('defaultMessage', { gigPart })
}

async function pickTemplate(db, tenantId, templateId) {
  if (templateId) {
    const template = await fetchTemplate(db, templateId, tenantId)
    if (!template || template.context !== TEMPLATE_CONTEXTS.INVOICE) return null
    return template
  }
  const rows = await listTemplates(db, tenantId, TEMPLATE_LIST_LIMIT, TEMPLATE_CONTEXTS.INVOICE)
  if (!rows.length) return null
  return fetchTemplate(db, rows[0].id, tenantId)
}

function formatValues(raw, locale) {
  return Object.fromEntries(OUTREACH_FIELDS.filter((field) => !field.block).map((field) => [field.key,
    formatOutreachValue(raw[field.key], field.format, { locale })]))
}

// The pure content half: no object storage, no PDF, no QR bytes.
export async function resolveInvoiceEmailContent(db, tenantId, invoiceId, options = {}) {
  const invoice = await fetchInvoiceWithGig(db, tenantId, invoiceId)
  if (!invoice) return NOT_FOUND
  const tenant = await fetchProfileTenant(db, tenantId)
  if (!tenant) return NOT_FOUND
  const template = await pickTemplate(db, tenantId, options.templateId)
  if (!template) {
    return badRequest('No invoice email template is available', { code: 'invoice_template_missing' })
  }

  const locale = template.locale === 'en' ? 'en' : 'nl'
  const t = getInvoiceEmailT(locale)
  const bandName = tenant.formal_name || tenant.display_name || tenant.band_name || ''
  const customer = {
    name: invoice.customer_name,
    email: invoice.customer_email,
    contact_title: invoice.customer_contact_title,
    contact_family_name: invoice.customer_contact_family_name,
    greeting: greetingFor(invoice, t),
  }
  const raw = resolveOutreachRawValues({ tenant, invoice, customer }, { locale })
  const values = formatValues(raw, locale)

  const message = options.message === undefined || options.message === null
    ? defaultInvoiceMessage({ bandName, gigDate: values['invoice.event_date'], locale })
    : String(options.message).slice(0, 4000)

  const source = `${template.subject}\n${template.body_html}\n${template.body_text}`
  const blockKeys = extractTokens(source).filter((token) => token.startsWith('#')).map((token) => token.slice(1))
  const blocks = renderOutreachBlocks(blockKeys, {
    tenant, invoice, locale, message, includeQr: options.includeQr !== false,
  })
  const resolvedFields = { ...values, ...blocks }

  const subject = mergeTokens(template.subject, values)
    || t('subject', { number: invoice.invoice_number ?? '', band: bandName })
  const html = mergeBlocks(mergeTokens(template.body_html, values, { escape: true }), blocks)
  const text = mergeBlocks(mergeTokens(template.body_text, values), { ...blocks, message })
  const cleanEmail = stripHeaderControlChars(invoice.customer_email)

  return { content: {
    invoice, template, locale, subject, html, text, message, resolvedFields,
    toAddress: formatHeaderAddress(invoice.customer_name, invoice.customer_email),
    toEmail: EMAIL_RE.test(cleanEmail) ? cleanEmail : '',
    toName: invoice.customer_name ?? null,
    hasPaymentLink: Boolean(invoice.mollie_payment_link_url),
  } }
}

async function renderQrBase64(url) {
  try {
    const buffer = await QRCode.toBuffer(url, { type: 'png', width: 200, margin: 1 })
    return buffer.toString('base64')
  } catch (err) {
    logger.warn('invoice_email.qr_generation_failed', { err })
    return null
  }
}

async function loadPdfBase64(invoice) {
  if (!invoice.pdf_path) return null
  try {
    const stream = await getObject(invoice.pdf_path)
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks).toString('base64')
  } catch (err) {
    logger.warn('invoice_email.pdf_fetch_failed', { err })
    return null
  }
}

// The attachment half. An invoice email without its invoice is never acceptable,
// so a missing or unreadable PDF is a hard error rather than a silent omission.
export async function materializeInvoiceAttachments(db, tenantId, invoice, { attachments = 'pdf', locale = 'nl' } = {}) {
  const t = getInvoiceEmailT(locale)
  const number = safeNumber(invoice)
  const pdfBase64 = await loadPdfBase64(invoice)
  if (!pdfBase64) {
    return conflict('The invoice PDF is not available. Re-generate it and try again.', { code: 'invoice_pdf_unavailable' })
  }
  const files = [{
    filename: t('file.pdf', { number }),
    contentType: 'application/pdf',
    contentBase64: pdfBase64,
  }]
  if (attachments !== 'pdf') {
    const ubl = await buildInvoiceUbl(db, tenantId, invoice.id, { embedPdf: attachments === 'pdf_xml_embedded' })
    if (ubl.error) return ubl
    files.push({
      filename: t('file.xml', { number }),
      contentType: 'application/xml',
      contentBase64: Buffer.from(ubl.content, 'utf8').toString('base64'),
    })
  }
  const inline = []
  if (invoice.mollie_payment_link_url) {
    const qrBase64 = await renderQrBase64(invoice.mollie_payment_link_url)
    if (qrBase64) {
      inline.push({
        filename: `${QR_CONTENT_ID}.png`, contentType: 'image/png',
        contentBase64: qrBase64, contentId: QR_CONTENT_ID,
      })
    }
  }
  return { files, inline }
}

// Pre-filled defaults for the email compose dialog.
export async function getInvoiceEmailDefaults(db, tenantId, invoiceId) {
  const invoice = await fetchInvoiceWithGig(db, tenantId, invoiceId)
  if (!invoice) return NOT_FOUND
  const tenant = await fetchProfileTenant(db, tenantId)
  if (!tenant) return NOT_FOUND
  const templates = await listTemplates(db, tenantId, TEMPLATE_LIST_LIMIT, TEMPLATE_CONTEXTS.INVOICE)
  const locale = templates[0]?.locale === 'en' ? 'en' : 'nl'
  const bandName = tenant.formal_name || tenant.display_name || tenant.band_name || ''
  const gigDate = formatOutreachValue(invoice.event_date, 'date', { locale })
  return {
    defaults: {
      templates: templates.map((row) => ({ id: row.id, name: row.name, locale: row.locale })),
      message: defaultInvoiceMessage({ bandName, gigDate, locale }),
      to: invoice.customer_email ?? null,
      status: invoice.status,
    },
  }
}

// Preview: same content, QR inlined as a data: URL because cid: cannot resolve
// in the preview iframe, and the PDF is deliberately not fetched.
export async function previewInvoiceEmail(db, tenantId, invoiceId, options = {}) {
  const resolved = await resolveInvoiceEmailContent(db, tenantId, invoiceId, options)
  if (resolved.error) return resolved
  const { subject, html, invoice } = resolved.content
  if (!invoice.mollie_payment_link_url || !html.includes(`cid:${QR_CONTENT_ID}`)) {
    return { preview: { subject, html } }
  }
  const qrBase64 = await renderQrBase64(invoice.mollie_payment_link_url)
  return { preview: {
    subject,
    html: qrBase64 ? html.replaceAll(`cid:${QR_CONTENT_ID}`, `data:image/png;base64,${qrBase64}`) : html,
  } }
}

function mimePart(file) {
  return [
    `Content-Type: ${file.contentType}; name="${file.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${file.filename}"`,
    '',
    wrapBase64Lines(file.contentBase64),
  ].join('\r\n')
}

// Generates the .eml (multipart MIME with inline QR and the chosen attachments).
export async function buildInvoiceEml(db, tenantId, invoiceId, options = {}) {
  const attachments = options.attachments ?? 'pdf'
  if (!isAttachmentMode(attachments)) return badRequest('Invalid attachments option')
  const resolved = await resolveInvoiceEmailContent(db, tenantId, invoiceId, options)
  if (resolved.error) return resolved
  const { invoice, subject, html, toAddress, locale } = resolved.content

  const materialized = await materializeInvoiceAttachments(db, tenantId, invoice, { attachments, locale })
  if (materialized.error) return materialized

  const htmlBase64 = Buffer.from(html, 'utf8').toString('base64')
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
  const ts = Date.now()
  const relatedBoundary = `----=_Related_GigBuddy_${ts}`
  const mixedBoundary = `----=_Mixed_GigBuddy_${ts}`

  const bodySection = materialized.inline.length
    ? [
        `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
        '',
        `--${relatedBoundary}`,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64Lines(htmlBase64),
        '',
        ...materialized.inline.flatMap((file) => [
          `--${relatedBoundary}`,
          `Content-Type: ${file.contentType}; name="${file.filename}"`,
          'Content-Transfer-Encoding: base64',
          `Content-ID: <${file.contentId}>`,
          `Content-Disposition: inline; filename="${file.filename}"`,
          '',
          wrapBase64Lines(file.contentBase64),
          '',
        ]),
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
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <invoice-${invoiceId}-${ts}@gigbuddy>`,
    'X-Unsent: 1',
    ...(toAddress ? [`To: ${toAddress}`] : []),
    `Subject: ${encodedSubject}`,
  ]

  const emlContent = [
    ...outerHeaders,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    bodySection,
    '',
    ...materialized.files.flatMap((file) => [`--${mixedBoundary}`, mimePart(file), '']),
    `--${mixedBoundary}--`,
  ].join('\r\n')

  const t = getInvoiceEmailT(locale)
  return { filename: t('file.eml', { number: safeNumber(invoice) }), content: emlContent }
}
