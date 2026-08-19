// Language selection for the invoice PDF. The document-i18n machinery itself
// (resource loading, the i18next instance, Intl locales) is shared with the
// other generated documents in server/utils/documentI18n.js; what is
// invoice-specific — and lives here — is that the language follows the
// SUPPLIER's VAT country rather than any user preference: Dutch-speaking
// jurisdictions get a Dutch invoice, everyone else the international English
// one. Adding another is dropping in its server/i18n/<lng>/invoice.json and a
// COUNTRY_TO_LNG entry.
import { createDocumentI18n, documentIntlLocale } from './documentI18n.js'
import { DEFAULT_VAT_COUNTRY, normalizeVatCountry } from '../../shared/vatRates.js'

const getT = createDocumentI18n('invoice')

// A supplier in NL (or Dutch-speaking Belgium) invoices in Dutch; every other
// supported VAT country invoices in English.
const COUNTRY_TO_LNG = { nl: 'nl', be: 'nl' }

export function resolveInvoiceLng(vatCountry) {
  const code = normalizeVatCountry(vatCountry) ?? DEFAULT_VAT_COUNTRY
  return COUNTRY_TO_LNG[code] || 'en'
}

// Intl locale used for money/date formatting in the resolved language.
export function invoiceIntlLocale(lng) {
  return documentIntlLocale(lng)
}

// A `t` bound to the resolved language and the invoice document namespace.
export function getInvoiceT(lng) {
  return getT(lng)
}
