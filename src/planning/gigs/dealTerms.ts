// Gig deal maths: the artist statement and the ticket upside simulation.
//
// Pure and display-only — nothing here is posted, invoiced or persisted. The
// server stores the raw terms; every derived figure the Terms tab shows comes
// from this module, so the statement and the simulation cannot disagree.
//
// All money is integer cents, HALF_UP via Math.round. Percentages arrive as
// numbers from the form and as strings from Postgres NUMERIC, so every read
// goes through toNumber().

import {
  gigTicketVatPercentage,
  splitTicketVat,
  ticketPriceExVatCents,
} from '../../../shared/gigDealVat.js'
import type { AgencyFeeMode, CostPaidBy, DealType, FeeBasis, GigCost } from '../../types/entities.ts'

export type { AgencyFeeMode, CostPaidBy, DealType, FeeBasis }

// The pickable options, in the order the Terms tab offers them.
export const DEAL_TYPES: readonly DealType[] = ['flat_fee', 'guarantee', 'guarantee_plus', 'guarantee_vs', 'door_deal']
export const FEE_BASES: readonly FeeBasis[] = ['none', 'percentage', 'amount']
export const AGENCY_FEE_MODES: readonly AgencyFeeMode[] = ['exclusive', 'inclusive']
// A cost line with no paid_by set (old data) reads as 'artist' — see CostPaidBy.
export const COST_PAID_BY_OPTIONS: readonly CostPaidBy[] = ['artist_agency', 'artist', 'agency']
export const DEFAULT_COST_PAID_BY: CostPaidBy = 'artist'

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
  /** Whether this deal carries VAT at all; false zeroes both rates below. */
  subject_to_vat: boolean
  /** The rate an invoice from this gig is billed at; null = no override. */
  vat_percentage: number | string | null
  /** The venue's VAT contained in the nett ticket price; null = none to take out. */
  ticket_vat_percentage: number | string | null
}

export interface ArtistStatement {
  /** The fee the deal guarantees, before a single ticket is sold. */
  guaranteedFeeCents: number
  /** The artist's share of the tickets sold so far — earned fee, not a forecast. */
  ticketRevenueCents: number
  grossFeeCents: number
  /** The sum of every cost line, regardless of who pays it. Each is deducted from the statement at a different point — see bookingFeeBaseCents/nettFeeCents, costsPaidByArtistCents and costsPaidByAgencyCents. */
  costsCents: number
  /** Costs paid by the agency, deducted only from what is due to the booker — never reaches the booking fee or the nett fee. */
  costsPaidByAgencyCents: number
  /** Costs paid by the artist, deducted only from what is due to the artist — never reaches the booking fee or the nett fee. */
  costsPaidByArtistCents: number
  /** What the booking fee is actually calculated on: the gross fee minus any artist/agency-paid costs — the same base the nett fee is calculated on. */
  bookingFeeBaseCents: number
  nettFeeCents: number
  agencyFeeCents: number
  /** What the commission percentage/amount is actually taken from: nett fee minus the booking fee. */
  commissionBaseCents: number
  commissionCents: number
  dueToBookerCents: number
  dueToArtistCents: number
}

export interface TicketScenario {
  tickets: number
  /** What the door takes at the nett ticket price — ticket VAT included. */
  ticketRevenueCents: number
  /** The venue's VAT contained in that revenue; the share is taken from the rest. */
  ticketVatCents: number
  artistShareCents: number
}

export interface TicketUpside {
  artistPercentage: number
  venuePercentage: number
  /** The VAT taken out of ticket revenue before any share is calculated. */
  ticketVatPercentage: number
  /** One ticket with its VAT taken out — what the simulations run on. */
  ticketPriceExVatCents: number
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

// Missing/undefined paid_by is old data — it reads as 'artist', the
// pre-existing behaviour (booking fee unaffected, deducted only from what
// the artist is due).
function costPaidBy(cost: GigCost | null | undefined): CostPaidBy {
  return cost?.paid_by ?? DEFAULT_COST_PAID_BY
}

function sumCostsPaidBy(costs: GigCost[] | null | undefined, paidBy: CostPaidBy): number {
  if (!costs) return 0
  return costs.reduce(
    (total, cost) => total + (costPaidBy(cost) === paidBy ? Math.round(toNumber(cost?.amount_cents)) : 0),
    0,
  )
}

function percentOf(cents: number, percentage: number | string): number {
  return Math.round((cents * toNumber(percentage)) / 100)
}

// The booking fee is an amount owed to the booker regardless of how the gig
// turns out, so it never turns negative: a percentage is charged on a positive
// gross fee and on nothing else, and a fixed amount is a charge, never a credit.
function feeFromBasis(basis: FeeBasis, baseCents: number, percentage: number | string, amountCents: number): number {
  if (basis === 'percentage') return Math.max(0, percentOf(Math.max(0, baseCents), percentage))
  if (basis === 'amount') return Math.max(0, Math.round(toNumber(amountCents)))
  return 0
}

// Commission is taken from what is left of the nett fee once the booking fee
// is out of it — and unlike the booking fee, it is free to go negative: if the
// booking fee has eaten more than the nett fee left, the commission absorbs
// the rest rather than being floored away.
function commissionFromBasis(basis: FeeBasis, baseCents: number, percentage: number | string, amountCents: number): number {
  if (basis === 'percentage') return percentOf(baseCents, percentage)
  if (basis === 'amount') return Math.round(toNumber(amountCents))
  return 0
}

// The fee the deal actually guarantees. Deal types are switched freely and the
// fields behind them are kept rather than cleared, so a stored fee on a door
// deal is stale input, not money — read it through here, never directly.
function guaranteedFeeCentsOf(terms: GigDealTerms): number {
  if (!dealTypeHasGuaranteedFee(terms.deal_type)) return 0
  return Math.round(toNumber(terms.guaranteed_fee_cents))
}

export function computeArtistStatement(terms: GigDealTerms): ArtistStatement {
  const guaranteedFeeCents = guaranteedFeeCentsOf(terms)
  // The door has already paid out what the tickets sold so far earned, so it is
  // fee income like the guarantee: the booking fee and the commission are owed
  // over the two together. Tickets still unsold are a forecast, not revenue —
  // the expected and potential scenarios stay out of the statement.
  //
  // A guarantee vs. pays whichever of the guarantee and the door's full share
  // is higher, never their sum — sold.artistShareCents is that full share
  // (nothing is recouped from it), so the comparison happens here rather than
  // by adding it to the guarantee like every other deal type does.
  const doorShareCents = computeTicketUpside(terms).sold?.artistShareCents ?? 0
  const grossFeeCents = terms.deal_type === 'guarantee_vs'
    ? Math.max(guaranteedFeeCents, doorShareCents)
    : guaranteedFeeCents + doorShareCents
  // Reported as what the tickets added on top of the guarantee, so it stays
  // additive (guaranteedFeeCents + ticketRevenueCents === grossFeeCents) for
  // every deal type, including a guarantee vs.
  const ticketRevenueCents = grossFeeCents - guaranteedFeeCents

  // Costs split three ways by who pays them (paid_by), each deducted at a
  // different point in the statement:
  // - artist_agency comes off the shared base the booking fee and the nett
  //   fee are both calculated on, before either is calculated — so both
  //   sides take a share through that one reduced base.
  // - artist leaves the booking fee and the nett fee untouched; it is
  //   deducted only when calculating what is due to the artist, below.
  // - agency leaves the booking fee and the nett fee untouched too; it is
  //   deducted only when calculating what is due to the booker, below.
  const costsPaidByArtistAgencyCents = sumCostsPaidBy(terms.costs, 'artist_agency')
  const costsPaidByArtistCents = sumCostsPaidBy(terms.costs, 'artist')
  const costsPaidByAgencyCents = sumCostsPaidBy(terms.costs, 'agency')
  // The Costs figure is the sum of every line regardless of who pays it; only
  // the artist_agency portion actually reaches the shared base below.
  const costsCents = costsPaidByArtistAgencyCents + costsPaidByArtistCents + costsPaidByAgencyCents

  // Costs can outrun the fee; a loss is a real outcome the statement must show.
  const sharedBaseCents = grossFeeCents - costsPaidByArtistAgencyCents
  const bookingFeeBaseCents = sharedBaseCents
  const nettFeeCents = sharedBaseCents

  const agencyFeeCents = feeFromBasis(
    terms.agency_fee_basis,
    bookingFeeBaseCents,
    terms.agency_fee_percentage,
    terms.agency_fee_amount_cents,
  )
  const commissionBaseCents = nettFeeCents - agencyFeeCents
  const commissionCents = commissionFromBasis(
    terms.commission_basis,
    commissionBaseCents,
    terms.commission_percentage,
    terms.commission_amount_cents,
  )

  // Exclusive: the booking fee is added on top of the gross fee, so the artist
  // still receives the whole nett fee. Inclusive: it is split out of it.
  const agencyFeeBorneByArtist = terms.agency_fee_mode === 'inclusive' ? agencyFeeCents : 0

  return {
    guaranteedFeeCents,
    ticketRevenueCents,
    grossFeeCents,
    costsCents,
    costsPaidByAgencyCents,
    costsPaidByArtistCents,
    bookingFeeBaseCents,
    nettFeeCents,
    agencyFeeCents,
    commissionBaseCents,
    commissionCents,
    dueToBookerCents: agencyFeeCents + commissionCents - costsPaidByAgencyCents,
    dueToArtistCents: nettFeeCents - commissionCents - agencyFeeBorneByArtist - costsPaidByArtistCents,
  }
}

// What ticket revenue must cover before the artist's percentage kicks in — a
// recoupment the door has to clear before the artist shares in anything past
// it. Null means the question does not arise for this deal type.
//
// A guarantee vs. recoups nothing: the door's own percentage runs from ticket
// one, at the full share — computeArtistStatement then pays whichever of that
// full share and the guarantee is higher, so there is nothing to break even
// on, hence zero rather than the guarantee amount.
function breakEvenCentsOf(terms: GigDealTerms, guaranteedFeeCents: number): number | null {
  const venueCostsCents = Math.round(toNumber(terms.venue_costs_cents))
  switch (terms.deal_type) {
    case 'flat_fee':
      return null
    case 'guarantee':
      return guaranteedFeeCents + venueCostsCents
    case 'guarantee_plus':
      return guaranteedFeeCents + (terms.breakeven_includes_venue_costs ? venueCostsCents : 0)
    case 'guarantee_vs':
      return 0
    case 'door_deal':
      return venueCostsCents
  }
}

// `exVatPriceCents` is what one ticket actually contributes — the nett price
// with the venue's VAT taken out — and is deliberately left unrounded here, so
// the count agrees with the revenue, which is split on the total.
function breakEvenTicketsOf(
  breakEvenCents: number | null,
  exVatPriceCents: number,
): number | null {
  if (breakEvenCents === null || exVatPriceCents <= 0) return null
  return Math.ceil(breakEvenCents / exVatPriceCents)
}

interface ScenarioInput {
  terms: GigDealTerms
  breakEvenCents: number | null
  netPriceCents: number
  artistPercentage: number
  ticketVatPercentage: number
}

function scenarioAt(tickets: number | null, input: ScenarioInput): TicketScenario | null {
  if (tickets == null) return null
  const { terms, breakEvenCents, netPriceCents, artistPercentage, ticketVatPercentage } = input
  const count = Math.max(0, Math.round(toNumber(tickets)))
  const ticketRevenueCents = count * netPriceCents
  // The venue's VAT on the tickets is not money anyone shares in, and it comes
  // off the revenue as a whole — never a rounded amount per ticket.
  const { netCents, vatCents } = splitTicketVat(ticketRevenueCents, ticketVatPercentage)

  if (!dealTypeHasTicketShare(terms.deal_type) || breakEvenCents === null) {
    return { tickets: count, ticketRevenueCents, ticketVatCents: vatCents, artistShareCents: 0 }
  }

  // A vs. deal recoups nothing (breakEvenCents is 0), so this is the artist's
  // full percentage of the door from ticket one — computeArtistStatement pays
  // whichever of that and the guarantee is higher. Every other deal type
  // shares only the revenue past its break-even.
  const artistShareCents = percentOf(Math.max(0, netCents - breakEvenCents), artistPercentage)

  return { tickets: count, ticketRevenueCents, ticketVatCents: vatCents, artistShareCents }
}

export function computeTicketUpside(terms: GigDealTerms): TicketUpside {
  const guaranteedFeeCents = guaranteedFeeCentsOf(terms)
  const netPriceCents = Math.round(toNumber(terms.ticket_price_net_cents))
  const artistPercentage = toNumber(terms.percentage_of_sales)
  const breakEvenCents = breakEvenCentsOf(terms, guaranteedFeeCents)
  const ticketVatPercentage = gigTicketVatPercentage(terms) as number
  const scenario = { terms, breakEvenCents, netPriceCents, artistPercentage, ticketVatPercentage }

  return {
    artistPercentage,
    venuePercentage: 100 - artistPercentage,
    ticketVatPercentage,
    ticketPriceExVatCents: ticketPriceExVatCents(netPriceCents, ticketVatPercentage) as number,
    breakEvenCents,
    breakEvenTickets: breakEvenTicketsOf(breakEvenCents, netPriceCents / (1 + ticketVatPercentage / 100)),
    sold: scenarioAt(terms.tickets_sold, scenario),
    expected: scenarioAt(terms.expected_visitors, scenario),
    potential: scenarioAt(terms.venue_capacity, scenario),
  }
}
