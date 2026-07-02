import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// English is the canonical key shape that drives the TypeScript selector types
// (see i18next.d.ts). Group strings by concern, one namespace per file. `common`
// holds reused labels; `navigation` is the app-shell chrome; the rest are one
// namespace per view/feature, seeded for now and filled as strings are extracted.
import enCommon from './en/common.json'
import enNavigation from './en/navigation.json'
import enGlossary from './en/glossary.json'
import enValidation from './en/validation.json'
import enDashboard from './en/dashboard.json'
import enFinancialDashboard from './en/financialDashboard.json'
import enProfile from './en/profile.json'
import enAvailability from './en/availability.json'
import enGigs from './en/gigs.json'
import enRehearsals from './en/rehearsals.json'
import enBandEvents from './en/bandEvents.json'
import enTasks from './en/tasks.json'
import enSongs from './en/songs.json'
import enSetlists from './en/setlists.json'
import enContacts from './en/contacts.json'
import enSuppliers from './en/suppliers.json'
import enVenues from './en/venues.json'
import enEmailTemplates from './en/emailTemplates.json'
import enInvoices from './en/invoices.json'
import enPurchases from './en/purchases.json'
import enMerch from './en/merch.json'
import enReimbursements from './en/reimbursements.json'
import enJournal from './en/journal.json'
import enLedger from './en/ledger.json'
import enVatReturns from './en/vatReturns.json'
import enReports from './en/reports.json'
import enSettings from './en/settings.json'
import enAuth from './en/auth.json'
import enNotifications from './en/notifications.json'

import nlCommon from './nl/common.json'
import nlNavigation from './nl/navigation.json'
import nlGlossary from './nl/glossary.json'
import nlValidation from './nl/validation.json'
import nlDashboard from './nl/dashboard.json'
import nlFinancialDashboard from './nl/financialDashboard.json'
import nlProfile from './nl/profile.json'
import nlAvailability from './nl/availability.json'
import nlGigs from './nl/gigs.json'
import nlRehearsals from './nl/rehearsals.json'
import nlBandEvents from './nl/bandEvents.json'
import nlTasks from './nl/tasks.json'
import nlSongs from './nl/songs.json'
import nlSetlists from './nl/setlists.json'
import nlContacts from './nl/contacts.json'
import nlSuppliers from './nl/suppliers.json'
import nlVenues from './nl/venues.json'
import nlEmailTemplates from './nl/emailTemplates.json'
import nlInvoices from './nl/invoices.json'
import nlPurchases from './nl/purchases.json'
import nlMerch from './nl/merch.json'
import nlReimbursements from './nl/reimbursements.json'
import nlJournal from './nl/journal.json'
import nlLedger from './nl/ledger.json'
import nlVatReturns from './nl/vatReturns.json'
import nlReports from './nl/reports.json'
import nlSettings from './nl/settings.json'
import nlAuth from './nl/auth.json'
import nlNotifications from './nl/notifications.json'

export const defaultNS = 'common'

const en = {
  common: enCommon,
  navigation: enNavigation,
  glossary: enGlossary,
  validation: enValidation,
  dashboard: enDashboard,
  financialDashboard: enFinancialDashboard,
  profile: enProfile,
  availability: enAvailability,
  gigs: enGigs,
  rehearsals: enRehearsals,
  bandEvents: enBandEvents,
  tasks: enTasks,
  songs: enSongs,
  setlists: enSetlists,
  contacts: enContacts,
  suppliers: enSuppliers,
  venues: enVenues,
  emailTemplates: enEmailTemplates,
  invoices: enInvoices,
  purchases: enPurchases,
  merch: enMerch,
  reimbursements: enReimbursements,
  journal: enJournal,
  ledger: enLedger,
  vatReturns: enVatReturns,
  reports: enReports,
  settings: enSettings,
  auth: enAuth,
  notifications: enNotifications,
} as const

// Compile-time Dutch parity guard. `DeepKeyShape` turns the canonical English
// resource into a type requiring every key (with string leaves): a *missing* nl
// key fails the mapped-type requirement, and a *stray* nl key trips the
// `satisfies` excess-property check. Both surface as `npm run type-check` errors,
// because i18next.d.ts only types the selector against the English shape and would
// otherwise let nl drift silently.
type DeepKeyShape<T> = { [K in keyof T]: T[K] extends string ? string : DeepKeyShape<T[K]> }

const nl = {
  common: nlCommon,
  navigation: nlNavigation,
  glossary: nlGlossary,
  validation: nlValidation,
  dashboard: nlDashboard,
  financialDashboard: nlFinancialDashboard,
  profile: nlProfile,
  availability: nlAvailability,
  gigs: nlGigs,
  rehearsals: nlRehearsals,
  bandEvents: nlBandEvents,
  tasks: nlTasks,
  songs: nlSongs,
  setlists: nlSetlists,
  contacts: nlContacts,
  suppliers: nlSuppliers,
  venues: nlVenues,
  emailTemplates: nlEmailTemplates,
  invoices: nlInvoices,
  purchases: nlPurchases,
  merch: nlMerch,
  reimbursements: nlReimbursements,
  journal: nlJournal,
  ledger: nlLedger,
  vatReturns: nlVatReturns,
  reports: nlReports,
  settings: nlSettings,
  auth: nlAuth,
  notifications: nlNotifications,
} satisfies DeepKeyShape<typeof en>

export const resources = { en, nl } as const

export const supportedLngs = ['en', 'nl'] as const

void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    fallbackLng: 'en',
    supportedLngs,
    // React escapes interpolated values on render, so i18next must not double-escape.
    // Only reach for the unescape form (`{{- var}}`) on values already sanitized
    // (same DOMPurify discipline as the ChordPro path).
    interpolation: { escapeValue: false },
    detection: {
      // Persist the user's choice; fall back to the browser language on first visit.
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'gigbuddy_lang',
    },
  })

export default i18next
