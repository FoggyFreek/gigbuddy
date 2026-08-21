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
    copyright_percentage: null,
    ...overrides,
  }
  if (result.deal_type === 'guarantee' && !Object.hasOwn(overrides, 'guarantee_variant')) {
    result.guarantee_variant = 'plus'
  }
  return result
}

describe('deal type predicates', () => {
  it('gives every deal type except a door deal a guaranteed fee', () => {
    expect(dealTypeHasGuaranteedFee('flat_fee')).toBe(true)
    expect(dealTypeHasGuaranteedFee('guarantee')).toBe(true)
    expect(dealTypeHasGuaranteedFee('door_deal')).toBe(false)
  })

  it('gives every deal type except a flat fee a ticket share', () => {
    expect(dealTypeHasTicketShare('flat_fee')).toBe(false)
    expect(dealTypeHasTicketShare('guarantee')).toBe(true)
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
  it('sums itemised costs into the Costs figure, whoever pays them', () => {
    const s = computeArtistStatement(terms({
      deal_type: 'guarantee',
      guaranteed_fee_cents: 100000,
      costs: [{ amount_cents: 12500 }, { amount_cents: 2500 }],
    }))
    expect(s.grossFeeCents).toBe(100000)
    expect(s.costsCents).toBe(15000)
    // Both lines default to paid_by artist, which never reaches the nett fee
    // — only the shared artist_agency portion does, and there is none here.
    expect(s.nettFeeCents).toBe(100000)
  })

  it('reports a zero gross fee for a door deal even when a fee is stored', () => {
    // Switching deal type must not silently pay out a fee the deal has no room
    // for — the stored value is kept so a switch back does not lose it.
    const s = computeArtistStatement(terms({ deal_type: 'door_deal', guaranteed_fee_cents: 100000 }))
    expect(s.grossFeeCents).toBe(0)
    expect(s.dueToArtistCents).toBe(0)
  })

  it('lets the nett fee go negative when an artist_agency cost exceeds the fee', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 10000,
      costs: [{ amount_cents: 25000, paid_by: 'artist_agency' }],
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

  it('does not depend on expected visitors or venue capacity', () => {
    const deal = terms({
      deal_type: 'guarantee',
      guarantee_variant: 'plus',
      guaranteed_fee_cents: 100000,
      venue_costs_cents: 50000,
      tickets_sold: 160,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 67.5,
    })
    expect(computeArtistStatement({ ...deal, expected_visitors: 0, venue_capacity: 0 })).toEqual(
      computeArtistStatement({ ...deal, expected_visitors: 999999, venue_capacity: 999999 }),
    )
  })

  it('does not depend on the display-only gross ticket price', () => {
    const deal = terms({
      deal_type: 'door_deal',
      venue_costs_cents: 50000,
      tickets_sold: 160,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 67.5,
    })
    const baseline = {
      statement: computeArtistStatement(deal),
      upside: computeTicketUpside(deal),
    }
    for (const ticket_price_gross_cents of [null, 0, 2420, 999999]) {
      expect({
        statement: computeArtistStatement({ ...deal, ticket_price_gross_cents }),
        upside: computeTicketUpside({ ...deal, ticket_price_gross_cents }),
      }).toEqual(baseline)
    }
  })
})

describe('computeArtistStatement — booking fee', () => {
  it('splits a booking fee out of the gross fee', () => {
    // Spec example: € 1000.00 gross with a 10% booking fee results in
    // € 100.00 due to booker and € 900.00 due to artist.
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 10,
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
  it('calculates commission from the nett fee, unaffected by a cost the artist alone pays', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      costs: [{ amount_cents: 15000 }], // defaults to paid_by artist
      commission_basis: 'percentage',
      commission_percentage: 10,
    }))
    expect(s.nettFeeCents).toBe(100000) // the artist-only cost never reaches it
    expect(s.commissionBaseCents).toBe(100000) // no booking fee agreed, so nothing to net out
    expect(s.commissionCents).toBe(10000)
    expect(s.dueToBookerCents).toBe(10000)
    // The cost is deducted only here, when due to the artist is calculated.
    expect(s.dueToArtistCents).toBe(75000)
  })

  it('nets the booking fee out of the nett fee before taking the commission', () => {
    // Spec example: € 200.00 gross, 10% booking fee (€ 20.00) leaves
    // € 180.00 for the commission base, so a 10% commission is € 18.00 — €
    // 38.00 due to the booker and € 162.00 due to the artist.
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 20000,
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 10,
      commission_basis: 'percentage',
      commission_percentage: 10,
    }))
    expect(s.nettFeeCents).toBe(20000)
    expect(s.agencyFeeCents).toBe(2000)
    expect(s.commissionBaseCents).toBe(18000)
    expect(s.commissionCents).toBe(1800)
    expect(s.dueToBookerCents).toBe(3800)
    expect(s.dueToArtistCents).toBe(16200)
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

  it('stacks a booking fee and a commission on the booker, unaffected by an artist-paid cost', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      costs: [{ amount_cents: 15000 }], // defaults to paid_by artist
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 10,
      commission_basis: 'percentage',
      commission_percentage: 10,
    }))
    expect(s.agencyFeeCents).toBe(10000)
    expect(s.commissionBaseCents).toBe(90000) // nett fee 100000 minus the 10000 booking fee
    expect(s.commissionCents).toBe(9000)
    expect(s.dueToBookerCents).toBe(19000)
    // The artist-paid cost lands only here, on top of the booking fee and commission.
    expect(s.dueToArtistCents).toBe(100000 - 9000 - 10000 - 15000)
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

describe('computeArtistStatement — a booking fee is never negative, a commission can be', () => {
  it('lets the commission go negative once an artist_agency cost has eaten the fee', () => {
    // Unlike the booking fee, commission is not floored: a percentage of a
    // negative commission base credits the booker rather than charging nothing.
    // Only an artist_agency cost reaches the commission base at all — an
    // artist- or agency-only cost is deducted downstream of it instead.
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 40000,
      costs: [{ amount_cents: 65000, paid_by: 'artist_agency' }],
      commission_basis: 'percentage',
      commission_percentage: 10,
    }))
    expect(s.nettFeeCents).toBe(-25000)
    expect(s.commissionBaseCents).toBe(-25000) // no booking fee agreed, so nothing to net out
    expect(s.commissionCents).toBe(-2500)
    expect(s.dueToBookerCents).toBe(-2500)
    expect(s.dueToArtistCents).toBe(-22500)
  })

  it('charges no booking fee without a positive gross fee', () => {
    const s = computeArtistStatement(terms({
      deal_type: 'door_deal',
      tickets_sold: 0,
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 15,
    }))
    expect(s.grossFeeCents).toBe(0)
    expect(s.agencyFeeCents).toBe(0)
  })

  it('floors a booking fee on a gross fee that somehow arrives negative', () => {
    // The server rejects negative amounts, so this is defence in depth against
    // data the engine should never have to trust.
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: -100000,
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 10,
    }))
    expect(s.agencyFeeCents).toBe(0)
  })

  it('floors a negative fixed booking fee but lets a negative fixed commission stand', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 100000,
      agency_fee_basis: 'amount',
      agency_fee_amount_cents: -7500,
      commission_basis: 'amount',
      commission_amount_cents: -5000,
    }))
    expect(s.agencyFeeCents).toBe(0)
    expect(s.commissionCents).toBe(-5000)
    expect(s.dueToBookerCents).toBe(-5000)
  })

  it('still charges an agreed fixed fee on a gig that loses money', () => {
    // Flooring is about negative fees, not about waiving what was agreed.
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 40000,
      costs: [{ amount_cents: 65000 }],
      agency_fee_basis: 'amount',
      agency_fee_amount_cents: 10000,
      commission_basis: 'amount',
      commission_amount_cents: 5000,
    }))
    expect(s.agencyFeeCents).toBe(10000)
    expect(s.commissionCents).toBe(5000)
    expect(s.dueToBookerCents).toBe(15000)
    expect(s.dueToArtistCents).toBe(-40000)
  })
})

describe('computeArtistStatement — paid_by splits how a cost moves through the statement', () => {
  // One shared base for the three: a € 5000.00 guarantee, a 20% booking
  // booking fee, no commission — so the only thing that varies is who a
  // € 100.00 cost line is paid by.
  function baseTerms(paidBy) {
    return terms({
      guaranteed_fee_cents: 500000,
      costs: [{ amount_cents: 10000, paid_by: paidBy }],
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 20,
    })
  }

  it('artist_agency: comes off the gross fee before the booking fee, so both sides bear it', () => {
    const s = computeArtistStatement(baseTerms('artist_agency'))
    expect(s.bookingFeeBaseCents).toBe(490000) // 500000 - 10000
    expect(s.agencyFeeCents).toBe(98000) // 20% of the reduced base
    expect(s.costsCents).toBe(10000)
    expect(s.costsPaidByAgencyCents).toBe(0)
    expect(s.nettFeeCents).toBe(490000)
    expect(s.dueToBookerCents).toBe(98000)
    expect(s.dueToArtistCents).toBe(392000) // 490000 - 98000
  })

  it('artist: leaves the booking fee and the nett fee untouched, comes off only due to artist', () => {
    const s = computeArtistStatement(baseTerms('artist'))
    expect(s.bookingFeeBaseCents).toBe(500000) // unaffected
    expect(s.agencyFeeCents).toBe(100000) // 20% of the full gross fee
    expect(s.costsCents).toBe(10000)
    expect(s.costsPaidByAgencyCents).toBe(0)
    expect(s.costsPaidByArtistCents).toBe(10000)
    expect(s.nettFeeCents).toBe(500000) // unaffected — the cost is deducted only from due to artist
    expect(s.dueToBookerCents).toBe(100000)
    expect(s.dueToArtistCents).toBe(390000) // 500000 - 100000 - 10000
  })

  it('agency: leaves due-to-artist untouched and comes off only what is due to the booker', () => {
    const s = computeArtistStatement(baseTerms('agency'))
    expect(s.bookingFeeBaseCents).toBe(500000) // unaffected
    expect(s.agencyFeeCents).toBe(100000) // 20% of the full gross fee
    // costsCents is the full total regardless of who pays; agency-paid costs
    // are in it even though they never reach the nett fee.
    expect(s.costsCents).toBe(10000)
    expect(s.costsPaidByAgencyCents).toBe(10000)
    expect(s.nettFeeCents).toBe(500000)
    expect(s.dueToBookerCents).toBe(90000) // 100000 - 10000
    expect(s.dueToArtistCents).toBe(400000) // unaffected: 500000 - 100000
  })

  it('reads a missing paid_by as artist — the pre-existing behaviour', () => {
    const withPaidBy = computeArtistStatement(baseTerms('artist'))
    const withoutPaidBy = computeArtistStatement(terms({
      guaranteed_fee_cents: 500000,
      costs: [{ amount_cents: 10000 }],
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 20,
    }))
    expect(withoutPaidBy).toEqual(withPaidBy)
  })

  it('mixes all three kinds in one statement', () => {
    const s = computeArtistStatement(terms({
      guaranteed_fee_cents: 500000,
      costs: [
        { amount_cents: 10000, paid_by: 'artist_agency' },
        { amount_cents: 5000, paid_by: 'artist' },
        { amount_cents: 2000, paid_by: 'agency' },
      ],
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 20,
    }))
    expect(s.bookingFeeBaseCents).toBe(490000) // 500000 - 10000 (artist_agency only)
    expect(s.agencyFeeCents).toBe(98000)
    expect(s.costsCents).toBe(17000) // artist_agency + artist + agency
    expect(s.costsPaidByAgencyCents).toBe(2000)
    expect(s.costsPaidByArtistCents).toBe(5000)
    expect(s.nettFeeCents).toBe(490000) // 500000 - 10000 (artist_agency only)
    expect(s.dueToBookerCents).toBe(96000) // 98000 - 2000
    expect(s.dueToArtistCents).toBe(387000) // 490000 - 98000 - 5000
  })

  it('reconciles the gross fee across every deal, cost payer and commission choice', () => {
    const deals = [
      { deal_type: 'flat_fee', guarantee_variant: null },
      { deal_type: 'guarantee', guarantee_variant: 'plus' },
      { deal_type: 'guarantee', guarantee_variant: 'versus' },
      { deal_type: 'door_deal', guarantee_variant: null },
    ]
    const paidByKinds = ['artist_agency', 'artist', 'agency']
    const commissions = [
      { commission_basis: 'none', commission_percentage: 0 },
      { commission_basis: 'percentage', commission_percentage: 7.5 },
    ]

    for (const deal of deals) {
      for (const paid_by of paidByKinds) {
        for (const commission of commissions) {
          const statement = computeArtistStatement(terms({
            ...deal,
            guaranteed_fee_cents: 100000,
            venue_costs_cents: 10000,
            tickets_sold: 200,
            ticket_price_net_cents: 1500,
            percentage_of_sales: 65,
            costs: [{ amount_cents: 12345, paid_by }],
            agency_fee_basis: 'percentage',
            agency_fee_percentage: 12.5,
            ...commission,
          }))

          expect(
            statement.dueToArtistCents
              + statement.dueToBookerCents
              + statement.costsCents,
          ).toBe(statement.grossFeeCents)
        }
      }
    }
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
      deal_type: 'guarantee',
      guarantee_variant: 'plus',
      guaranteed_fee_cents: 100000,
      venue_costs_cents: 80000,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 70,
    }
    expect(computeTicketUpside(terms({ ...base, breakeven_includes_venue_costs: true })).breakEvenCents).toBe(180000)
    expect(computeTicketUpside(terms({ ...base, breakeven_includes_venue_costs: false })).breakEvenCents).toBe(100000)
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

  it('has no break-even at all on a guarantee vs. — the deal just pays the higher of the two', () => {
    // Nothing is recouped: the door's percentage runs from ticket one at the
    // full share, and the deal pays whichever of that and the guarantee is
    // higher — there is no threshold to clear either in money or in tickets.
    const u = computeTicketUpside(terms({
      deal_type: 'guarantee',
      guarantee_variant: 'versus',
      guaranteed_fee_cents: 100000,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 50,
    }))
    expect(u.breakEvenCents).toBe(0)
    expect(u.breakEvenTickets).toBe(0)
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

  it('reports zero break-even tickets on a guarantee vs. even without a share agreed', () => {
    // There is nothing to break even on regardless of the percentage.
    const u = computeTicketUpside(terms({
      deal_type: 'guarantee',
      guarantee_variant: 'versus',
      guaranteed_fee_cents: 100000,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 0,
    }))
    expect(u.breakEvenTickets).toBe(0)
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
    expect(u.potential).toEqual({
      tickets: 300,
      ticketRevenueCents: 600000,
      ticketVatCents: 0,
      artistShareCents: 294000,
    })
  })

  it('simulates the expected visitors alongside the tickets actually sold', () => {
    const u = computeTicketUpside(terms(guarantee))
    // 200 × € 20.00 = € 4000.00 − € 1800.00 = € 2200.00 × 70%
    expect(u.expected).toEqual({
      tickets: 200,
      ticketRevenueCents: 400000,
      ticketVatCents: 0,
      artistShareCents: 154000,
    })
    // 120 × € 20.00 = € 2400.00 − € 1800.00 = € 600.00 × 70%
    expect(u.sold).toEqual({
      tickets: 120,
      ticketRevenueCents: 240000,
      ticketVatCents: 0,
      artistShareCents: 42000,
    })
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

  it('reports the full door share on a guarantee vs., not the excess over the guarantee', () => {
    const u = computeTicketUpside(terms({
      deal_type: 'guarantee',
      guarantee_variant: 'versus',
      guaranteed_fee_cents: 100000,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 50,
      venue_capacity: 300,
      tickets_sold: 60,
    }))
    // At capacity: 300 × € 20.00 × 50% = € 3000.00 — the full share, even
    // though it is € 2000.00 over the guarantee.
    expect(u.potential.artistShareCents).toBe(300000)
    // 60 tickets → € 600.00 full share, even though it is below the
    // guarantee — the comparison against the guarantee happens only in the
    // artist statement's gross fee, not here.
    expect(u.sold.artistShareCents).toBe(60000)
  })
})

describe('computeArtistStatement — guarantee vs. pays the guarantee or the ticket share, never both', () => {
  // € 1000.00 guarantee, € 20.00 net ticket, 50% share → € 10.00 per ticket.
  const guaranteeVs = {
    deal_type: 'guarantee',
    guarantee_variant: 'versus',
    guaranteed_fee_cents: 100000,
    ticket_price_net_cents: 2000,
    percentage_of_sales: 50,
  }

  it('pays the guarantee alone when the ticket share falls short of it', () => {
    // 60 tickets × € 10.00 = € 600.00 share, below the € 1000.00 guarantee.
    const s = computeArtistStatement(terms({ ...guaranteeVs, tickets_sold: 60 }))
    expect(s.ticketRevenueCents).toBe(0)
    expect(s.grossFeeCents).toBe(100000) // the guarantee alone — not guarantee + share
  })

  it('pays the guarantee alone when the ticket share exactly matches it', () => {
    // 100 tickets × € 10.00 = € 1000.00 share, exactly the guarantee.
    const s = computeArtistStatement(terms({ ...guaranteeVs, tickets_sold: 100 }))
    expect(s.ticketRevenueCents).toBe(0)
    expect(s.grossFeeCents).toBe(100000)
  })

  it('pays the ticket share alone once it overtakes the guarantee — not the sum of the two', () => {
    // 300 tickets × € 10.00 = € 3000.00 share, € 2000.00 over the guarantee.
    const s = computeArtistStatement(terms({ ...guaranteeVs, tickets_sold: 300 }))
    expect(s.ticketRevenueCents).toBe(200000) // only the excess is reported as ticket revenue
    // The excess is added to the guarantee, so the total is the full ticket
    // share (€ 3000.00) — never the guarantee plus the whole share.
    expect(s.grossFeeCents).toBe(300000)
    expect(s.grossFeeCents).not.toBe(s.guaranteedFeeCents + 300000)
  })

  it('is the higher of the guarantee and the ticket share at every point in between', () => {
    for (const ticketsSold of [0, 60, 100, 150, 199, 200, 201, 250, 300]) {
      const s = computeArtistStatement(terms({ ...guaranteeVs, tickets_sold: ticketsSold }))
      const shareCents = ticketsSold * 1000 // € 10.00 a ticket
      expect(s.grossFeeCents).toBe(Math.max(100000, shareCents))
    }
  })
})

describe('computeArtistStatement — ticket revenue in the gross fee', () => {
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

  it('adds the share earned on the tickets sold to the gross fee', () => {
    const s = computeArtistStatement(terms(guarantee))
    // 120 x EUR 20.00 = EUR 2400.00 - EUR 1800.00 break-even = EUR 600.00 x 70%
    expect(s.guaranteedFeeCents).toBe(100000)
    expect(s.ticketRevenueCents).toBe(42000)
    expect(s.grossFeeCents).toBe(142000)
  })

  it('agrees with the sold scenario of the ticket upside', () => {
    const s = computeArtistStatement(terms(guarantee))
    const u = computeTicketUpside(terms(guarantee))
    expect(s.ticketRevenueCents).toBe(u.sold.artistShareCents)
  })

  it('charges the booking fee and the commission over the fee including tickets', () => {
    const s = computeArtistStatement(terms({
      ...guarantee,
      costs: [{ amount_cents: 15000 }],
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 10,
      commission_basis: 'percentage',
      commission_percentage: 10,
    }))
    expect(s.nettFeeCents).toBe(142000) // unaffected — the cost defaults to paid_by artist
    expect(s.agencyFeeCents).toBe(14200) // 10% of EUR 1420.00, not of the guarantee
    expect(s.commissionBaseCents).toBe(127800) // nett fee 142000 minus the 14200 booking fee
    expect(s.commissionCents).toBe(12780)
  })

  it('counts nothing from the door while the tickets sold are unknown', () => {
    const s = computeArtistStatement(terms({ ...guarantee, tickets_sold: null }))
    expect(s.ticketRevenueCents).toBe(0)
    expect(s.grossFeeCents).toBe(100000)
  })

  it('counts nothing from the door below break-even', () => {
    const s = computeArtistStatement(terms({ ...guarantee, tickets_sold: 50 }))
    expect(s.ticketRevenueCents).toBe(0)
    expect(s.grossFeeCents).toBe(100000)
  })

  it('leaves a flat fee untouched by the tickets sold', () => {
    const s = computeArtistStatement(terms({ ...guarantee, deal_type: 'flat_fee', tickets_sold: 300 }))
    expect(s.ticketRevenueCents).toBe(0)
    expect(s.grossFeeCents).toBe(100000)
  })

  it('builds a door deal gross fee entirely out of ticket revenue', () => {
    const s = computeArtistStatement(terms({ ...guarantee, deal_type: 'door_deal' }))
    // 120 x EUR 20.00 = EUR 2400.00 - EUR 800.00 venue costs = EUR 1600.00 x 70%
    expect(s.guaranteedFeeCents).toBe(0)
    expect(s.ticketRevenueCents).toBe(112000)
    expect(s.grossFeeCents).toBe(112000)
  })
})

// End-to-end deals as they are actually agreed: one terms object read back as
// both the statement and the simulation, so the two views are checked together.
describe('realistic deals', () => {
  it('settles a club guarantee with a booking fee and commission', () => {
    // EUR 1500.00 guarantee, EUR 600.00 venue costs, 70/30 split on a EUR 17.50
    // nett ticket, 400 capacity, 250 expected, 300 sold. Agent takes 10% from
    // the gross fee, management 5% of the nett fee.
    const deal = terms({
      deal_type: 'guarantee',
      guaranteed_fee_cents: 150000,
      venue_costs_cents: 60000,
      ticket_price_net_cents: 1750,
      ticket_price_gross_cents: 2118,
      percentage_of_sales: '70.00',
      venue_capacity: 400,
      expected_visitors: 250,
      tickets_sold: 300,
      costs: [{ amount_cents: 25000 }, { amount_cents: 15000 }],
      agency_fee_basis: 'percentage',
      agency_fee_percentage: '10.00',
      commission_basis: 'percentage',
      commission_percentage: '5.00',
    })

    const u = computeTicketUpside(deal)
    expect(u.breakEvenCents).toBe(210000) // fee + venue costs
    expect(u.breakEvenTickets).toBe(120)
    expect(u.sold).toMatchObject({ tickets: 300, ticketRevenueCents: 525000, artistShareCents: 220500 })
    expect(u.expected).toMatchObject({ tickets: 250, ticketRevenueCents: 437500, artistShareCents: 159250 })
    expect(u.potential).toMatchObject({ tickets: 400, ticketRevenueCents: 700000, artistShareCents: 343000 })

    const s = computeArtistStatement(deal)
    expect(s.grossFeeCents).toBe(370500) // EUR 1500.00 + EUR 2205.00 from the door
    expect(s.costsCents).toBe(40000)
    expect(s.nettFeeCents).toBe(370500) // unaffected — both costs default to paid_by artist
    expect(s.agencyFeeCents).toBe(37050)
    expect(s.commissionBaseCents).toBe(333450) // nett fee minus the booking fee
    expect(s.commissionCents).toBe(16673) // 5% of EUR 3334.50, rounded half up
    expect(s.dueToBookerCents).toBe(53723)
    expect(s.dueToArtistCents).toBe(276777)
  })

  it('settles a door deal where the whole fee comes from the door', () => {
    // 80/20 door split after EUR 400.00 venue costs, EUR 12.50 nett ticket,
    // 180 of 250 sold, 15% management commission, no agent.
    const deal = terms({
      deal_type: 'door_deal',
      guaranteed_fee_cents: 0,
      venue_costs_cents: 40000,
      ticket_price_net_cents: 1250,
      percentage_of_sales: 80,
      venue_capacity: 250,
      expected_visitors: 150,
      tickets_sold: 180,
      costs: [{ amount_cents: 30000 }],
      commission_basis: 'percentage',
      commission_percentage: 15,
    })

    const u = computeTicketUpside(deal)
    expect(u.artistPercentage).toBe(80)
    expect(u.venuePercentage).toBe(20)
    expect(u.breakEvenCents).toBe(40000)
    expect(u.breakEvenTickets).toBe(32)
    expect(u.sold.artistShareCents).toBe(148000)
    expect(u.expected.artistShareCents).toBe(118000)
    expect(u.potential.artistShareCents).toBe(218000)

    const s = computeArtistStatement(deal)
    expect(s.guaranteedFeeCents).toBe(0)
    expect(s.grossFeeCents).toBe(148000)
    expect(s.nettFeeCents).toBe(148000) // unaffected — the cost defaults to paid_by artist
    expect(s.commissionCents).toBe(22200)
    expect(s.dueToArtistCents).toBe(95800)
  })

  it('settles a guarantee vs. at the point where the door overtakes the fee', () => {
    // EUR 2000.00 or 60% of the door, whichever is higher; EUR 22.50 nett
    // ticket, 200 of 500 sold, 15% booking fee.
    const deal = terms({
      deal_type: 'guarantee',
      guarantee_variant: 'versus',
      guaranteed_fee_cents: 200000,
      ticket_price_net_cents: 2250,
      percentage_of_sales: 60,
      venue_capacity: 500,
      expected_visitors: 300,
      tickets_sold: 200,
      costs: [{ amount_cents: 50000 }],
      agency_fee_basis: 'percentage',
      agency_fee_percentage: 15,
    })

    const u = computeTicketUpside(deal)
    // Nothing is recouped on a guarantee vs. — the guarantee and the full
    // door share are two independent totals, compared directly, so there is
    // no break-even in money or in tickets.
    expect(u.breakEvenCents).toBe(0)
    expect(u.breakEvenTickets).toBe(0)
    // The full door share at each attendance, not the excess over the fee.
    expect(u.sold.artistShareCents).toBe(270000) // 200 x EUR 22.50 x 60%
    expect(u.expected.artistShareCents).toBe(405000) // 300 x EUR 22.50 x 60%
    expect(u.potential.artistShareCents).toBe(675000) // 500 x EUR 22.50 x 60%

    const s = computeArtistStatement(deal)
    // Guarantee plus the excess is the higher of the two, as a vs. deal pays.
    expect(s.grossFeeCents).toBe(270000)
    expect(s.nettFeeCents).toBe(270000) // unaffected — the cost defaults to paid_by artist
    expect(s.agencyFeeCents).toBe(40500)
    // The booking fee comes out of the artist's side.
    expect(s.dueToArtistCents).toBe(179500)
  })

  it('settles a guarantee+ that leaves the venue costs out of break-even', () => {
    // EUR 1200.00 plus 50% of the door from the first ticket past the fee; the
    // venue carries its own EUR 900.00 of costs.
    const deal = terms({
      deal_type: 'guarantee',
      guarantee_variant: 'plus',
      guaranteed_fee_cents: 120000,
      venue_costs_cents: 90000,
      breakeven_includes_venue_costs: false,
      ticket_price_net_cents: 2000,
      percentage_of_sales: 50,
      venue_capacity: 250,
      tickets_sold: 150,
      costs: [{ amount_cents: 20000 }],
      commission_basis: 'amount',
      commission_amount_cents: 25000,
    })

    const u = computeTicketUpside(deal)
    expect(u.breakEvenCents).toBe(120000)
    expect(u.breakEvenTickets).toBe(60)
    expect(u.sold.artistShareCents).toBe(90000) // EUR 3000.00 - EUR 1200.00, halved
    expect(u.potential.artistShareCents).toBe(190000)

    const s = computeArtistStatement(deal)
    expect(s.grossFeeCents).toBe(210000)
    expect(s.nettFeeCents).toBe(210000) // unaffected — the cost defaults to paid_by artist
    expect(s.commissionCents).toBe(25000)
    expect(s.dueToArtistCents).toBe(165000)
  })

  it('settles a flat fee that a full house does not change', () => {
    const deal = terms({
      deal_type: 'flat_fee',
      guaranteed_fee_cents: 80000,
      ticket_price_net_cents: 1500,
      percentage_of_sales: 70, // stale input from another deal type
      venue_capacity: 300,
      tickets_sold: 300,
      costs: [{ amount_cents: 12500 }],
      agency_fee_basis: 'amount',
      agency_fee_amount_cents: 10000,
    })

    const u = computeTicketUpside(deal)
    expect(u.breakEvenCents).toBeNull()
    expect(u.sold.artistShareCents).toBe(0)
    expect(u.potential.artistShareCents).toBe(0)

    const s = computeArtistStatement(deal)
    expect(s.ticketRevenueCents).toBe(0)
    expect(s.grossFeeCents).toBe(80000)
    expect(s.nettFeeCents).toBe(80000) // unaffected — the cost defaults to paid_by artist
    expect(s.dueToArtistCents).toBe(57500)
  })
})

// The nett ticket price is what the door takes per ticket, VAT included. The
// venue's VAT on it is not the artist's money, so every figure derived from
// ticket revenue runs on the revenue with that VAT taken out.
describe('computeTicketUpside — ticket VAT', () => {
  const doorDeal = {
    deal_type: 'door_deal',
    venue_costs_cents: 0,
    ticket_price_net_cents: 2500,
    percentage_of_sales: 100,
    venue_capacity: 100,
    expected_visitors: 50,
    tickets_sold: 1,
    subject_to_vat: true,
    ticket_vat_percentage: 7,
  }

  it('bases the simulation on the ticket price with its VAT taken out', () => {
    const u = computeTicketUpside(terms(doorDeal))
    // $ 25.00 at 7% is $ 23.36 of ticket money and $ 1.64 of the venue's VAT.
    expect(u.ticketPriceExVatCents).toBe(2336)
    expect(u.sold).toEqual({
      tickets: 1,
      ticketRevenueCents: 2500,
      ticketVatCents: 164,
      artistShareCents: 2336,
    })
  })

  it('takes the VAT out of the revenue once, not once per ticket', () => {
    const u = computeTicketUpside(terms(doorDeal))
    // 100 × € 25.00 = € 2500.00, of which 7/107 is € 163.55 of VAT — not the
    // € 164.00 that rounding € 1.64 off every ticket would have produced.
    expect(u.potential.ticketVatCents).toBe(16355)
    expect(u.potential.artistShareCents).toBe(250000 - 16355)
  })

  it('leaves the revenue alone when no ticket VAT was agreed', () => {
    const u = computeTicketUpside(terms({ ...doorDeal, ticket_vat_percentage: null }))
    expect(u.ticketVatPercentage).toBe(0)
    expect(u.ticketPriceExVatCents).toBe(2500)
    expect(u.sold.ticketVatCents).toBe(0)
    expect(u.sold.artistShareCents).toBe(2500)
  })

  it('ignores a ticket rate on a deal that is not subject to VAT', () => {
    const u = computeTicketUpside(terms({ ...doorDeal, subject_to_vat: false }))
    expect(u.ticketVatPercentage).toBe(0)
    expect(u.sold.artistShareCents).toBe(2500)
  })

  it('needs more tickets to break even once VAT comes off each of them', () => {
    const withoutVat = computeTicketUpside(terms({
      ...doorDeal,
      venue_costs_cents: 100000,
      ticket_vat_percentage: null,
    }))
    const withVat = computeTicketUpside(terms({ ...doorDeal, venue_costs_cents: 100000 }))
    // € 1000.00 of venue costs at € 25.00 a ticket, VAT included: 40 tickets
    // become 43 once each only brings in € 23.36.
    expect(withoutVat.breakEvenTickets).toBe(40)
    expect(withVat.breakEvenTickets).toBe(43)
  })

  it('carries the VAT-corrected share into the artist statement', () => {
    const deal = terms({ ...doorDeal, tickets_sold: 100 })
    expect(computeArtistStatement(deal).ticketRevenueCents).toBe(250000 - 16355)
  })
})

describe('computeTicketUpside - Copyright / PRS', () => {
  const doorDeal = {
    deal_type: 'door_deal',
    venue_costs_cents: 0,
    ticket_price_net_cents: 2500,
    percentage_of_sales: 100,
    venue_capacity: 100,
    expected_visitors: 50,
    tickets_sold: 1,
    subject_to_vat: true,
    ticket_vat_percentage: 7,
    copyright_percentage: 10,
  }

  it('calculates copyright on ticket revenue after VAT is removed', () => {
    const u = computeTicketUpside(terms(doorDeal))
    expect(u.sold).toMatchObject({
      ticketRevenueCents: 2500,
      ticketVatCents: 164,
      copyrightCents: 234,
      artistShareCents: 2102,
    })
  })

  it('ignores an empty copyright percentage', () => {
    const u = computeTicketUpside(terms({ ...doorDeal, copyright_percentage: null }))
    expect(u.copyrightPercentage).toBe(0)
    expect(u.sold.artistShareCents).toBe(2336)
  })
})
