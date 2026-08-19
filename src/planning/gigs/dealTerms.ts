// Gig deal maths: the artist statement and the ticket upside simulation.
//
// Pure and display-only — nothing here is posted, invoiced or persisted. The
// server stores the raw terms; every derived figure the Terms tab shows comes
// from this module, so the statement and the simulation cannot disagree.
//
// All money is integer cents, HALF_UP via Math.round. Percentages arrive as
// numbers from the form and as strings from Postgres NUMERIC, so every read
// goes through toNumber().

import type { AgencyFeeMode, DealType, FeeBasis, GigCost } from '../../types/entities.ts'

export type { AgencyFeeMode, DealType, FeeBasis }

// The pickable options, in the order the Terms tab offers them.
export const DEAL_TYPES: readonly DealType[] = ['flat_fee', 'guarantee', 'guarantee_plus', 'guarantee_vs', 'door_deal']
export const FEE_BASES: readonly FeeBasis[] = ['none', 'percentage', 'amount']
export const AGENCY_FEE_MODES: readonly AgencyFeeMode[] = ['exclusive', 'inclusive']

export interface GigDealTerms {
  deal_type: DealType
  guaranteed_fee_cents: number | null
  costs: GigCost[] | null
  venue_costs_cents: number | null
  venue_capacity: number | null
  expected_visitors: number | null
  tickets_sold: number | null
  ticket_price_net_cents: number | null
  ticket_price_gross_cents: number | null
  /** The artist's share of ticket revenue, 0–100. The venue takes the rest. */
  percentage_of_sales: number | string | null
  breakeven_includes_venue_costs: boolean
  agency_fee_basis: FeeBasis
  agency_fee_percentage: number | string
  agency_fee_amount_cents: number
  agency_fee_mode: AgencyFeeMode
  commission_basis: FeeBasis
  commission_percentage: number | string
  commission_amount_cents: number
}

export interface ArtistStatement {
  grossFeeCents: number
  costsCents: number
  nettFeeCents: number
  agencyFeeCents: number
  commissionCents: number
  dueToBookerCents: number
  dueToArtistCents: number
}

export interface TicketScenario {
  tickets: number
  ticketRevenueCents: number
  artistShareCents: number
}

export interface TicketUpside {
  artistPercentage: number
  venuePercentage: number
  /** What ticket revenue has to cover before the artist's share starts. */
  breakEvenCents: number | null
  breakEvenTickets: number | null
  sold: TicketScenario | null
  expected: TicketScenario | null
  /** The ceiling: every seat in the house sold. */
  potential: TicketScenario | null
}

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** A door deal is settled entirely from the door — there is no fee to guarantee. */
export function dealTypeHasGuaranteedFee(dealType: DealType): boolean {
  return dealType !== 'door_deal'
}

/** A flat fee is the one deal that takes no part in ticket revenue. */
export function dealTypeHasTicketShare(dealType: DealType): boolean {
  return dealType !== 'flat_fee'
}

/** Only a guarantee+ lets the artist choose whether venue costs count. */
export function dealTypeChoosesVenueCosts(dealType: DealType): boolean {
  return dealType === 'guarantee_plus'
}

export function sumCostsCents(costs: GigCost[] | null | undefined): number {
  if (!costs) return 0
  return costs.reduce((total, cost) => total + Math.round(toNumber(cost?.amount_cents)), 0)
}

function percentOf(cents: number, percentage: number | string): number {
  return Math.round((cents * toNumber(percentage)) / 100)
}

function feeFromBasis(basis: FeeBasis, baseCents: number, percentage: number | string, amountCents: number): number {
  if (basis === 'percentage') return percentOf(baseCents, percentage)
  if (basis === 'amount') return Math.round(toNumber(amountCents))
  return 0
}

// The fee the deal actually guarantees. Deal types are switched freely and the
// fields behind them are kept rather than cleared, so a stored fee on a door
// deal is stale input, not money — read it through here, never directly.
function grossFeeCentsOf(terms: GigDealTerms): number {
  if (!dealTypeHasGuaranteedFee(terms.deal_type)) return 0
  return Math.round(toNumber(terms.guaranteed_fee_cents))
}

export function computeArtistStatement(terms: GigDealTerms): ArtistStatement {
  const grossFeeCents = grossFeeCentsOf(terms)
  const costsCents = sumCostsCents(terms.costs)
  // Costs can outrun the fee; a loss is a real outcome the statement must show.
  const nettFeeCents = grossFeeCents - costsCents

  const agencyFeeCents = feeFromBasis(
    terms.agency_fee_basis,
    grossFeeCents,
    terms.agency_fee_percentage,
    terms.agency_fee_amount_cents,
  )
  const commissionCents = feeFromBasis(
    terms.commission_basis,
    nettFeeCents,
    terms.commission_percentage,
    terms.commission_amount_cents,
  )

  // Exclusive: the booking fee is added on top of the gross fee, so the artist
  // still receives the whole nett fee. Inclusive: it is split out of it.
  const agencyFeeBorneByArtist = terms.agency_fee_mode === 'inclusive' ? agencyFeeCents : 0

  return {
    grossFeeCents,
    costsCents,
    nettFeeCents,
    agencyFeeCents,
    commissionCents,
    dueToBookerCents: agencyFeeCents + commissionCents,
    dueToArtistCents: nettFeeCents - commissionCents - agencyFeeBorneByArtist,
  }
}

// What ticket revenue must cover before the artist's percentage kicks in.
// Null means the question does not arise for this deal type.
function breakEvenCentsOf(terms: GigDealTerms, grossFeeCents: number): number | null {
  const venueCostsCents = Math.round(toNumber(terms.venue_costs_cents))
  switch (terms.deal_type) {
    case 'flat_fee':
      return null
    case 'guarantee':
      return grossFeeCents + venueCostsCents
    case 'guarantee_plus':
      return grossFeeCents + (terms.breakeven_includes_venue_costs ? venueCostsCents : 0)
    case 'guarantee_vs':
      // Nothing is recouped — the share simply has to beat the guarantee.
      return grossFeeCents
    case 'door_deal':
      return venueCostsCents
  }
}

function breakEvenTicketsOf(
  terms: GigDealTerms,
  breakEvenCents: number | null,
  netPriceCents: number,
  artistPercentage: number,
): number | null {
  if (breakEvenCents === null || netPriceCents <= 0) return null
  if (terms.deal_type === 'guarantee_vs') {
    // The crossover: the ticket at which the artist's share overtakes the fee.
    if (artistPercentage <= 0) return null
    return Math.ceil(breakEvenCents / ((netPriceCents * artistPercentage) / 100))
  }
  return Math.ceil(breakEvenCents / netPriceCents)
}

function scenarioAt(
  tickets: number | null,
  terms: GigDealTerms,
  breakEvenCents: number | null,
  netPriceCents: number,
  artistPercentage: number,
): TicketScenario | null {
  if (tickets == null) return null
  const count = Math.max(0, Math.round(toNumber(tickets)))
  const ticketRevenueCents = count * netPriceCents

  if (!dealTypeHasTicketShare(terms.deal_type) || breakEvenCents === null) {
    return { tickets: count, ticketRevenueCents, artistShareCents: 0 }
  }

  // A vs. deal takes its percentage from the first ticket and pays out only the
  // excess over the guarantee; the others share the revenue past break-even.
  const artistShareCents = terms.deal_type === 'guarantee_vs'
    ? Math.max(0, percentOf(ticketRevenueCents, artistPercentage) - breakEvenCents)
    : percentOf(Math.max(0, ticketRevenueCents - breakEvenCents), artistPercentage)

  return { tickets: count, ticketRevenueCents, artistShareCents }
}

export function computeTicketUpside(terms: GigDealTerms): TicketUpside {
  const grossFeeCents = grossFeeCentsOf(terms)
  const netPriceCents = Math.round(toNumber(terms.ticket_price_net_cents))
  const artistPercentage = toNumber(terms.percentage_of_sales)
  const breakEvenCents = breakEvenCentsOf(terms, grossFeeCents)

  return {
    artistPercentage,
    venuePercentage: 100 - artistPercentage,
    breakEvenCents,
    breakEvenTickets: breakEvenTicketsOf(terms, breakEvenCents, netPriceCents, artistPercentage),
    sold: scenarioAt(terms.tickets_sold, terms, breakEvenCents, netPriceCents, artistPercentage),
    expected: scenarioAt(terms.expected_visitors, terms, breakEvenCents, netPriceCents, artistPercentage),
    potential: scenarioAt(terms.venue_capacity, terms, breakEvenCents, netPriceCents, artistPercentage),
  }
}
