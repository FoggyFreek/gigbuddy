import { describe, it, expect } from 'vitest'
import {
  computeArtistStatement,
  computeTicketUpside,
  dealTypeHasGuaranteedFee,
  dealTypeHasTicketShare,
  sumCostsCents,
} from '../dealTerms.ts'

// Minimal terms object; each test overrides only what it exercises.
function terms(overrides = {}) {
  return {
    deal_type: 'flat_fee',
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
    agency_fee_mode: 'exclusive',
    commission_basis: 'none',
    commission_percentage: 0,
    commission_amount_cents: 0,
    ...overrides,
  }
}

describe('deal type predicates', () => {
  it('gives every deal type except a door deal a guaranteed fee', () => {
    expect(dealTypeHasGuaranteedFee('flat_fee')).toBe(true)
    expect(dealTypeHasGuaranteedFee('guarantee')).toBe(true)
    expect(dealTypeHasGuaranteedFee('guarantee_plus')).toBe(true)
    expect(dealTypeHasGuaranteedFee('guarantee_vs')).toBe(true)
    expect(dealTypeHasGuaranteedFee('door_deal')).toBe(false)
  })

  it('gives every deal type except a flat fee a ticket share', () => {
    expect(dealTypeHasTicketShare('flat_fee')).toBe(false)
    expect(dealTypeHasTicketShare('guarantee')).toBe(true)
    expect(dealTypeHasTicketShare('guarantee_plus')).toBe(true)
    expect(dealTypeHasTicketShare('guarantee_vs')).toBe(true)
    expect(dealTypeHasTicketShare('door_deal')).toBe(true)
  })
})

describe('sumCostsCents', () => {
  it('sums the cost lines', () => {
    expect(sumCostsCents([{ amount_cents: 12500 }, { amount_cents: 2500 }])).toBe(15000)
  })

  it('treats a missing or unparsable amount as zero', () => {
    expect(sumCostsCents([{ amount_cents: null }, { amount_cents: '2500' }, {}])).toBe(2500)
  })

  it('is zero for no costs at all', () => {
    expect(sumCostsCents(null)).toBe(0)
    expect(sumCostsCents([])).toBe(0)
  })
})

describe('computeArtistStatement — gross, costs, nett', () => {
  it('derives the nett fee from the gross fee minus the itemised costs', () => {
    const s = computeArtistStatement(terms({
      deal_type: 'guarantee',
      guaranteed_fee_cents: 100000,
      costs: [{ amount_cents: 12500 }, { amount_cents: 2500 }],
    }))
    expect(s.grossFeeCents).toBe(100000)
    expect(s.costsCents).toBe(15000)
    expect(s.nettFeeCents).toBe(85000)
  })

  it('reports a zero gross fee for a door deal even when a fee is stored', () => {
    // Switching deal type must not silently pay out a fee the deal has no room
    // for — the stored value is kept so a switch back does not lose it.
    const s = computeArtistStatement(terms({ deal_type: 'door_deal', guaranteed_fee_cents: 100000 }))
    expect(s.grossFeeCents).toBe(0)
    expect(s.dueToArtistCents).toBe(0)
  })

  it('lets the nett fee go negative when costs exceed the fee', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 10000,
      costs: [{ amount_cents: 25000 }],
    }))
    expect(s.nettFeeCents).toBe(-15000)
  })

  it('reads percentages that arrive from Postgres as strings', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      agency_fee_basis: 'percentage',
      agency_fee_percentage: '10.00',
    }))
    expect(s.agencyFeeCents).toBe(10000)
  })
})

describe('computeArtistStatement — booking fee', () => {
  it('adds an exclusive booking fee on top, leaving the artist the full fee', () => {
    // Spec example: € 1000.00 gross with a 10% exclusive booking fee results in
    // € 100.00 due to booker and € 1000.00 due to artist.
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 10,
      agency_fee_mode: 'exclusive',
    }))
    expect(s.agencyFeeCents).toBe(10000)
    expect(s.dueToBookerCents).toBe(10000)
    expect(s.dueToArtistCents).toBe(100000)
  })

  it('splits an inclusive booking fee out of the gross fee', () => {
    // Spec example: € 1000.00 gross with a 10% inclusive booking fee results in
    // € 100.00 due to booker and € 900.00 due to artist.
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 10,
      agency_fee_mode: 'inclusive',
    }))
    expect(s.agencyFeeCents).toBe(10000)
    expect(s.dueToBookerCents).toBe(10000)
    expect(s.dueToArtistCents).toBe(90000)
  })

  it('takes a fixed booking fee as entered, ignoring the percentage', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      agency_fee_basis: 'amount',
      agency_fee_amount_cents: 7500,
      agency_fee_percentage: 10,
    }))
    expect(s.agencyFeeCents).toBe(7500)
  })

  it('charges no booking fee when the basis is none', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      agency_fee_basis: 'none',
      agency_fee_percentage: 10,
      agency_fee_amount_cents: 7500,
    }))
    expect(s.agencyFeeCents).toBe(0)
    expect(s.dueToArtistCents).toBe(100000)
  })

  it('calculates the booking fee percentage from the gross fee, not the nett fee', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      costs: [{ amount_cents: 50000 }],
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 10,
    }))
    expect(s.agencyFeeCents).toBe(10000)
  })
})

describe('computeArtistStatement — commission', () => {
  it('calculates commission from the nett fee and adds it to the booker', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      costs: [{ amount_cents: 15000 }],
      commission_basis: 'percentage',
      commission_percentage: 10,
    }))
    expect(s.nettFeeCents).toBe(85000)
    expect(s.commissionCents).toBe(8500)
    expect(s.dueToBookerCents).toBe(8500)
    expect(s.dueToArtistCents).toBe(76500)
  })

  it('takes a fixed commission as entered', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      commission_basis: 'amount',
      commission_amount_cents: 5000,
    }))
    expect(s.commissionCents).toBe(5000)
    expect(s.dueToArtistCents).toBe(95000)
  })

  it('stacks an inclusive booking fee and a commission on the booker', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      costs: [{ amount_cents: 15000 }],
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 10,
      agency_fee_mode: 'inclusive',
      commission_basis: 'percentage',
      commission_percentage: 10,
    }))
    expect(s.agencyFeeCents).toBe(10000)
    expect(s.commissionCents).toBe(8500)
    expect(s.dueToBookerCents).toBe(18500)
    expect(s.dueToArtistCents).toBe(85000 - 8500 - 10000)
  })

  it('rounds half up to whole cents', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 33333,
      commission_basis: 'percentage',
      commission_percentage: 7.5,
    }))
    expect(s.commissionCents).toBe(2500) // 2499.975 → 2500
  })
})

describe('computeTicketUpside — split', () => {
  it('derives the venue share from the artist share so the two total 100', () => {
    const u = computeTicketUpside(terms({ deal_type: 'guarantee', percentage_of_sales: 70 }))
    expect(u.artistPercentage).toBe(70)
    expect(u.venuePercentage).toBe(30)
  })

  it('treats an unset percentage as nothing for the artist', () => {
    const u = computeTicketUpside(terms({ deal_type: 'door_deal' }))
    expect(u.artistPercentage).toBe(0)
    expect(u.venuePercentage).toBe(100)
  })
})

describe('computeTicketUpside — break-even', () => {
  it('recoups the gross fee plus venue costs on a guarantee', () => {
    const u = computeTicketUpside(terms({
      deal_type: 'guarantee',
      guaranteed_fee_cents: 100000,
      venue_costs_cents: 80000,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 70,
    }))
    expect(u.breakEvenCents).toBe(180000)
    expect(u.breakEvenTickets).toBe(90)
  })

  it('rounds the break-even ticket count up to a whole ticket', () => {
    const u = computeTicketUpside(terms({
      deal_type: 'guarantee',
      guaranteed_fee_cents: 100000,
      venue_costs_cents: 500,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 70,
    }))
    expect(u.breakEvenCents).toBe(100500)
    expect(u.breakEvenTickets).toBe(51) // 50.25 tickets → 51
  })

  it('excludes venue costs from a guarantee+ break-even when the flag is off', () => {
    const base = {
      deal_type: 'guarantee_plus',
      guaranteed_fee_cents: 100000,
      venue_costs_cents: 80000,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 70,
    }
    expect(computeTicketUpside(terms({ ...base, breakeven_includes_venue_costs: true })).breakEvenCents).toBe(180000)
    expect(computeTicketUpside(terms({ ...base, breakeven_includes_venue_costs: false })).breakEvenCents).toBe(100000)
  })

  it('ignores the flag on a plain guarantee, where venue costs always count', () => {
    const u = computeTicketUpside(terms({
      deal_type: 'guarantee',
      guaranteed_fee_cents: 100000,
      venue_costs_cents: 80000,
      breakeven_includes_venue_costs: false,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 70,
    }))
    expect(u.breakEvenCents).toBe(180000)
  })

  it('recoups only the venue costs on a door deal', () => {
    const u = computeTicketUpside(terms({
      deal_type: 'door_deal',
      guaranteed_fee_cents: 100000,
      venue_costs_cents: 80000,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 70,
    }))
    expect(u.breakEvenCents).toBe(80000)
    expect(u.breakEvenTickets).toBe(40)
  })

  it('breaks even on a guarantee vs. where the ticket share overtakes the fee', () => {
    // € 1000.00 guarantee, € 20.00 net ticket, 50% share → € 10.00 per ticket,
    // so the share passes the guarantee at ticket 100.
    const u = computeTicketUpside(terms({
      deal_type: 'guarantee_vs',
      guaranteed_fee_cents: 100000,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 50,
    }))
    expect(u.breakEvenCents).toBe(100000)
    expect(u.breakEvenTickets).toBe(100)
  })

  it('has no break-even at all on a flat fee', () => {
    const u = computeTicketUpside(terms({
      deal_type: 'flat_fee',
      guaranteed_fee_cents: 100000,
      ticket_price_net_cents: 2000,
    }))
    expect(u.breakEvenCents).toBeNull()
    expect(u.breakEvenTickets).toBeNull()
  })

  it('cannot count break-even tickets without a net ticket price', () => {
    const u = computeTicketUpside(terms({
      deal_type: 'guarantee',
      guaranteed_fee_cents: 100000,
      venue_costs_cents: 80000,
      percentage_of_sales: 70,
    }))
    expect(u.breakEvenCents).toBe(180000)
    expect(u.breakEvenTickets).toBeNull()
  })

  it('cannot count break-even tickets on a guarantee vs. without a share', () => {
    const u = computeTicketUpside(terms({
      deal_type: 'guarantee_vs',
      guaranteed_fee_cents: 100000,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 0,
    }))
    expect(u.breakEvenTickets).toBeNull()
  })
})

describe('computeTicketUpside — scenarios', () => {
  const guarantee = {
    deal_type: 'guarantee',
    guaranteed_fee_cents: 100000,
    venue_costs_cents: 80000,
    ticket_price_net_cents: 2000,
    percentage_of_sales: 70,
    venue_capacity: 300,
    expected_visitors: 200,
    tickets_sold: 120,
  }

  it('reports the artist share at capacity as the potential upside', () => {
    const u = computeTicketUpside(terms(guarantee))
    // 300 × € 20.00 = € 6000.00, less € 1800.00 break-even = € 4200.00 × 70%
    expect(u.potential).toEqual({ tickets: 300, ticketRevenueCents: 600000, artistShareCents: 294000 })
  })

  it('simulates the expected visitors alongside the tickets actually sold', () => {
    const u = computeTicketUpside(terms(guarantee))
    // 200 × € 20.00 = € 4000.00 − € 1800.00 = € 2200.00 × 70%
    expect(u.expected).toEqual({ tickets: 200, ticketRevenueCents: 400000, artistShareCents: 154000 })
    // 120 × € 20.00 = € 2400.00 − € 1800.00 = € 600.00 × 70%
    expect(u.sold).toEqual({ tickets: 120, ticketRevenueCents: 240000, artistShareCents: 42000 })
  })

  it('never pays a negative share below break-even', () => {
    const u = computeTicketUpside(terms({ ...guarantee, tickets_sold: 10 }))
    expect(u.sold.artistShareCents).toBe(0)
  })

  it('leaves a scenario out entirely when its attendance is unknown', () => {
    const u = computeTicketUpside(terms({ ...guarantee, expected_visitors: null, tickets_sold: null }))
    expect(u.expected).toBeNull()
    expect(u.sold).toBeNull()
    expect(u.potential).not.toBeNull()
  })

  it('pays nothing from tickets on a flat fee', () => {
    const u = computeTicketUpside(terms({ ...guarantee, deal_type: 'flat_fee' }))
    expect(u.potential.artistShareCents).toBe(0)
    expect(u.sold.artistShareCents).toBe(0)
  })

  it('counts a door deal share from the first ticket past the venue costs', () => {
    const u = computeTicketUpside(terms({ ...guarantee, deal_type: 'door_deal' }))
    // 300 × € 20.00 = € 6000.00 − € 800.00 venue costs = € 5200.00 × 70%
    expect(u.potential.artistShareCents).toBe(364000)
  })

  it('reports only the excess over the guarantee on a guarantee vs.', () => {
    const u = computeTicketUpside(terms({
      deal_type: 'guarantee_vs',
      guaranteed_fee_cents: 100000,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 50,
      venue_capacity: 300,
      tickets_sold: 60,
    }))
    // At capacity: 300 × € 20.00 × 50% = € 3000.00, less the € 1000.00 guarantee.
    expect(u.potential.artistShareCents).toBe(200000)
    // 60 tickets → € 600.00 share, below the guarantee, so no upside.
    expect(u.sold.artistShareCents).toBe(0)
  })
})
