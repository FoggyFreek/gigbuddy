import { escapeHtml } from '../../../../shared/outreachMerge.js'
import { getInvoiceEmailT } from '../../../utils/invoiceEmailI18n.js'

// The payment-link callout, with the QR referenced as a cid: image. The image
// part itself is materialized by the invoice email service (inline attachment
// for .eml/Resend, a data: URL for the preview) — this renderer only emits the
// markup, so all three surfaces share one layout.
export const QR_CONTENT_ID = 'qr-betaallink'

export function renderInvoicePaymentBlock({ invoice = {}, locale = 'nl', includeQr = true } = {}) {
  const url = invoice.mollie_payment_link_url
  if (!url) return ''
  const t = getInvoiceEmailT(locale)
  const safeUrl = escapeHtml(url)
  const number = escapeHtml(invoice.invoice_number ?? '')
  const qrCell = includeQr ? `
            <td style="vertical-align:top;text-align:center;padding-left:24px;min-width:144px;width:144px;">
              <img src="cid:${QR_CONTENT_ID}" alt="${escapeHtml(t('payment.qrAlt'))}" width="120" height="120"
                   style="display:block;border:1px solid #dddddd;padding:4px;background:#ffffff;margin:0 auto;" />
              <p style="margin:6px 0 0 0;font-size:11px;color:#888888;text-align:center;">${escapeHtml(t('payment.qrCaption'))}</p>
            </td>` : ''
  return `
                    <table cellpadding="0" cellspacing="0" border="0" width="100%"
                           style="background:#f0f4ff;border:1px solid #c8d4f0;border-radius:3px;padding:20px;">
                      <tr>
                        <td style="vertical-align:top;">
                          <p style="margin:0 0 6px 0;font-size:13px;font-weight:bold;color:#1a1a2e;">${escapeHtml(t('payment.title'))}</p>
                          <p style="margin:0 0 14px 0;font-size:14px;color:#333333;line-height:1.6;">
                            ${escapeHtml(t('payment.intro'))}
                          </p>
                          <p style="margin:0 0 10px 0;">
                            <a href="${safeUrl}"
                               style="display:inline-block;padding:10px 22px;background:#1a1a2e;color:#ffffff;
                                      text-decoration:none;font-size:14px;font-weight:bold;border-radius:3px;">
                              ${escapeHtml(t('payment.button', { number }))}
                            </a>
                          </p>
                          <p style="margin:0;font-size:12px;color:#888888;word-break:break-all;">${safeUrl}</p>
                        </td>${qrCell}
                      </tr>
                    </table>`
}

// The custom message the sender typed. Escaped first, then newlines become real
// line breaks — it must go through the BLOCK path, because the inline path
// escapes the markup this renderer produces.
export function renderMessageBlock({ message = '' } = {}) {
  const text = String(message ?? '').trim()
  if (!text) return ''
  return escapeHtml(text).replaceAll('\n', '<br>')
}
