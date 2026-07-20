// Server-side i18n for the invoice PDF — deliberately SEPARATE from the client
// i18n in src/i18n. They serve different goals: the client localizes the app UI
// to the *user's* chosen language; this localizes a generated legal *document*
// to its recipient, with the language driven by the supplier's VAT country.
// Resources live under server/i18n/<lng>/invoice.json and are owned by the
// server alone (the client never imports them and vice versa).
//
// Language follows the SUPPLIER's VAT country: Dutch-speaking jurisdictions get
// a Dutch invoice, everyone else the international English invoice — the two
// languages the app maintains. Adding another is dropping in its
// server/i18n/<lng>/invoice.json and a COUNTRY_TO_LNG entry.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18next from 'i18next'
import { DEFAULT_VAT_COUNTRY, normalizeVatCountry } from '../../shared/vatRates.js'

const SUPPORTED_LNGS = ['en', 'nl']

function loadInvoiceNs(lng) {
  const rel = `server/i18n/${lng}/invoice.json`
  try {
    // Production: resolve relative to this module, independent of the cwd.
    return JSON.parse(readFileSync(new URL(`../i18n/${lng}/invoice.json`, import.meta.url), 'utf8'))
  } catch {
    // Test runner rewrites import.meta.url; fall back to the repo-root cwd.
    return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'))
  }
}

const instance = i18next.createInstance()
instance.init({
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LNGS,
  ns: ['invoice'],
  defaultNS: 'invoice',
  initImmediate: false, // synchronous init — resources are inline, no async backend
  interpolation: { escapeValue: false }, // PDF text, not HTML
  resources: Object.fromEntries(
    SUPPORTED_LNGS.map((lng) => [lng, { invoice: loadInvoiceNs(lng) }]),
  ),
})

// A supplier in NL (or Dutch-speaking Belgium) invoices in Dutch; every other
// supported VAT country invoices in English.
const COUNTRY_TO_LNG = { nl: 'nl', be: 'nl' }

export function resolveInvoiceLng(vatCountry) {
  const code = normalizeVatCountry(vatCountry) ?? DEFAULT_VAT_COUNTRY
  return COUNTRY_TO_LNG[code] || 'en'
}

// Intl locale used for money/date formatting in the resolved language.
const LNG_TO_INTL = { nl: 'nl-NL', en: 'en-IE' }

export function invoiceIntlLocale(lng) {
  return LNG_TO_INTL[lng] || 'en-IE'
}

// A `t` bound to the resolved language and the invoice document namespace.
export function getInvoiceT(lng) {
  return instance.getFixedT(SUPPORTED_LNGS.includes(lng) ? lng : 'en', 'invoice')
}
