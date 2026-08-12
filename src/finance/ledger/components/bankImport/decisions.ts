// Per-line booking decisions for the bank statement import review grid: the
// decision shape the dialog holds in state, the defaults each parsed line starts
// on, and the "same relation" grouping the apply-to-all prompt is built from.
import type {
  Account, AccountingProfile, AccountingSettings, BankStatementLine, Id,
} from '../../../../types/entities.ts'
import {
  DEFAULT_VAT_COUNTRY, getStandardVatRate, isAllowedVatRate,
} from '../../../vat/vatRates.ts'
import { commonVatSelection } from '../../../../../shared/taxCategories.js'
import { vatOptionValue } from './vatOptions.ts'

export type SupplierChoice =
  | { kind: 'link'; id: Id }
  | { kind: 'create'; name: string; iban: string | null }
  | { kind: 'none' }

export type Decision =
  | { kind: 'skip' }
  | { kind: 'reconcile_invoice'; invoiceId: Id }
  | { kind: 'reconcile_purchase'; purchaseId: Id }
  | {
      kind: 'reconcile_shopify_payout'
      payoutId: Id
      adjustmentMappings: Record<string, string>
    }
  | {
      kind: 'reconcile_paypal_payout'
      orderFinancialIds: Id[]
      differenceAccountCode: string
    }
  | {
      kind: 'journal_paid'
      contraAccountCode: string
      vatRate: number | null
      taxCategoryCode: string | null
      taxJurisdictionCode: string
      supplier: SupplierChoice
    }
  | {
      kind: 'journal_received'
      contraAccountCode: string
      vatRate: number | null
      taxCategoryCode: string | null
      taxJurisdictionCode: string
    }

export type PaidDecision = Extract<Decision, { kind: 'journal_paid' }>
export type JournalDecision = PaidDecision | Extract<Decision, { kind: 'journal_received' }>
export type PayoutDecision = Extract<Decision, {
  kind: 'reconcile_shopify_payout' | 'reconcile_paypal_payout'
}>

export function isJournalDecision(decision: Decision | undefined): decision is JournalDecision {
  return decision?.kind === 'journal_paid' || decision?.kind === 'journal_received'
}

export function isPayoutDecision(decision: Decision | undefined): decision is PayoutDecision {
  return decision?.kind === 'reconcile_shopify_payout' || decision?.kind === 'reconcile_paypal_payout'
}

// The VAT a direct booking should carry. `enabled` is false under a
// small-business scheme: such a tenant neither charges output VAT nor deducts
// input VAT, so no row may carry a rate.
export interface VatDefaults {
  enabled: boolean
  country: string
  /** Money paid out — the country's standard rate. */
  paid: number
  /** Money received — the band's own configured rate (its invoice default). */
  received: number
}

export const NO_VAT_DEFAULTS: VatDefaults = {
  enabled: false, country: DEFAULT_VAT_COUNTRY, paid: 0, received: 0,
}

export const EXPENSE_TYPES = new Set(['expense', 'cost_of_goods_sold'])

export const keyOf = (line: BankStatementLine) => String(line.id)

// Only the reviewer's DEFAULTS — the server re-checks each line against the
// scheme in force at that line's booking date, which is the authoritative answer
// for a statement spanning a scheme change.
export function resolveVatDefaults(accounting: AccountingProfile | null): VatDefaults {
  const treatment = accounting?.current_sales_treatment ?? null
  const country = treatment?.accounting_country || accounting?.country_code || DEFAULT_VAT_COUNTRY
  if (treatment?.scheme_exempt) return { ...NO_VAT_DEFAULTS, country }
  const configured = Number(accounting?.default_vat_rate)
  return {
    enabled: true,
    country,
    paid: getStandardVatRate(country),
    // What the band charges on its own turnover — the same value invoices
    // default to — falling back to the standard rate if it is not a real rate
    // for this country (e.g. saved before the VAT country changed).
    received: isAllowedVatRate(country, configured) ? configured : getStandardVatRate(country),
  }
}

export function defaultSupplier(line: BankStatementLine): SupplierChoice {
  const matches = line.suggestion.supplierMatches
  // Auto-link only on a single unambiguous match. With the deliberately
  // non-unique IBAN model, several matches require an explicit user choice, so
  // nothing is pre-selected.
  if (matches.length === 1 && matches[0].id != null) return { kind: 'link', id: matches[0].id }
  if (matches.length === 0 && line.counterparty_name) {
    return { kind: 'create', name: line.counterparty_name, iban: line.counterparty_iban }
  }
  return { kind: 'none' }
}

// Pre-selects the most likely booking for a line: an exact single reconcile
// match, else a direct journal (creating a supplier for a new outgoing
// counterparty). Duplicate hints remain warning-only. A reconciled invoice or
// bill carries the document's own VAT, so only the direct journals get a rate.
export function defaultDecision(
  line: BankStatementLine, settings: AccountingSettings | null, vat: VatDefaults,
  { shopifyConfigured = true }: { shopifyConfigured?: boolean } = {},
): Decision {
  const payouts = shopifyConfigured ? line.suggestion.shopifyPayoutMatches ?? [] : []
  if (payouts.length === 1 && payouts[0].ready) {
    return { kind: 'reconcile_shopify_payout', payoutId: payouts[0].id, adjustmentMappings: {} }
  }
  if (line.direction === 'debit') {
    if (line.suggestion.purchaseMatches.length === 1) {
      return { kind: 'reconcile_purchase', purchaseId: line.suggestion.purchaseMatches[0].id }
    }
    const selection = vat.enabled ? commonVatSelection(vat.country, vat.paid) : null
    return {
      kind: 'journal_paid',
      contraAccountCode: settings?.default_expense_account_code ?? '',
      vatRate: vat.enabled ? vat.paid : null,
      taxCategoryCode: selection?.tax_category_code ?? null,
      taxJurisdictionCode: selection?.tax_jurisdiction_code ?? vat.country,
      supplier: defaultSupplier(line),
    }
  }
  if (line.suggestion.invoiceMatches.length === 1) {
    return { kind: 'reconcile_invoice', invoiceId: line.suggestion.invoiceMatches[0].id }
  }
  const selection = vat.enabled ? commonVatSelection(vat.country, vat.received) : null
  return {
    kind: 'journal_received',
    contraAccountCode: settings?.default_revenue_account_code ?? '',
    vatRate: vat.enabled ? vat.received : null,
    taxCategoryCode: selection?.tax_category_code ?? null,
    taxJurisdictionCode: selection?.tax_jurisdiction_code ?? vat.country,
  }
}

// A journal decision for the line's direction, with the account lists as the
// fallback when the tenant's configured defaults are missing.
export function journalDecision(
  line: BankStatementLine, expenseAccounts: Account[], incomeAccounts: Account[], vat: VatDefaults,
): JournalDecision {
  if (line.direction === 'debit') {
    return {
      kind: 'journal_paid',
      contraAccountCode: expenseAccounts[0]?.code ?? '',
      vatRate: vat.enabled ? vat.paid : null,
      taxCategoryCode: vat.enabled ? commonVatSelection(vat.country, vat.paid)?.tax_category_code ?? null : null,
      taxJurisdictionCode: vat.country,
      supplier: defaultSupplier(line),
    }
  }
  return {
    kind: 'journal_received',
    contraAccountCode: incomeAccounts[0]?.code ?? '',
    vatRate: vat.enabled ? vat.received : null,
    taxCategoryCode: vat.enabled ? commonVatSelection(vat.country, vat.received)?.tax_category_code ?? null : null,
    taxJurisdictionCode: vat.country,
  }
}

// True while a payout reconciliation still needs a mapping the reviewer has not
// made. One owner for both the grid's warning affordance and the commit guard,
// so the button can never enable on a line the server would reject.
export function payoutMappingIncomplete(line: BankStatementLine, decision: Decision): boolean {
  if (decision.kind === 'reconcile_shopify_payout') {
    const payout = (line.suggestion.shopifyPayoutMatches ?? [])
      .find((candidate) => candidate.id === decision.payoutId)
    return !payout?.ready || payout.adjustments.some(
      (adjustment) => !decision.adjustmentMappings[String(adjustment.id)],
    )
  }
  if (decision.kind === 'reconcile_paypal_payout') {
    if (!decision.orderFinancialIds.length) return true
    const selected = new Set(decision.orderFinancialIds.map(String))
    const gross = (line.suggestion.paypalOrderMatches ?? [])
      .filter((order) => selected.has(String(order.id)))
      .reduce((sum, order) => sum + order.gross_cents, 0)
    return gross !== line.amount_cents && !decision.differenceAccountCode
  }
  return false
}

// What the reviewer just chose on one line and would be copied onto the rest of
// the relation. A VAT choice is always a complete (rate, category, jurisdiction)
// triple — the same rule the grid's dropdown follows, so copying can never leave
// a line half-typed.
export type ApplyPatch =
  | { field: 'account'; contraAccountCode: string }
  | {
      field: 'vat'
      vatRate: number | null
      taxCategoryCode: string | null
      taxJurisdictionCode: string
    }

// A pending "book the rest of this relation's lines the same way?" question.
// `kind` picks the copy — money paid to a supplier vs. received from a payer —
// and is also what keeps the two sides of one relation apart.
export interface ApplyPrompt {
  kind: 'paid' | 'received'
  patch: ApplyPatch
  relationName: string
  valueLabel: string
  lineIds: Id[]
  tokens: string[]
}

export function applyPatch(decision: JournalDecision, patch: ApplyPatch): JournalDecision {
  const fields = patch.field === 'account'
    ? { contraAccountCode: patch.contraAccountCode }
    : {
        vatRate: patch.vatRate,
        taxCategoryCode: patch.taxCategoryCode,
        taxJurisdictionCode: patch.taxJurisdictionCode,
      }
  // Narrowed before the spread so a paid decision keeps its supplier.
  return decision.kind === 'journal_paid'
    ? { ...decision, ...fields }
    : { ...decision, ...fields }
}

// Identity of the chosen value, so a dismissal is remembered per value.
export function patchKey(patch: ApplyPatch): string {
  return patch.field === 'account'
    ? patch.contraAccountCode
    : vatOptionValue(patch.vatRate, patch.taxCategoryCode)
}

// True when a line already carries what the patch would set — the prompt is only
// about the lines that would actually change.
export function patchMatches(decision: JournalDecision, patch: ApplyPatch): boolean {
  if (patch.field === 'account') return decision.contraAccountCode === patch.contraAccountCode
  return vatOptionValue(decision.vatRate, decision.taxCategoryCode) === patchKey(patch)
}

// Statement identity of the relation on a journal line: the supplier contact the
// user linked (outgoing lines only — incoming lines carry no contact link) plus
// the counterparty IBAN/name the bank reported. Two lines are the same relation
// when they share *any* token — a bank varies the counterparty name between
// lines of one party, and the parse-time matcher may have linked only some of
// them.
// "Only this line" is remembered per field + direction + relation + value, so
// editing a third line of that relation doesn't ask again — while a dismissed
// account prompt still leaves the VAT prompt free to ask.
export const dismissKey = (patch: ApplyPatch, kind: 'paid' | 'received', token: string) =>
  `${patch.field}|${kind}|${token}|${patchKey(patch)}`

export function relationTokens(line: BankStatementLine, decision: JournalDecision): string[] {
  const tokens: string[] = []
  if (decision.kind === 'journal_paid' && decision.supplier.kind === 'link') {
    tokens.push(`link:${decision.supplier.id}`)
  }
  if (line.counterparty_iban) tokens.push(`iban:${line.counterparty_iban.replace(/\s+/g, '').toUpperCase()}`)
  if (line.counterparty_name?.trim()) tokens.push(`name:${line.counterparty_name.trim().toLowerCase()}`)
  return tokens
}

// How to name the relation in the "apply to all" prompt: the linked supplier
// when there is one, else what the bank called the counterparty.
export function relationLabel(line: BankStatementLine, decision: JournalDecision): string {
  if (decision.kind === 'journal_paid') {
    const { supplier } = decision
    if (supplier.kind === 'link') {
      const match = line.suggestion.supplierMatches.find((s) => s.id === supplier.id)
      if (match?.name) return match.name
    }
    if (supplier.kind === 'create' && supplier.name.trim()) return supplier.name.trim()
  }
  return line.counterparty_name?.trim() || line.counterparty_iban || ''
}

export function idFrom(value: string): Id {
  return Number(value.slice(value.indexOf(':') + 1))
}
