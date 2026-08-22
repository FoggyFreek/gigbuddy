// Server-side i18n for GENERATED DOCUMENTS (the invoice PDF, the gig itinerary
// PDF, …) — deliberately SEPARATE from the client i18n in src/i18n. They serve
// different goals: the client localizes the app UI, this localizes a rendered
// file whose language is decided per document. Resources live under
// server/i18n/<lng>/<namespace>.json and are owned by the server alone (the
// client never imports them and vice versa).
//
// Each document namespace calls createDocumentI18n() once at module load; the
// resources are inline JSON, so init is synchronous and there is no backend.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18next from 'i18next'

// The two languages the app maintains. Adding another is dropping in its
// server/i18n/<lng>/<namespace>.json files and listing it here.
export const DOCUMENT_LNGS = Object.freeze(['en', 'nl'])

// Intl locale used for money/date formatting in each language.
const LNG_TO_INTL = { nl: 'nl-NL', en: 'en-IE' }

export function documentIntlLocale(lng) {
  return LNG_TO_INTL[lng] || LNG_TO_INTL.en
}

// Falls back to English for anything unsupported, so a bad ?lng= is a
// language choice we ignore rather than an error.
export function normalizeDocumentLng(value) {
  const lng = String(value ?? '').trim().toLowerCase().slice(0, 2)
  return DOCUMENT_LNGS.includes(lng) ? lng : 'en'
}

function loadNamespace(lng, ns) {
  const rel = `server/i18n/${lng}/${ns}.json`
  try {
    // Production: resolve relative to this module, independent of the cwd.
    return JSON.parse(readFileSync(new URL(`../i18n/${lng}/${ns}.json`, import.meta.url), 'utf8'))
  } catch {
    // Test runner rewrites import.meta.url; fall back to the repo-root cwd.
    return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'))
  }
}

// Returns a `getT(lng)` bound to one document namespace across every supported
// language. Interpolation is unescaped: these strings become PDF text, not HTML.
export function createDocumentI18n(ns) {
  const instance = i18next.createInstance()
  instance.init({
    fallbackLng: 'en',
    supportedLngs: DOCUMENT_LNGS,
    ns: [ns],
    defaultNS: ns,
    initImmediate: false, // synchronous init — resources are inline, no async backend
    interpolation: { escapeValue: false },
    resources: Object.fromEntries(
      DOCUMENT_LNGS.map((lng) => [lng, { [ns]: loadNamespace(lng, ns) }]),
    ),
  })
  return (lng) => instance.getFixedT(normalizeDocumentLng(lng), ns)
}
