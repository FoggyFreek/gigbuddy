---
name: finance-ledger
description: The double-entry ledger, accounting profile (jurisdiction/regime), VAT treatment, fiscal-year maths, and bank statement import. Use before changing anything under server/finance/ or src/finance/ — ledger postings and journals, invoices, purchases, VAT rates and tax schemes, accounting country or legal form, financial year or period closing, CAMT.053/MT940 import, or the invoice PDF/UBL renderers.
user-invocable: false
---

# Finance: ledger, accounting profile, VAT

The financial core is an **immutable double-entry ledger** (`ledger_transactions` +
`ledger_entries`). Read `server/finance/ledger/ledgerService.js` and the reference tests
(`ledger.test.js`, `ledgerCompliance.test.js`, `ledgerBrowser.test.js`) before touching
anything financial.

Platform subscription billing is a *separate* concern — load the **subscription-billing**
skill for plans, entitlements and Mollie. Customer-invoice Mollie payments and platform
subscription billing are separate flows.

## Ledger invariants

- **`postJournal()` is the only insert path** — never write ledger rows directly.
  Idempotency by `UNIQUE (tenant_id, source_type, source_id, source_event)`; re-posting
  returns `{ posted: false }`.
- **Corrections-forward, never edits**: entries are never updated or deleted. Open-period
  mistakes are *voided*, closed-period ones *reversed* (`applyCorrection`); external
  payments in closed periods use `clampToOpenPeriod`.
- Business services post **inside the same DB transaction** as the state change.
- Display classification of `(source_type, source_event)` lives in
  `server/finance/ledger/ledgerEntryTypes.js` with a frontend mirror
  `src/finance/ledger/ledgerEntryType.ts` — **keep both in sync**.
- Tenant accounting settings are guarded by a per-tenant advisory lock (shared with
  `server/finance/accounts/accounts.js`).
- Never change persisted math. `computeInvoiceTotals` output is frozen once ledger-posted;
  new views must be additive functions that tie back to it exactly.

## Accounting profile

`tenant_accounting_profiles` is the single source of the tenant's regime (country, legal
form, entity size, bases, financial-year start, base currency, default VAT rate, VAT
registration and filing frequency).

- **`loadAccountingProfile` / `loadAccountingBehavior` (`accountingProfileService.js`) are
  the read primitives** and **throw `AccountingProfileMissingError`** (409
  `accounting_profile_missing`) rather than defaulting — never guess a jurisdiction.
  Repair is an operator job:
  `node server/finance/accounting-profile/scripts/backfillAccountingProfiles.js --check`,
  then `--apply --tenant=<id> --country=<cc>`.
- Every tenant gets its profile in the **same transaction as the tenant insert**.
- `country_code` is immutable through PATCH (409 `country_immutable`); only
  `changeAccountingCountry` moves it, and it refuses once financial documents exist.
- Fiscal-year maths has one owner: `shared/fiscalYear.js` (consumed by
  `server/utils/periodQuery.js` and `src/finance/invoices/invoicePeriod.ts`). VAT quarters
  and invoice numbering stay calendar-based.
- **The `tenants` row carries no regime and no stored currency** — the books' currency is
  derived from `base_currency`, never stored. `tenants.directors` is the exception (a
  contact fact disclosed on invoices for incorporated legal forms, so renderers take the
  legal form as a parameter).
- Frontend: **`useAccountingProfile()` owns `accountingCountry` and `defaultVatRate`**;
  `ProfileContext` is band identity only, no regime.

## VAT treatment

`server/finance/vat/vatTreatmentService.js` is the single owner. An **issued**
invoice/purchase renders from its persisted `*_snapshot` columns so an old document
reproduces what was sent; a **draft** resolves live and date-aware from
`tax_scheme_enrolments` at the tax point. Registry `shared/taxSchemes.js`.

Renderers (`renderInvoicePdf`/`renderInvoiceUbl`) and
`shared/{invoiceReadiness,peppolReadiness}.js` stay pure — the caller passes the resolved
treatment/regime in. The UBL/Peppol export passes CEN + PEPPOL rulesets externally; the
test suite only approximates those rules, so re-validate goldens externally on any format
change.

## Bank statement import

CAMT.053/MT940: parsers `server/finance/bank-import/`, `bankImport*`
service/repo/validators, dialog `src/finance/ledger/components/BankStatementImportDialog.tsx`.
Two-phase (parse-stage, then commit by line id) — **client money is never trusted**,
amounts are re-read server-side.

## Related rules that still live in CLAUDE.md

Collection reads, backend layering, and tenant isolation apply here unchanged; finance
routes are ordinary tenant-scoped routes. Purchases may book to capitalizable asset
accounts, but there is **no depreciation scheduler** — don't build one unasked.
