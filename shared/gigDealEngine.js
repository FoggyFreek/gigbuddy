import {
  gigTicketVatPercentage,
  splitTicketVat,
  ticketPriceExVatCents,
} from './gigDealVat.js'
import { DEFAULT_COST_PAID_BY } from './gigDealVocabulary.js'

export const GIG_DEAL_DEDUCTION_KINDS = Object.freeze({
  TICKET_VAT: 'ticket_vat',
  BREAK_EVEN_FEE: 'break_even_fee',
  BREAK_EVEN_VENUE_COSTS: 'break_even_venue_costs',
  GUARANTEE_OFFSET: 'guarantee_offset',
  VENUE_SHARE: 'venue_share',
})

const {
  TICKET_VAT,
  BREAK_EVEN_FEE,
  BREAK_EVEN_VENUE_COSTS,
  GUARANTEE_OFFSET,
  VENUE_SHARE,
} = GIG_DEAL_DEDUCTION_KINDS

export function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function cents(value) {
  return Math.round(toNumber(value))
}

export function percentOf(amountCents, percentage) {
  return Math.round((amountCents * toNumber(percentage)) / 100)
}

const venueCostsPart = ({ terms }) => ({ kind: BREAK_EVEN_VENUE_COSTS, cents: terms.venue_costs_cents })
const guaranteePart = ({ guaranteedFeeCents }) => ({ kind: BREAK_EVEN_FEE, cents: guaranteedFeeCents })

export const DEAL_REGISTRY = Object.freeze({
  flat_fee: {
    guaranteesFee: true,
    sharesTickets: false,
    combine: 'add',
    usesVenueCostsToggle: false,
    recoupments: () => [],
  },
  'guarantee:plus': {
    guaranteesFee: true,
    sharesTickets: true,
    combine: 'add',
    usesVenueCostsToggle: true,
    recoupments: (context) => context.terms.breakeven_includes_venue_costs
      ? [guaranteePart(context), venueCostsPart(context)]
      : [guaranteePart(context)],
  },
  'guarantee:versus': {
    guaranteesFee: true,
    sharesTickets: true,
    combine: 'max',
    usesVenueCostsToggle: false,
    recoupments: () => [],
  },
  door_deal: {
    guaranteesFee: false,
    sharesTickets: true,
    combine: 'add',
    usesVenueCostsToggle: false,
    recoupments: (context) => [venueCostsPart(context)],
  },
})

// Schema/code skew must not turn invoice drafting into a 500. The historic
// behavior is a guaranteed fee without ticket participation.
const UNKNOWN_DEAL = Object.freeze({
  guaranteesFee: true,
  sharesTickets: false,
  combine: 'add',
  usesVenueCostsToggle: false,
  recoupments: () => [],
})

function registryKey(dealType, guaranteeVariant) {
  return guaranteeVariant == null ? dealType : `${dealType}:${guaranteeVariant}`
}

export function dealDefinitionFor(dealType, guaranteeVariant = null) {
  return DEAL_REGISTRY[registryKey(dealType, guaranteeVariant)] ?? UNKNOWN_DEAL
}

function definitionsForDealType(dealType) {
  const prefix = `${dealType}:`
  return Object.entries(DEAL_REGISTRY)
    .filter(([key]) => key === dealType || key.startsWith(prefix))
    .map(([, definition]) => definition)
}

export function dealTypeHasGuaranteedFee(dealType) {
  return definitionsForDealType(dealType).some((definition) => definition.guaranteesFee)
}

export function dealTypeHasTicketShare(dealType) {
  return definitionsForDealType(dealType).some((definition) => definition.sharesTickets)
}

export function dealTypeHasGuaranteeVariant(dealType) {
  return definitionsForDealType(dealType).length > 1
}

export function dealUsesVenueCostsToggle(dealType, guaranteeVariant) {
  return dealDefinitionFor(dealType, guaranteeVariant).usesVenueCostsToggle
}

function guaranteedFeeCentsOf(terms, deal = dealDefinitionFor(terms.deal_type, terms.guarantee_variant)) {
  return deal.guaranteesFee ? cents(terms.guaranteed_fee_cents) : 0
}

function normalizedRecoupments(deal, context) {
  return deal.recoupments(context).map((part) => ({ ...part, cents: cents(part.cents) }))
}

function sumParts(parts) {
  return parts.reduce((total, part) => total + part.cents, 0)
}

function ticketContext(terms, tickets, projectUnsharedRevenue = false) {
  const deal = dealDefinitionFor(terms.deal_type, terms.guarantee_variant)
  const guaranteedFeeCents = guaranteedFeeCentsOf(terms, deal)
  const ticketsSold = Math.max(0, cents(tickets))
  const ticketPriceNetCents = cents(terms.ticket_price_net_cents)
  const artistPercentage = toNumber(terms.percentage_of_sales)
  const ticketVatPercentage = gigTicketVatPercentage(terms)
  const grossTicketRevenueCents = deal.sharesTickets || projectUnsharedRevenue
    ? ticketsSold * ticketPriceNetCents
    : 0
  const { netCents, vatCents } = splitTicketVat(grossTicketRevenueCents, ticketVatPercentage)
  return {
    deal,
    terms,
    ticketsSold,
    ticketPriceNetCents,
    grossTicketRevenueCents,
    ticketVatCents: vatCents,
    ticketVatPercentage,
    ticketRevenueCents: netCents,
    guaranteedFeeCents,
    artistPercentage,
    venuePercentage: 100 - artistPercentage,
  }
}

function settleTickets(context) {
  if (!context.deal.sharesTickets) {
    return { artistShareCents: 0, artistTicketShareCents: 0, deductions: [], breakEvenCents: null }
  }

  const recoupments = normalizedRecoupments(context.deal, context)
  const breakEvenCents = sumParts(recoupments)
  const baseCents = Math.max(0, context.ticketRevenueCents - breakEvenCents)
  const artistShareCents = percentOf(baseCents, context.artistPercentage)
  const combinedCents = context.deal.combine === 'max'
    ? Math.max(context.guaranteedFeeCents, artistShareCents)
    : context.guaranteedFeeCents + artistShareCents
  const artistTicketShareCents = combinedCents - context.guaranteedFeeCents
  const deductions = context.deal.combine === 'max'
    ? [
      {
        kind: VENUE_SHARE,
        cents: context.ticketRevenueCents - artistShareCents,
        percentage: context.venuePercentage,
      },
      { kind: GUARANTEE_OFFSET, cents: context.guaranteedFeeCents },
    ]
    : [
      ...recoupments,
      { kind: VENUE_SHARE, cents: baseCents - artistShareCents, percentage: context.venuePercentage },
    ]

  return { artistShareCents, artistTicketShareCents, deductions, breakEvenCents }
}

export function computeGigDealSettlement(terms) {
  const context = ticketContext(terms, terms.tickets_sold)
  const tickets = settleTickets(context)
  const { deal, ...publicContext } = context
  return {
    ...publicContext,
    artistTicketShareCents: tickets.artistTicketShareCents,
    deductions: context.ticketVatCents > 0
      ? [{ kind: TICKET_VAT, cents: context.ticketVatCents, percentage: context.ticketVatPercentage }, ...tickets.deductions]
      : tickets.deductions,
    billsGuaranteedFee: deal.guaranteesFee,
    totalCents: context.guaranteedFeeCents + tickets.artistTicketShareCents,
  }
}

function scenarioAt(terms, tickets) {
  if (tickets == null) return null
  const context = ticketContext(terms, tickets, true)
  const settled = settleTickets(context)
  return {
    tickets: context.ticketsSold,
    ticketRevenueCents: context.grossTicketRevenueCents,
    ticketVatCents: context.ticketVatCents,
    artistShareCents: settled.artistShareCents,
  }
}

function breakEvenTicketsOf(breakEvenCents, exVatPriceCents) {
  if (breakEvenCents === null || exVatPriceCents <= 0) return null
  return Math.ceil(breakEvenCents / exVatPriceCents)
}

function upsideContext(terms) {
  const context = ticketContext(terms, 0)
  const breakEvenCents = context.deal.sharesTickets
    ? sumParts(normalizedRecoupments(context.deal, context))
    : null
  return { ...context, breakEvenCents }
}

export function computeSoldTicketShare(terms) {
  return scenarioAt(terms, terms.tickets_sold)
}

export function computeTicketUpside(terms) {
  const context = upsideContext(terms)
  const exVatPriceCents = context.ticketPriceNetCents / (1 + context.ticketVatPercentage / 100)
  return {
    artistPercentage: context.artistPercentage,
    venuePercentage: context.venuePercentage,
    ticketVatPercentage: context.ticketVatPercentage,
    ticketPriceExVatCents: ticketPriceExVatCents(context.ticketPriceNetCents, context.ticketVatPercentage),
    breakEvenCents: context.breakEvenCents,
    breakEvenTickets: breakEvenTicketsOf(context.breakEvenCents, exVatPriceCents),
    sold: computeSoldTicketShare(terms),
    expected: scenarioAt(terms, terms.expected_visitors),
    potential: scenarioAt(terms, terms.venue_capacity),
  }
}

export function sumCostsCents(costs) {
  if (!costs) return 0
  return costs.reduce((total, cost) => total + cents(cost?.amount_cents), 0)
}

function costPaidBy(cost) {
  return cost?.paid_by ?? DEFAULT_COST_PAID_BY
}

function sumCostsPaidBy(costs, paidBy) {
  if (!costs) return 0
  return costs.reduce(
    (total, cost) => total + (costPaidBy(cost) === paidBy ? cents(cost?.amount_cents) : 0),
    0,
  )
}

function feeFromBasis(basis, baseCents, percentage, amountCents) {
  if (basis === 'percentage') return Math.max(0, percentOf(Math.max(0, baseCents), percentage))
  if (basis === 'amount') return Math.max(0, cents(amountCents))
  return 0
}

function commissionFromBasis(basis, baseCents, percentage, amountCents) {
  if (basis === 'percentage') return percentOf(baseCents, percentage)
  if (basis === 'amount') return cents(amountCents)
  return 0
}

export function computeArtistStatement(terms) {
  const deal = dealDefinitionFor(terms.deal_type, terms.guarantee_variant)
  const guaranteedFeeCents = guaranteedFeeCentsOf(terms, deal)
  const sold = computeSoldTicketShare(terms)
  const soldShareCents = sold?.artistShareCents ?? 0
  const grossFeeCents = deal.combine === 'max'
    ? Math.max(guaranteedFeeCents, soldShareCents)
    : guaranteedFeeCents + soldShareCents
  const ticketRevenueCents = grossFeeCents - guaranteedFeeCents

  const costsPaidByArtistAgencyCents = sumCostsPaidBy(terms.costs, 'artist_agency')
  const costsPaidByArtistCents = sumCostsPaidBy(terms.costs, 'artist')
  const costsPaidByAgencyCents = sumCostsPaidBy(terms.costs, 'agency')
  const costsCents = sumCostsCents(terms.costs)
  const nettFeeCents = grossFeeCents - costsPaidByArtistAgencyCents
  const bookingFeeBaseCents = nettFeeCents
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

  return {
    guaranteedFeeCents,
    ticketRevenueCents,
    grossFeeCents,
    costsCents,
    costsPaidByAgencyCents,
    costsPaidByArtistCents,
    costsPaidByArtistAgencyCents,
    bookingFeeBaseCents,
    nettFeeCents,
    agencyFeeCents,
    commissionBaseCents,
    commissionCents,
    dueToBookerCents: agencyFeeCents + commissionCents - costsPaidByAgencyCents,
    dueToArtistCents: nettFeeCents - commissionCents - agencyFeeCents - costsPaidByArtistCents,
  }
}
