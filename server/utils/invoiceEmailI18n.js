// Strings for the invoice EMAIL — separate from server/utils/invoiceI18n.js,
// which is bound to the `invoice` namespace (the statutory PDF) and picks its
// language from the supplier's VAT country. An email's language follows the
// TEMPLATE the user picked instead, so this module takes an explicit lng.
//
// CAUTION: createDocumentI18n sets interpolation.escapeValue = false because its
// output is normally PDF text. These strings become HTML, so every interpolated
// value must already be escaped by the caller.
import { createDocumentI18n } from './documentI18n.js'

const getT = createDocumentI18n('invoiceEmail')

export function getInvoiceEmailT(lng) {
  return getT(lng)
}
