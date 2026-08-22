// Seeded starting points for INVOICE-context templates. They reproduce the email
// the app used to hardcode, but as editable template content.
//
// Layout rules follow React Email's: tables only (no flex/grid — email clients
// don't support them), a ~600px container, explicit `border-solid` because
// clients don't inherit a border type, and no SVG/WEBP.
//
// Merge tokens are real editor nodes (mergeField / mergeBlock) rather than typed
// text, so they render as chips in the editor and survive re-serialization.
//
// No merge token sits inside a heading: the plain-text renderer uppercases
// h1-h6, which would emit {{INVOICE.NUMBER}} into body_text — a token that
// resolves against nothing.

const textNode = (text: string) => ({ type: 'text', text })
const mergeField = (fieldKey: string) => ({ type: 'mergeField', attrs: { fieldKey } })
const mergeBlock = (fieldKey: string, label: string) => ({ type: 'mergeBlock', attrs: { fieldKey, label } })

const paragraph = (content: Record<string, unknown>[], style: string) => ({
  type: 'paragraph', attrs: { style }, content,
})

interface InvoiceCopy {
  label: string
  description: string
  name: string
  subject: string
  messageLabel: string
  paymentLabel: string
  detailsNumber: string
  detailsDate: string
  questions: string
  signOff: string
}

const copy: Record<'nl' | 'en', InvoiceCopy> = {
  nl: {
    label: 'Factuurmail',
    description: 'Begeleidende e-mail bij een factuur, met factuurgegevens en betaallink.',
    name: 'Factuurmail',
    subject: 'Factuur {{invoice.number}} – {{band.name}}',
    messageLabel: 'Persoonlijk bericht',
    paymentLabel: 'Betaallink en QR-code',
    detailsNumber: 'Factuurnummer',
    detailsDate: 'Factuurdatum',
    questions: 'Mocht u vragen hebben omtrent deze factuur, neemt u dan gerust contact met ons op.',
    signOff: 'Met vriendelijke groet,',
  },
  en: {
    label: 'Invoice email',
    description: 'Covering email for an invoice, with invoice details and a payment link.',
    name: 'Invoice email',
    subject: 'Invoice {{invoice.number}} – {{band.name}}',
    messageLabel: 'Personal message',
    paymentLabel: 'Payment link and QR code',
    detailsNumber: 'Invoice number',
    detailsDate: 'Invoice date',
    questions: 'If you have any questions about this invoice, please do not hesitate to contact us.',
    signOff: 'Kind regards,',
  },
}

const INK = '#1a1a2e'
const BODY = '#333333'
const MUTED = '#888888'

function invoiceDoc(locale: 'nl' | 'en') {
  const c = copy[locale]
  return {
    type: 'doc',
    content: [{
      type: 'container',
      content: [
        {
          type: 'section',
          attrs: { style: `background-color:${INK};padding:24px 32px;` },
          content: [paragraph([mergeField('band.name')], 'color:#ffffff;font-size:22px;font-weight:bold;margin:0;')],
        },
        {
          type: 'section',
          attrs: { style: 'background-color:#ffffff;padding:32px;' },
          content: [
            paragraph([mergeField('customer.greeting')], `color:${BODY};font-size:15px;line-height:1.6;margin:0 0 18px;`),
            mergeBlock('message', c.messageLabel),
            // Deliberately NOT a heading: the plain-text renderer uppercases
            // h1-h6, which would turn {{invoice.number}} into an unmergeable
            // {{INVOICE.NUMBER}} in body_text.
            paragraph([textNode(`${c.detailsNumber}: `), mergeField('invoice.number')],
              `color:${INK};font-size:15px;font-weight:bold;margin:18px 0 4px;`),
            paragraph([textNode(`${c.detailsDate}: `), mergeField('invoice.issue_date')],
              `color:${MUTED};font-size:13px;margin:0 0 18px;`),
            mergeBlock('invoice.payment_block', c.paymentLabel),
            paragraph([textNode(c.questions)], `color:${BODY};font-size:15px;line-height:1.7;margin:18px 0 18px;`),
            paragraph([textNode(c.signOff)], `color:${BODY};font-size:15px;line-height:1.7;margin:0;`),
            paragraph([mergeField('band.name')], `color:${INK};font-size:15px;font-weight:bold;line-height:1.7;margin:0;`),
          ],
        },
      ],
    }],
  }
}

function invoiceHtml(locale: 'nl' | 'en') {
  const c = copy[locale]
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f4;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border:1px solid #dddddd;border-style:solid;">
      <tr><td style="background-color:${INK};padding:24px 32px;">
        <p style="margin:0;font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">{{band.name}}</p>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 18px;font-size:15px;color:${BODY};line-height:1.6;">{{customer.greeting}}</p>
        <div style="margin:0 0 18px;font-size:15px;color:${BODY};line-height:1.7;">{{#message}}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8f8f8;border-left:4px solid ${INK};border-style:solid;border-top:none;border-right:none;border-bottom:none;padding:16px 20px;margin:0 0 18px;">
          <tr><td>
            <p style="margin:0 0 2px;font-size:12px;color:${MUTED};">${c.detailsNumber}</p>
            <p style="margin:0 0 10px;font-size:17px;font-weight:bold;color:${INK};">{{invoice.number}}</p>
            <p style="margin:0 0 2px;font-size:12px;color:${MUTED};">${c.detailsDate}</p>
            <p style="margin:0;font-size:15px;color:${INK};">{{invoice.issue_date}}</p>
          </td></tr>
        </table>
        {{#invoice.payment_block}}
        <p style="margin:18px 0;font-size:15px;color:${BODY};line-height:1.7;">${c.questions}</p>
        <p style="margin:0;font-size:15px;color:${BODY};line-height:1.7;">${c.signOff}</p>
        <p style="margin:0;font-size:15px;font-weight:bold;color:${INK};line-height:1.7;">{{band.name}}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`
}

function invoiceText(locale: 'nl' | 'en') {
  const c = copy[locale]
  return [
    '{{customer.greeting}}',
    '{{#message}}',
    `${c.detailsNumber}: {{invoice.number}}`,
    `${c.detailsDate}: {{invoice.issue_date}}`,
    '{{invoice.payment_url}}',
    c.questions,
    c.signOff,
    '{{band.name}}',
  ].join('\n\n')
}

export function invoiceDefault(locale: 'nl' | 'en') {
  const c = copy[locale]
  return {
    label: c.label,
    description: c.description,
    subject: c.subject,
    doc: invoiceDoc(locale),
    bodyHtml: invoiceHtml(locale),
    bodyText: invoiceText(locale),
  }
}
