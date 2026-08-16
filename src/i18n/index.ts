import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// English is the canonical key shape that drives the TypeScript selector types
// (see i18next.d.ts). Group strings by concern, one namespace per file. `common`
// holds reused labels; `navigation` is the app-shell chrome; the rest are one
// namespace per view/feature, seeded for now and filled as strings are extracted.
import enAchievements from '../user/achievements/i18n/en.json'
import enCommon from './en/common.json'
import enNavigation from './en/navigation.json'
import enGlossary from './en/glossary.json'
import enValidation from './en/validation.json'
import enDashboard from '../app/dashboard/i18n/en.json'
import enFinancialDashboard from '../finance/reports/i18n/en/financialDashboard.json'
import enProfile from '../people/profiles/i18n/en/profile.json'
import enAvailability from '../planning/availability/i18n/en.json'
import enGigs from '../planning/gigs/i18n/en.json'
import enRehearsals from '../planning/rehearsals/i18n/en.json'
import enBandEvents from '../planning/events/i18n/en.json'
import enTasks from '../planning/tasks/i18n/en.json'
import enSongs from '../music/songs/i18n/en.json'
import enSetlists from '../music/setlists/i18n/en.json'
import enContacts from '../people/contacts/i18n/en/contacts.json'
import enSuppliers from '../people/contacts/i18n/en/suppliers.json'
import enVenues from '../people/venues/i18n/en/venues.json'
import enPlaces from '../people/venues/i18n/en/places.json'
import enEmailTemplates from '../people/profiles/i18n/en/emailTemplates.json'
import enInvoices from '../finance/invoices/i18n/en.json'
import enPurchases from '../finance/purchases/i18n/en.json'
import enMerch from '../commerce/merch/i18n/en.json'
import enMyBands from '../people/my-bands/i18n/en.json'
import enReimbursements from '../finance/reimbursements/i18n/en.json'
import enJournal from '../finance/journal/i18n/en.json'
import enLedger from '../finance/ledger/i18n/en.json'
import enVatReturns from '../finance/vat/i18n/en.json'
import enReports from '../finance/reports/i18n/en/reports.json'
import enSettings from '../people/workspaces/i18n/en.json'
import enAuth from '../user/identity/i18n/en/auth.json'
import enNotifications from '../user/notifications/i18n/en.json'
import enBilling from '../commerce/billing/i18n/en.json'
import enOnboarding from '../user/identity/i18n/en/onboarding.json'
import enFinanceOnboarding from '../finance/onboarding/i18n/en.json'
import enTutorials from '../user/tutorials/i18n/en.json'
import enAdminOperations from '../admin/operations/i18n/en.json'

import nlAchievements from '../user/achievements/i18n/nl.json'
import nlCommon from './nl/common.json'
import nlNavigation from './nl/navigation.json'
import nlGlossary from './nl/glossary.json'
import nlValidation from './nl/validation.json'
import nlDashboard from '../app/dashboard/i18n/nl.json'
import nlFinancialDashboard from '../finance/reports/i18n/nl/financialDashboard.json'
import nlProfile from '../people/profiles/i18n/nl/profile.json'
import nlAvailability from '../planning/availability/i18n/nl.json'
import nlGigs from '../planning/gigs/i18n/nl.json'
import nlRehearsals from '../planning/rehearsals/i18n/nl.json'
import nlBandEvents from '../planning/events/i18n/nl.json'
import nlTasks from '../planning/tasks/i18n/nl.json'
import nlSongs from '../music/songs/i18n/nl.json'
import nlSetlists from '../music/setlists/i18n/nl.json'
import nlContacts from '../people/contacts/i18n/nl/contacts.json'
import nlSuppliers from '../people/contacts/i18n/nl/suppliers.json'
import nlVenues from '../people/venues/i18n/nl/venues.json'
import nlPlaces from '../people/venues/i18n/nl/places.json'
import nlEmailTemplates from '../people/profiles/i18n/nl/emailTemplates.json'
import nlInvoices from '../finance/invoices/i18n/nl.json'
import nlPurchases from '../finance/purchases/i18n/nl.json'
import nlMerch from '../commerce/merch/i18n/nl.json'
import nlMyBands from '../people/my-bands/i18n/nl.json'
import nlReimbursements from '../finance/reimbursements/i18n/nl.json'
import nlJournal from '../finance/journal/i18n/nl.json'
import nlLedger from '../finance/ledger/i18n/nl.json'
import nlVatReturns from '../finance/vat/i18n/nl.json'
import nlReports from '../finance/reports/i18n/nl/reports.json'
import nlSettings from '../people/workspaces/i18n/nl.json'
import nlAuth from '../user/identity/i18n/nl/auth.json'
import nlNotifications from '../user/notifications/i18n/nl.json'
import nlBilling from '../commerce/billing/i18n/nl.json'
import nlOnboarding from '../user/identity/i18n/nl/onboarding.json'
import nlFinanceOnboarding from '../finance/onboarding/i18n/nl.json'
import nlTutorials from '../user/tutorials/i18n/nl.json'
import nlAdminOperations from '../admin/operations/i18n/nl.json'

export const defaultNS = 'common'

const en = {
  achievements: enAchievements,
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
  places: enPlaces,
  emailTemplates: enEmailTemplates,
  invoices: enInvoices,
  purchases: enPurchases,
  merch: enMerch,
  myBands: enMyBands,
  reimbursements: enReimbursements,
  journal: enJournal,
  ledger: enLedger,
  vatReturns: enVatReturns,
  reports: enReports,
  settings: enSettings,
  auth: enAuth,
  notifications: enNotifications,
  billing: enBilling,
  onboarding: enOnboarding,
  financeOnboarding: enFinanceOnboarding,
  tutorials: enTutorials,
  adminOperations: enAdminOperations,
} as const

// Compile-time Dutch parity guard. `DeepKeyShape` turns the canonical English
// resource into a type requiring every key (with string leaves): a *missing* nl
// key fails the mapped-type requirement, and a *stray* nl key trips the
// `satisfies` excess-property check. Both surface as `npm run type-check` errors,
// because i18next.d.ts only types the selector against the English shape and would
// otherwise let nl drift silently.
type DeepKeyShape<T> = { [K in keyof T]: T[K] extends string ? string : DeepKeyShape<T[K]> }

const nl = {
  achievements: nlAchievements,
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
  places: nlPlaces,
  emailTemplates: nlEmailTemplates,
  invoices: nlInvoices,
  purchases: nlPurchases,
  merch: nlMerch,
  myBands: nlMyBands,
  reimbursements: nlReimbursements,
  journal: nlJournal,
  ledger: nlLedger,
  vatReturns: nlVatReturns,
  reports: nlReports,
  settings: nlSettings,
  auth: nlAuth,
  notifications: nlNotifications,
  billing: nlBilling,
  onboarding: nlOnboarding,
  financeOnboarding: nlFinanceOnboarding,
  tutorials: nlTutorials,
  adminOperations: nlAdminOperations,
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
