// THE COUNTRY PACK ENTRY POINT — start here when adding jurisdiction behavior.
//
// A "country pack" is the bundle of per-jurisdiction rules a tenant's books run
// on. `tenant_accounting_profiles.pack_version` records WHICH revision of that
// bundle produced a given tenant's configuration, so a later revision can be
// rolled out deliberately instead of silently reinterpreting existing books.
//
// Lives in shared/ rather than server/ on purpose: most per-country data is
// already here and is consumed by both sides, so the pack can grow to own it
// without moving again.
//
// ---------------------------------------------------------------------------
// WHAT THIS REVISION COVERS
//
//   - chart-of-accounts labels — server/domain/accountNamePacks.js
//
// Everything else per-country is still standalone and NOT yet part of the
// versioned bundle. Each of these is a candidate to fold in, and each says so at
// its own definition:
//
//   - VAT rates and VAT-ID rules ....... shared/vatRates.js
//   - tax schemes (KOR, EU SME, …) ..... shared/taxSchemes.js
//   - local legal forms / frameworks ... shared/accountingProfileCodes.js
//   - company register rules ........... shared/businessRegistry.js
//   - VAT-return box definitions ....... server/domain/vat/vatReturnBoxDefinitions.js
//   - chart STRUCTURE overlays ......... not built (BE MAR, DE SKR03/04 are
//                                        different charts, not translations)
//
// ---------------------------------------------------------------------------
// TO EXPAND THE PACK
//
//   1. Move (or reference) the concern's registry from the list above.
//   2. Apply it wherever the profile is created and wherever the accounting
//      country changes — today that is createAccountingProfileForTenant() and
//      changeAccountingCountry() in server/finance/accounting-profile/.
//   3. Bump COUNTRY_PACK_REVISION, and add a migration that re-applies the new
//      revision to existing tenants and re-stamps them.
//
// The stamp deliberately does NOT name the concerns it covers, so widening the
// pack is a revision bump rather than a format change and every stored stamp
// stays comparable. Read this file to learn what a revision meant.
//
// Note this is a version of the RULES, not a guarantee about stored outcomes.
// Following shared/taxSchemes.js, correctness of historical data comes from
// persisting the outcome on the row (chart_of_accounts.default_name, the VAT
// treatment snapshots); the stamp explains a past decision, nothing renders it.
// ---------------------------------------------------------------------------

import { normalizeVatCountry } from './vatRates.js'

export const COUNTRY_PACK_REVISION = '2026.1'

// The value stored in tenant_accounting_profiles.pack_version.
//
// The country is part of the stamp even where a concern has no entry for it —
// "the fallback at this revision" is still a decision the pack made — matching
// how shared/taxCategories.js versions `${country}-tax-categories-2026.1`.
// Keep this format in sync with the migration that backfills it.
export function countryPackVersion(countryCode) {
  return `${normalizeVatCountry(countryCode) ?? 'unknown'}-pack-${COUNTRY_PACK_REVISION}`
}
