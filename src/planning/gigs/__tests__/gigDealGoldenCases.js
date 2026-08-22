import { buildGigDealInvoiceLines } from '../../../../shared/gigDealInvoiceLines.js'
import { computeArtistStatement, computeTicketUpside } from '../dealTerms.ts'

const LEGACY_DEAL_TYPES = ['flat_fee', 'guarantee', 'guarantee_plus', 'guarantee_vs', 'door_deal']
const TICKET_SCENARIOS = Object.freeze({ zero: 0, below: 50, above: 160, capacity: 300 })
const VAT_PERCENTAGES = [0, 9, 21]
const COST_SCENARIOS = Object.freeze({
  none: [],
  artist_agency: [{ label: 'Production', amount_cents: 12345, paid_by: 'artist_agency' }],
  artist: [{ label: 'Travel', amount_cents: 12345, paid_by: 'artist' }],
  agency: [{ label: 'Administration', amount_cents: 12345, paid_by: 'agency' }],
})

const LEGACY_TO_CURRENT = Object.freeze({
  flat_fee: { deal_type: 'flat_fee', guarantee_variant: null },
  guarantee: { deal_type: 'guarantee', guarantee_variant: 'plus', forceVenueCosts: true },
  guarantee_plus: { deal_type: 'guarantee', guarantee_variant: 'plus' },
  guarantee_vs: { deal_type: 'guarantee', guarantee_variant: 'versus' },
  door_deal: { deal_type: 'door_deal', guarantee_variant: null },
})

function legacyTerms(dealType, includeVenueCosts, ticketsSold, vatPercentage, costs) {
  return {
    deal_type: dealType,
    guaranteed_fee_cents: 100000,
    costs,
    venue_costs_cents: 50000,
    venue_capacity: 300,
    expected_visitors: 180,
    tickets_sold: ticketsSold,
    ticket_price_net_cents: 2000,
    percentage_of_sales: 67.5,
    breakeven_includes_venue_costs: includeVenueCosts,
    agency_fee_basis: 'percentage',
    agency_fee_percentage: 12.5,
    agency_fee_amount_cents: 0,
    commission_basis: 'percentage',
    commission_percentage: 7.25,
    commission_amount_cents: 0,
    subject_to_vat: true,
    vat_percentage: vatPercentage,
    ticket_vat_percentage: vatPercentage,
  }
}

export function mapLegacyTermsToCurrent(legacy) {
  const mapping = LEGACY_TO_CURRENT[legacy.deal_type]
  return {
    ...legacy,
    deal_type: mapping.deal_type,
    guarantee_variant: mapping.guarantee_variant,
    breakeven_includes_venue_costs: mapping.forceVenueCosts
      ? true
      : legacy.breakeven_includes_venue_costs,
  }
}

export function buildGigDealGoldenCases(mapLegacyTerms = mapLegacyTermsToCurrent) {
  const cases = []
  for (const dealType of LEGACY_DEAL_TYPES) {
    for (const includeVenueCosts of [false, true]) {
      for (const [ticketScenario, ticketsSold] of Object.entries(TICKET_SCENARIOS)) {
        for (const vatPercentage of VAT_PERCENTAGES) {
          for (const [costScenario, costs] of Object.entries(COST_SCENARIOS)) {
            const legacy = legacyTerms(dealType, includeVenueCosts, ticketsSold, vatPercentage, costs)
            const terms = mapLegacyTerms(legacy)
            const { costsPaidByArtistAgencyCents: _namedCostSplit, ...statement } = computeArtistStatement(terms)
            cases.push({
              key: { dealType, includeVenueCosts, ticketScenario, vatPercentage, costScenario },
              statement,
              upside: computeTicketUpside(terms),
              invoiceLines: buildGigDealInvoiceLines(terms),
            })
          }
        }
      }
    }
  }
  return cases
}
