import {
  computeArtistStatement as computeArtistStatementEngine,
  computeTicketUpside as computeTicketUpsideEngine,
  dealTypeHasGuaranteeVariant as dealTypeHasGuaranteeVariantEngine,
  dealTypeHasGuaranteedFee as dealTypeHasGuaranteedFeeEngine,
  dealTypeHasTicketShare as dealTypeHasTicketShareEngine,
  dealUsesVenueCostsToggle as dealUsesVenueCostsToggleEngine,
  sumCostsCents as sumCostsCentsEngine,
} from '../../../shared/gigDealEngine.js'
import {
  COST_PAID_BY,
  DEAL_TYPES,
  DEFAULT_COST_PAID_BY,
  FEE_BASES,
  GUARANTEE_VARIANTS,
} from '../../../shared/gigDealVocabulary.js'
import type { CostPaidBy, DealType, FeeBasis, GigCost, GuaranteeVariant } from '../../types/entities.ts'

export type { CostPaidBy, DealType, FeeBasis, GuaranteeVariant }
export { DEAL_TYPES, DEFAULT_COST_PAID_BY, FEE_BASES, GUARANTEE_VARIANTS }
export const COST_PAID_BY_OPTIONS: readonly CostPaidBy[] = COST_PAID_BY

export interface GigDealTerms {
  deal_type: DealType
  guarantee_variant: GuaranteeVariant | null
  guaranteed_fee_cents: number | null
  costs: GigCost[] | null
  venue_costs_cents: number | null
  venue_capacity: number | null
  expected_visitors: number | null
  tickets_sold: number | null
  ticket_price_net_cents: number | null
  /** The artist's share of ticket revenue, 0-100. The venue takes the rest. */
  percentage_of_sales: number | string | null
  breakeven_includes_venue_costs: boolean
  agency_fee_basis: FeeBasis
  agency_fee_percentage: number | string
  agency_fee_amount_cents: number
  commission_basis: FeeBasis
  commission_percentage: number | string
  commission_amount_cents: number
  subject_to_vat: boolean
  vat_percentage: number | string | null
  ticket_vat_percentage: number | string | null
  copyright_percentage: number | string | null
}

export interface ArtistStatement {
  guaranteedFeeCents: number
  ticketRevenueCents: number
  grossFeeCents: number
  costsCents: number
  costsPaidByAgencyCents: number
  costsPaidByArtistCents: number
  costsPaidByArtistAgencyCents: number
  /** Alias of nettFeeCents retained for the booking-fee tooltip. */
  bookingFeeBaseCents: number
  nettFeeCents: number
  agencyFeeCents: number
  commissionBaseCents: number
  commissionCents: number
  dueToBookerCents: number
  dueToArtistCents: number
}

export interface TicketScenario {
  tickets: number
  ticketRevenueCents: number
  ticketVatCents: number
  copyrightCents?: number
  artistShareCents: number
}

export interface TicketUpside {
  artistPercentage: number
  venuePercentage: number
  ticketVatPercentage: number
  ticketPriceExVatCents: number
  copyrightPercentage: number
  ticketPriceAfterCopyrightCents: number
  breakEvenCents: number | null
  breakEvenTickets: number | null
  sold: TicketScenario | null
  expected: TicketScenario | null
  potential: TicketScenario | null
}

export function dealTypeHasGuaranteedFee(dealType: DealType): boolean {
  return dealTypeHasGuaranteedFeeEngine(dealType)
}

export function dealTypeHasTicketShare(dealType: DealType): boolean {
  return dealTypeHasTicketShareEngine(dealType)
}

export function dealTypeHasGuaranteeVariant(dealType: DealType): boolean {
  return dealTypeHasGuaranteeVariantEngine(dealType)
}

export function dealUsesVenueCostsToggle(dealType: DealType, guaranteeVariant: GuaranteeVariant | null): boolean {
  return dealUsesVenueCostsToggleEngine(dealType, guaranteeVariant)
}

export function sumCostsCents(costs: GigCost[] | null | undefined): number {
  return sumCostsCentsEngine(costs)
}

export function computeArtistStatement(terms: GigDealTerms): ArtistStatement {
  return computeArtistStatementEngine(terms) as ArtistStatement
}

export function computeTicketUpside(terms: GigDealTerms): TicketUpside {
  return computeTicketUpsideEngine(terms) as TicketUpside
}
