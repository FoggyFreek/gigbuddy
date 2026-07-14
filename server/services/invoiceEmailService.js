// Builds the invoice email (.eml) and its compose-dialog defaults. Split from
// invoiceService.js to keep the MIME/HTML assembly out of the domain service.
import QRCode from 'qrcode'
import { getObject } from './storageService.js'
import { fetchInvoiceWithGig } from '../repositories/invoiceRepository.js'
import { fetchTenant } from '../repositories/tenantRepository.js'
import { logger } from '../utils/logger.js'
import { notFound } from './serviceErrors.js'

const NOT_FOUND = notFound('Not found')

function escHtml(str) {
  if (!str) return ''
  return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
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
  return `Hartelijk dank voor de prettige samenwerking${gigPart}.\n\nIn de bijlage vindt u onze factuur.`
}

function buildEmailHtml({ bandName, invoiceNumber, issueDate, gigDate, greeting, personalMessage, paymentSectionHtml }) {
  const personalHtml = escHtml(personalMessage).replaceAll('\n', '<br>')
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
                          <p style="margin:6px;font-size:12px;color:#888888;">Factuurnummer</p>
                          <p style="margin:6px;font-size:17px;font-weight:bold;color:#1a1a2e;">${escHtml(invoiceNumber)}</p>
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

// RFC 5322 "specials" that force a display name to be quoted or MIME-encoded.
const HEADER_ADDR_SPECIALS_RE = /[()<>[\]:;@\\,."]/
// Conservative email check: no whitespace/control chars, a single @, a dotted domain.
const HEADER_EMAIL_RE = /^[^\s@<>]+@[^.\s@<>]+(?:\.[^.\s@<>]+)+$/

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
  if (!HEADER_EMAIL_RE.test(cleanEmail)) return ''
  const display = encodeDisplayName(name)
  return display ? `${display} <${cleanEmail}>` : cleanEmail
}

async function resolveEmlData(pool, tenantId, invoiceId) {
  const invoice = await fetchInvoiceWithGig(pool, tenantId, invoiceId)
  if (!invoice) return null
  const tenant = await fetchTenant(pool, tenantId)
  if (!tenant) return null

  const fmtNl = (d) =>
    d ? new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  const gigDate   = fmtNl(invoice.event_date)
  const issueDate = fmtNl(invoice.issue_date)
  const bandName  = tenant.formal_name || tenant.band_name || ''
  const invoiceNumber = invoice.invoice_number || 'concept'

  const subjectDate = gigDate || issueDate || ''
  const subjectVenue = invoice.event_description ? ` – ${invoice.event_description}` : ''
  const subjectDateSuffix = subjectDate ? ` – ${subjectDate}` : ''
  const subject = `Factuur ${invoiceNumber} – ${bandName}${subjectDateSuffix}${subjectVenue}`

  const titlePart  = invoice.customer_contact_title ? `${invoice.customer_contact_title} ` : ''
  const familyName = invoice.customer_contact_family_name || ''
  const greeting   = familyName ? `Geachte ${titlePart}${familyName},` : 'Geachte heer/mevrouw,'

  const toAddress = formatHeaderAddress(invoice.customer_name, invoice.customer_email)

  return { invoice, tenant, bandName, invoiceNumber, gigDate, issueDate, subject, greeting, toAddress }
}

// Pre-filled defaults for the email compose dialog. Returns { error } | { defaults }.
export async function getEmlDefaults(pool, tenantId, invoiceId) {
  const data = await resolveEmlData(pool, tenantId, invoiceId)
  if (!data) return NOT_FOUND
  const { bandName, gigDate, subject, greeting, toAddress } = data
  return {
    defaults: {
      subject,
      to: toAddress,
      greeting,
      personalMessage: defaultPersonalMessage(bandName, gigDate),
    },
  }
}

// Generates the .eml content (multipart MIME with inline QR and PDF attachment).
// Returns { error } | { filename, content }.
export async function buildInvoiceEml(pool, tenantId, invoiceId, rawPersonalMessage) {
  const data = await resolveEmlData(pool, tenantId, invoiceId)
  if (!data) return NOT_FOUND

  const { invoice, bandName, invoiceNumber, gigDate, issueDate, subject, greeting, toAddress } = data
  const personalMessage = String(rawPersonalMessage || defaultPersonalMessage(bandName, gigDate)).slice(0, 4000)
  const safeNumber = invoiceNumber.replaceAll(/[^a-zA-Z0-9-]/g, '-')

  const hasPaymentLink = Boolean(invoice.mollie_payment_link_url)
  let qrBase64 = null
  if (hasPaymentLink) {
    try {
      const qrBuffer = await QRCode.toBuffer(invoice.mollie_payment_link_url, { type: 'png', width: 200, margin: 1 })
      qrBase64 = qrBuffer.toString('base64')
    } catch (err) {
      logger.warn('invoice_email.qr_generation_failed', { err })
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
      const stream = await getObject(invoice.pdf_path)
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      pdfBase64 = Buffer.concat(chunks).toString('base64')
    } catch (err) {
      logger.warn('invoice_email.pdf_fetch_failed', { err })
    }
  }

  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
  const dateHeader = new Date().toUTCString()
  const msgId = `<invoice-${invoiceId}-${Date.now()}@gigbuddy>`
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

  return { filename: `factuur-${safeNumber}.eml`, content: emlContent }
}
