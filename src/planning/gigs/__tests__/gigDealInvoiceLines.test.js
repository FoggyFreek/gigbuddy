import { describe, it, expect } from 'vitest'
import {
  buildGigDealInvoiceLines,
  computeGigDealSettlement,
  GIG_DEAL_LINE_KINDS,
} from '../../../../shared/gigDealInvoiceLines.js'
import { DEAL_REGISTRY, dealDefinitionFor } from '../../../../shared/gigDealEngine.js'
import { computeArtistStatement } from '../dealTerms.ts'

// Same minimal terms object the dealTerms tests use, so both sides of the deal
// are exercised with identical input.
function terms(overrides = {}) {
  const result = {
    deal_type: 'flat_fee',
    guarantee_variant: null,
    guaranteed_fee_cents: null,
    costs: [],
    venue_costs_cents: null,
    venue_capacity: null,
    expected_visitors: null,
    tickets_sold: null,
    ticket_price_net_cents: null,
    ticket_price_gross_cents: null,
    percentage_of_sales: null,
    breakeven_includes_venue_costs: true,
    agency_fee_basis: 'none',
    agency_fee_percentage: 0,
    agency_fee_amount_cents: 0,
    commission_basis: 'none',
    commission_percentage: 0,
    commission_amount_cents: 0,
    subject_to_vat: true,
    vat_percentage: null,
    ticket_vat_percentage: null,
    ...overrides,
  }
  if (result.deal_type === 'guarantee' && !Object.hasOwn(overrides, 'guarantee_variant')) {
    result.guarantee_variant = 'plus'
  }
  return result
}

const DEAL_CONFIGS = [
  { deal_type: 'flat_fee', guarantee_variant: null },
  { deal_type: 'guarantee', guarantee_variant: 'plus' },
  { deal_type: 'guarantee', guarantee_variant: 'versus' },
  { deal_type: 'door_deal', guarantee_variant: null },
]

function sumLines(lines) {
  return lines.reduce((total, line) => total + line.amountCents, 0)
}

function kinds(lines) {
  return lines.map((line) => line.kind)
}

// A gig of each deal type that actually earns something on the door: 200 tickets
// at EUR 10 net, EUR 500 guarantee, EUR 300 of venue costs, artist takes 70%.
const EARNING_DEALS = {
  flat_fee: terms({ deal_type: 'flat_fee', guaranteed_fee_cents: 50000 }),
  guarantee: terms({
    deal_type: 'guarantee',
    guaranteed_fee_cents: 50000,
    venue_costs_cents: 30000,
    tickets_sold: 200,
    ticket_price_net_cents: 1000,
    percentage_of_sales: '70.00',
  }),
  guaranteePlus: terms({
    deal_type: 'guarantee',
    guarantee_variant: 'plus',
    breakeven_includes_venue_costs: false,
    guaranteed_fee_cents: 50000,
    venue_costs_cents: 30000,
    tickets_sold: 200,
    ticket_price_net_cents: 1000,
    percentage_of_sales: '70.00',
  }),
  guaranteeVersus: terms({
    deal_type: 'guarantee',
    guarantee_variant: 'versus',
    guaranteed_fee_cents: 50000,
    tickets_sold: 200,
    ticket_price_net_cents: 1000,
    percentage_of_sales: '70.00',
  }),
  door_deal: terms({
    deal_type: 'door_deal',
    venue_costs_cents: 30000,
    tickets_sold: 200,
    ticket_price_net_cents: 1000,
    percentage_of_sales: '70.00',
  }),
}

describe('gig deal invoice lines — what the venue is billed', () => {
  it('bills a flat fee as the single fee line it is', () => {
    const lines = buildGigDealInvoiceLines(EARNING_DEALS.flat_fee)
    expect(kinds(lines)).toEqual([GIG_DEAL_LINE_KINDS.PERFORMANCE_FEE])
    expect(lines[0]).toMatchObject({ quantity: 1, unitPriceCents: 50000, amountCents: 50000 })
  })

  it('bills a door deal as revenue, break-even and the venue share', () => {
    const lines = buildGigDealInvoiceLines(EARNING_DEALS.door_deal)
    expect(kinds(lines)).toEqual([
      GIG_DEAL_LINE_KINDS.TICKET_REVENUE,
      GIG_DEAL_LINE_KINDS.BREAK_EVEN_VENUE_COSTS,
      GIG_DEAL_LINE_KINDS.VENUE_SHARE,
    ])
    // 200 x EUR 10 = 2000, less 300 break-even = 1700, of which the artist takes
    // 70% (1190) and the venue keeps 510.
    expect(lines.map((line) => line.amountCents)).toEqual([200000, -30000, -51000])
    expect(sumLines(lines)).toBe(119000)
  })

  it('itemises a guarantee break-even into the fee and the venue costs', () => {
    const lines = buildGigDealInvoiceLines(EARNING_DEALS.guarantee)
    expect(kinds(lines)).toEqual([
      GIG_DEAL_LINE_KINDS.PERFORMANCE_FEE,
      GIG_DEAL_LINE_KINDS.TICKET_REVENUE,
      GIG_DEAL_LINE_KINDS.BREAK_EVEN_FEE,
      GIG_DEAL_LINE_KINDS.BREAK_EVEN_VENUE_COSTS,
      GIG_DEAL_LINE_KINDS.VENUE_SHARE,
    ])
    // Fee 500 + 70% of (2000 - 500 - 300) = 500 + 840.
    expect(sumLines(lines)).toBe(134000)
  })

  it('leaves venue costs out of a guarantee+ break-even when the deal does', () => {
    const lines = buildGigDealInvoiceLines(EARNING_DEALS.guaranteePlus)
    expect(kinds(lines)).not.toContain(GIG_DEAL_LINE_KINDS.BREAK_EVEN_VENUE_COSTS)
    // Fee 500 + 70% of (2000 - 500) = 500 + 1050.
    expect(sumLines(lines)).toBe(155000)
  })

  it('offsets the guarantee it has to beat on a guarantee vs.', () => {
    const lines = buildGigDealInvoiceLines(EARNING_DEALS.guaranteeVersus)
    expect(kinds(lines)).toEqual([
      GIG_DEAL_LINE_KINDS.PERFORMANCE_FEE,
      GIG_DEAL_LINE_KINDS.TICKET_REVENUE,
      GIG_DEAL_LINE_KINDS.VENUE_SHARE,
      GIG_DEAL_LINE_KINDS.GUARANTEE_OFFSET,
    ])
    // Nothing is recouped: the artist gets 70% of 2000, not the 500 guarantee.
    expect(sumLines(lines)).toBe(140000)
  })

  it('bills the guarantee alone when the door never beats it', () => {
    const lines = buildGigDealInvoiceLines(terms({
      ...EARNING_DEALS.guaranteeVersus,
      tickets_sold: 10,
    }))
    expect(kinds(lines)).toEqual([GIG_DEAL_LINE_KINDS.PERFORMANCE_FEE])
    expect(sumLines(lines)).toBe(50000)
  })

  it('bills nothing for a door deal below break-even, or with no tickets entered', () => {
    expect(buildGigDealInvoiceLines(terms({ ...EARNING_DEALS.door_deal, tickets_sold: 10 }))).toEqual([])
    expect(buildGigDealInvoiceLines(terms({ ...EARNING_DEALS.door_deal, tickets_sold: null }))).toEqual([])
  })

  it('ignores a fee left behind on a door deal by an earlier deal type', () => {
    const lines = buildGigDealInvoiceLines(terms({
      ...EARNING_DEALS.door_deal,
      guaranteed_fee_cents: 50000,
    }))
    expect(kinds(lines)).not.toContain(GIG_DEAL_LINE_KINDS.PERFORMANCE_FEE)
    expect(sumLines(lines)).toBe(119000)
  })

  it('drops a break-even component that is zero rather than billing a zero line', () => {
    const lines = buildGigDealInvoiceLines(terms({ ...EARNING_DEALS.door_deal, venue_costs_cents: 0 }))
    expect(kinds(lines)).toEqual([GIG_DEAL_LINE_KINDS.TICKET_REVENUE, GIG_DEAL_LINE_KINDS.VENUE_SHARE])
  })

  it('bills the whole door when the artist takes 100%', () => {
    const lines = buildGigDealInvoiceLines(terms({
      ...EARNING_DEALS.door_deal,
      venue_costs_cents: 0,
      percentage_of_sales: 100,
    }))
    expect(kinds(lines)).toEqual([GIG_DEAL_LINE_KINDS.TICKET_REVENUE])
    expect(sumLines(lines)).toBe(200000)
  })

  // A deduction adjusts money, not stock: nothing is being returned, so the
  // quantity stays positive and the amount carries the sign.
  it('states every deduction as a positive quantity at a negative amount', () => {
    for (const deal of Object.values(EARNING_DEALS)) {
      for (const line of buildGigDealInvoiceLines(deal)) {
        expect(line.quantity).toBeGreaterThan(0)
        expect(line.quantity * line.unitPriceCents).toBe(line.amountCents)
      }
    }
    const [, ...deductions] = buildGigDealInvoiceLines(EARNING_DEALS.door_deal)
    expect(deductions.map((line) => [line.quantity, line.unitPriceCents])).toEqual([[1, -30000], [1, -51000]])
  })

  it('falls back to the guaranteed fee for a deal type it does not know', () => {
    const lines = buildGigDealInvoiceLines(terms({ deal_type: 'from_the_future', guaranteed_fee_cents: 50000 }))
    expect(kinds(lines)).toEqual([GIG_DEAL_LINE_KINDS.PERFORMANCE_FEE])
    expect(sumLines(lines)).toBe(50000)
  })
})

// The invoice and the Terms tab must never disagree about what the gig earned:
// the lines the venue is billed for sum to the gross fee the artist statement
// shows. What the artist then owes their booker is not the venue's business.
describe('gig deal invoice lines — tie-out with the artist statement', () => {
  it('covers every deal type and guarantee variant the Terms tab offers', () => {
    for (const config of DEAL_CONFIGS) {
      expect(Object.values(EARNING_DEALS)).toContainEqual(expect.objectContaining(config))
    }
  })

  it.each(Object.entries(EARNING_DEALS))('sums to the gross fee of a %s', (_dealType, deal) => {
    expect(sumLines(buildGigDealInvoiceLines(deal))).toBe(computeArtistStatement(deal).grossFeeCents)
  })

  // Rounding is where a decomposition drifts: an odd revenue split at a
  // percentage that does not divide cleanly must still tie out exactly.
  it.each([
    [50, 1001, 0],
    [33.33, 98765, 4321],
    [12.5, 700007, 100003],
    [70, 123456, 123456],
    [99.99, 999999, 1],
  ])('ties out at %s%% of %s cents over a %s break-even', (percentage, revenueCents, breakEvenCents) => {
    for (const dealConfig of DEAL_CONFIGS) {
      const deal = terms({
        ...dealConfig,
        guaranteed_fee_cents: 25000,
        venue_costs_cents: breakEvenCents,
        tickets_sold: revenueCents,
        ticket_price_net_cents: 1,
        percentage_of_sales: percentage,
      })
      const lines = buildGigDealInvoiceLines(deal)
      const statement = computeArtistStatement(deal)
      // A deal that settles at zero bills nothing and leaves the caller its own
      // fallback line, so only what IS billed has to tie out.
      if (lines.length) expect(sumLines(lines)).toBe(statement.grossFeeCents)
      else expect(statement.grossFeeCents).toBe(0)
    }
  })

  it('reports the same total on the settlement as on the lines', () => {
    for (const deal of Object.values(EARNING_DEALS)) {
      expect(computeGigDealSettlement(deal).totalCents).toBe(sumLines(buildGigDealInvoiceLines(deal)))
    }
  })
})

// The nett ticket price is what the door took per ticket, the venue's VAT
// included. The venue is billed for the door at that gross — it is what its own
// till says — and the VAT it owes the tax office comes off as its own line,
// before anything is recouped or shared.
describe('gig deal invoice lines — ticket VAT', () => {
  // The worked example: 104 tickets at EUR 6.85 is EUR 712.40 through the door,
  // of which 9/109 — EUR 58.82 — is the venue's VAT.
  const doorDealWithVat = terms({
    deal_type: 'door_deal',
    venue_costs_cents: 0,
    tickets_sold: 104,
    ticket_price_net_cents: 685,
    percentage_of_sales: 100,
    ticket_vat_percentage: 9,
  })

  it('bills the door at its gross and takes the ticket VAT off as one line', () => {
    const lines = buildGigDealInvoiceLines(doorDealWithVat)
    expect(kinds(lines)).toEqual([GIG_DEAL_LINE_KINDS.TICKET_REVENUE, GIG_DEAL_LINE_KINDS.TICKET_VAT])
    expect(lines[0]).toMatchObject({ quantity: 104, unitPriceCents: 685, amountCents: 71240 })
    expect(lines[1]).toMatchObject({ quantity: 1, unitPriceCents: -5882, amountCents: -5882, percentage: 9 })
    expect(sumLines(lines)).toBe(65358)
  })

  it('takes the VAT off before the venue recoups or shares anything', () => {
    const lines = buildGigDealInvoiceLines(terms({
      ...doorDealWithVat,
      venue_costs_cents: 20000,
      percentage_of_sales: 70,
    }))
    expect(kinds(lines)).toEqual([
      GIG_DEAL_LINE_KINDS.TICKET_REVENUE,
      GIG_DEAL_LINE_KINDS.TICKET_VAT,
      GIG_DEAL_LINE_KINDS.BREAK_EVEN_VENUE_COSTS,
      GIG_DEAL_LINE_KINDS.VENUE_SHARE,
    ])
    // (653.58 - 200.00) x 70% to the artist, the rest kept by the venue.
    expect(sumLines(lines)).toBe(Math.round((65358 - 20000) * 0.7))
  })

  it('bills no VAT line for a deal that agreed no ticket VAT', () => {
    const lines = buildGigDealInvoiceLines(terms({ ...doorDealWithVat, ticket_vat_percentage: null }))
    expect(kinds(lines)).toEqual([GIG_DEAL_LINE_KINDS.TICKET_REVENUE])
    expect(sumLines(lines)).toBe(71240)
  })

  it('bills no VAT line for a deal that is not subject to VAT', () => {
    const lines = buildGigDealInvoiceLines(terms({ ...doorDealWithVat, subject_to_vat: false }))
    expect(kinds(lines)).toEqual([GIG_DEAL_LINE_KINDS.TICKET_REVENUE])
    expect(sumLines(lines)).toBe(71240)
  })

  it.each([9, 7, 21, 5.5])('ties out with the artist statement at %s%% ticket VAT', (rate) => {
    for (const dealConfig of DEAL_CONFIGS) {
      const deal = terms({
        ...dealConfig,
        guaranteed_fee_cents: 25000,
        venue_costs_cents: 12345,
        tickets_sold: 137,
        ticket_price_net_cents: 1750,
        percentage_of_sales: 62.5,
        ticket_vat_percentage: rate,
      })
      const lines = buildGigDealInvoiceLines(deal)
      const statement = computeArtistStatement(deal)
      if (lines.length) expect(sumLines(lines)).toBe(statement.grossFeeCents)
      else expect(statement.grossFeeCents).toBe(0)
    }
  })
})

describe('shared deal registry', () => {
  it('has one reachable entry for every deal type and no extra entries', () => {
    const reachable = new Set()
    for (const { deal_type, guarantee_variant } of DEAL_CONFIGS) {
      reachable.add(dealDefinitionFor(deal_type, guarantee_variant))
    }
    expect(reachable).toEqual(new Set(Object.values(DEAL_REGISTRY)))
  })
})

describe('invoice-line rounding property', () => {
  it('ties every generated line set to the shared settlement exactly', () => {
    let state = 0x5eed1234
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 0x100000000
    }

    for (let index = 0; index < 500; index += 1) {
      const deal = terms({
        ...DEAL_CONFIGS[Math.floor(next() * DEAL_CONFIGS.length)],
        guaranteed_fee_cents: Math.floor(next() * 500000),
        venue_costs_cents: Math.floor(next() * 300000),
        tickets_sold: Math.floor(next() * 1000),
        ticket_price_net_cents: Math.floor(next() * 10000),
        percentage_of_sales: Math.round(next() * 10000) / 100,
        breakeven_includes_venue_costs: next() >= 0.5,
        subject_to_vat: next() >= 0.25,
        ticket_vat_percentage: [0, 9, 21][Math.floor(next() * 3)],
      })
      expect(sumLines(buildGigDealInvoiceLines(deal))).toBe(computeGigDealSettlement(deal).totalCents)
    }
  })
})
