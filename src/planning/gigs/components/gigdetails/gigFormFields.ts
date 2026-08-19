// Translation between the gig detail form (everything a string, as typed) and
// the PATCH body the API expects (cents, numbers, nulls).
//
// The gig row mixes nullable columns with NOT NULL ones. Blanking a nullable
// field clears it; blanking a NOT NULL one means zero, never null — the server
// 400s on null there, so the distinction has to be made here rather than left
// to whichever field happened to be edited.
import type { GigCost } from '../../../../types/entities.ts'
import type { AgencyFeeMode, DealType, FeeBasis, GigDealTerms } from '../../dealTerms.ts'
import type { GigDetailForm } from './types.ts'

/** Money typed in euros → the `_cents` column it lands in. */
export const MONEY_FIELDS: Record<string, string> = {
  guaranteed_fee: 'guaranteed_fee_cents',
  venue_costs: 'venue_costs_cents',
  ticket_price_net: 'ticket_price_net_cents',
  ticket_price_gross: 'ticket_price_gross_cents',
  agency_fee_amount: 'agency_fee_amount_cents',
  commission_amount: 'commission_amount_cents',
}

/** The subset of the above whose column is NOT NULL — blank means zero. */
const REQUIRED_MONEY_FIELDS = new Set(['agency_fee_amount', 'commission_amount'])

/** Whole counts of people or tickets; blank clears them. */
export const COUNT_FIELDS = new Set(['venue_capacity', 'expected_visitors', 'tickets_sold'])

/** NUMERIC(5,2) percentages; blank clears them. */
export const NULLABLE_PERCENT_FIELDS = new Set(['percentage_of_sales'])

/** NUMERIC(5,2) percentages on NOT NULL columns; blank means zero. */
export const REQUIRED_PERCENT_FIELDS = new Set(['agency_fee_percentage', 'commission_percentage'])

export function feeToDisplay(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2)
}

/** A stored number (or a Postgres NUMERIC string) → what the input shows. */
export function numberToInput(value: number | string | null | undefined): string {
  return value == null ? '' : String(value)
}

export function feeToCents(value: string): number | null {
  const n = Number.parseFloat(value)
  return Number.isNaN(n) ? null : Math.round(n * 100)
}

function countToValue(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number.parseInt(value, 10)
  return Number.isNaN(n) ? null : n
}

function percentToValue(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number.parseFloat(value)
  return Number.isNaN(n) ? null : n
}

// Maps one edited form field onto the PATCH body. Returns null for a field with
// no translation — the caller sends it through unchanged.
export function patchForGigField(field: string, value: string): Record<string, unknown> | null {
  const moneyColumn = MONEY_FIELDS[field]
  if (moneyColumn) {
    const cents = feeToCents(value)
    return { [moneyColumn]: REQUIRED_MONEY_FIELDS.has(field) ? (cents ?? 0) : cents }
  }
  if (COUNT_FIELDS.has(field)) return { [field]: countToValue(value) }
  if (NULLABLE_PERCENT_FIELDS.has(field)) return { [field]: percentToValue(value) }
  if (REQUIRED_PERCENT_FIELDS.has(field)) return { [field]: percentToValue(value) ?? 0 }
  return null
}

function centsFromForm(value: unknown): number | null {
  return feeToCents(String(value ?? ''))
}

// The live terms the statement and simulation are computed from: the form as
// typed, not the last saved row, so the numbers move with the inputs while the
// debounced save is still pending.
export function dealTermsFromForm(form: GigDetailForm, costs: GigCost[]): GigDealTerms {
  return {
    deal_type: form.deal_type as DealType,
    guaranteed_fee_cents: centsFromForm(form.guaranteed_fee),
    costs,
    venue_costs_cents: centsFromForm(form.venue_costs),
    venue_capacity: countToValue(String(form.venue_capacity ?? '')),
    expected_visitors: countToValue(String(form.expected_visitors ?? '')),
    tickets_sold: countToValue(String(form.tickets_sold ?? '')),
    ticket_price_net_cents: centsFromForm(form.ticket_price_net),
    ticket_price_gross_cents: centsFromForm(form.ticket_price_gross),
    percentage_of_sales: percentToValue(String(form.percentage_of_sales ?? '')),
    breakeven_includes_venue_costs: form.breakeven_includes_venue_costs as boolean,
    agency_fee_basis: form.agency_fee_basis as FeeBasis,
    agency_fee_percentage: percentToValue(String(form.agency_fee_percentage ?? '')) ?? 0,
    agency_fee_amount_cents: centsFromForm(form.agency_fee_amount) ?? 0,
    agency_fee_mode: form.agency_fee_mode as AgencyFeeMode,
    commission_basis: form.commission_basis as FeeBasis,
    commission_percentage: percentToValue(String(form.commission_percentage ?? '')) ?? 0,
    commission_amount_cents: centsFromForm(form.commission_amount) ?? 0,
  }
}
