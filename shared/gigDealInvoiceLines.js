// The invoice-line decomposition of a gig's deal, shared by the server (which
// pre-fills the invoice draft) and the frontend (whose Terms tab shows the same
// figures in the artist statement).
//
// A flat fee invoices as the one line it is. Every other deal type pays the
// artist some share of what the door took, so the amount owed is only legible
// as the calculation that produced it — and the venue is billed for that
// calculation line by line: what the tickets brought in, what is recouped or
// offset before the artist shares in them, and the venue's cut of the rest.
//
// The maths mirrors src/planning/gigs/dealTerms.ts (the display side of the
// same deal) and the two are pinned together by a test: the lines always sum to
// that module's gross fee — the guarantee plus the share earned on the tickets
// sold so far. What the artist then owes their booker, and what their own costs
// were, is between them and their booker; the venue is not billed for it.
//
// Adding a deal type is adding one entry to DEAL_SETTLEMENTS plus a label for
// any deduction kind it introduces. Nothing else here branches on deal_type.
//
// All money is integer cents; percentages arrive as numbers from the form and
// as strings from Postgres NUMERIC, so every read goes through toNumber().
import { gigTicketVatPercentage, splitTicketVat } from './gigDealVat.js'

export const GIG_DEAL_LINE_KINDS = Object.freeze({
  /** The guaranteed fee — the performance itself. */
  PERFORMANCE_FEE: 'performance_fee',
  /** Everything the door took, at the net ticket price. */
  TICKET_REVENUE: 'ticket_revenue',
  /** The venue's VAT contained in that, which nobody shares in. */
  TICKET_VAT: 'ticket_vat',
  /** Break-even: the guarantee the venue recoups before the artist shares. */
  BREAK_EVEN_FEE: 'break_even_fee',
  /** Break-even: the venue's own costs. */
  BREAK_EVEN_VENUE_COSTS: 'break_even_venue_costs',
  /** Guarantee vs.: the guarantee the share has to beat, billed on its own line. */
  GUARANTEE_OFFSET: 'guarantee_offset',
  /** The venue's cut of the shared revenue. */
  VENUE_SHARE: 'venue_share',
})

const {
  PERFORMANCE_FEE,
  TICKET_REVENUE,
  TICKET_VAT,
  BREAK_EVEN_FEE,
  BREAK_EVEN_VENUE_COSTS,
  GUARANTEE_OFFSET,
  VENUE_SHARE,
} = GIG_DEAL_LINE_KINDS

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function cents(value) {
  return Math.round(toNumber(value))
}

function percentOf(amountCents, percentage) {
  return Math.round((amountCents * toNumber(percentage)) / 100)
}

// ---------------------------------------------------------------------------
// Ticket settlements
// ---------------------------------------------------------------------------
// A settlement answers two questions about one deal: what the artist earned on
// the tickets sold, and which amounts have to come off ticket revenue — in the
// order they belong on the invoice — for the lines to add up to it. The venue's
// cut is always the remainder of its own base rather than a separately rounded
// percentage, so the lines tie out to the cent.

/**
 * The artist takes a percentage of what the door made above break-even.
 * recoupments() names what the venue recoups first, itemised because the venue
 * is entitled to see what its break-even consists of.
 */
function shareAboveBreakEven(recoupments) {
  return (context) => {
    const breakEven = recoupments(context).map((part) => ({ ...part, cents: cents(part.cents) }))
    const breakEvenCents = breakEven.reduce((total, part) => total + part.cents, 0)
    const baseCents = Math.max(0, context.ticketRevenueCents - breakEvenCents)
    const artistTicketShareCents = percentOf(baseCents, context.artistPercentage)
    return {
      artistTicketShareCents,
      deductions: [
        ...breakEven,
        { kind: VENUE_SHARE, cents: baseCents - artistTicketShareCents, percentage: context.venuePercentage },
      ],
    }
  }
}

/**
 * Guarantee vs.: the artist's percentage runs from the first ticket and nothing
 * is recouped — the share is paid only for what it beats the guarantee by, so
 * the guarantee billed on the fee line above comes off as an offset.
 */
function shareVersusGuarantee({ ticketRevenueCents, guaranteedFeeCents, artistPercentage, venuePercentage }) {
  const artistOnRevenueCents = percentOf(ticketRevenueCents, artistPercentage)
  return {
    artistTicketShareCents: Math.max(0, artistOnRevenueCents - guaranteedFeeCents),
    deductions: [
      { kind: VENUE_SHARE, cents: ticketRevenueCents - artistOnRevenueCents, percentage: venuePercentage },
      { kind: GUARANTEE_OFFSET, cents: guaranteedFeeCents },
    ],
  }
}

const venueCostsPart = ({ terms }) => ({ kind: BREAK_EVEN_VENUE_COSTS, cents: terms.venue_costs_cents })
const guaranteePart = ({ guaranteedFeeCents }) => ({ kind: BREAK_EVEN_FEE, cents: guaranteedFeeCents })

/**
 * One entry per deal type: whether it guarantees a fee at all, and how its
 * ticket revenue settles (null — a flat fee takes no part in the door).
 */
const DEAL_SETTLEMENTS = Object.freeze({
  flat_fee: { guaranteesFee: true, settleTickets: null },
  guarantee: {
    guaranteesFee: true,
    settleTickets: shareAboveBreakEven((ctx) => [guaranteePart(ctx), venueCostsPart(ctx)]),
  },
  guarantee_plus: {
    guaranteesFee: true,
    // The one deal that lets the artist choose whether venue costs count.
    settleTickets: shareAboveBreakEven((ctx) => (
      ctx.terms.breakeven_includes_venue_costs ? [guaranteePart(ctx), venueCostsPart(ctx)] : [guaranteePart(ctx)]
    )),
  },
  guarantee_vs: { guaranteesFee: true, settleTickets: shareVersusGuarantee },
  door_deal: {
    guaranteesFee: false,
    settleTickets: shareAboveBreakEven((ctx) => [venueCostsPart(ctx)]),
  },
})

// A deal type this module has not been taught yet still has to produce an
// invoice: it falls back to billing the guaranteed fee, which is what every gig
// invoice did before deal types existed — never a 500 on the draft endpoint.
const UNKNOWN_DEAL = { guaranteesFee: true, settleTickets: null }

function settlementFor(dealType) {
  return DEAL_SETTLEMENTS[dealType] ?? UNKNOWN_DEAL
}

/**
 * The settlement between artist and venue: the guarantee, what the door took,
 * what comes off it, and what the artist earned on the tickets sold so far.
 * `deductions` are ordered as they belong on the invoice.
 */
export function computeGigDealSettlement(terms) {
  const deal = settlementFor(terms.deal_type)
  // Deal types are switched freely and the fields behind them are kept rather
  // than cleared, so a fee stored on a door deal is stale input, not money.
  const guaranteedFeeCents = deal.guaranteesFee ? cents(terms.guaranteed_fee_cents) : 0
  const ticketsSold = Math.max(0, cents(terms.tickets_sold))
  const ticketPriceNetCents = cents(terms.ticket_price_net_cents)
  const artistPercentage = toNumber(terms.percentage_of_sales)

  // What the door took, and the venue's VAT inside it. The VAT is nobody's to
  // share, so the settlement runs on the revenue net of it while the invoice
  // still bills the door at the gross the venue's own till reports.
  const ticketVatPercentage = gigTicketVatPercentage(terms)
  const grossTicketRevenueCents = deal.settleTickets ? ticketsSold * ticketPriceNetCents : 0
  const { netCents, vatCents } = splitTicketVat(grossTicketRevenueCents, ticketVatPercentage)

  const context = {
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
  const tickets = deal.settleTickets
    ? deal.settleTickets(context)
    : { artistTicketShareCents: 0, deductions: [] }

  return {
    ...context,
    ...tickets,
    // The VAT comes off before anything is recouped or shared, so it leads the
    // deductions the settlement's own maths produced.
    deductions: vatCents > 0
      ? [{ kind: TICKET_VAT, cents: vatCents, percentage: ticketVatPercentage }, ...tickets.deductions]
      : tickets.deductions,
    billsGuaranteedFee: deal.guaranteesFee,
    totalCents: guaranteedFeeCents + tickets.artistTicketShareCents,
  }
}

/**
 * A gig's deal as invoice lines that sum exactly to what the venue owes: the
 * guaranteed fee plus the artist's share of the tickets sold so far.
 *
 * Returns [] when the deal produces nothing to bill — a door deal with no
 * tickets entered yet, or one that never reached the venue's break-even —
 * leaving the caller to fall back to its own line rather than invoicing a
 * calculation that settles at zero.
 *
 * A deduction is one line at a NEGATIVE AMOUNT, never a negative quantity: it
 * adjusts money, not stock — nothing is being returned. (The UBL/Peppol export
 * moves that sign onto the quantity when it serializes, because BR-27 forbids a
 * negative item net price on the wire; the line net is the same either way.)
 */
export function buildGigDealInvoiceLines(terms) {
  const settlement = computeGigDealSettlement(terms)
  const billsTickets = settlement.artistTicketShareCents > 0
  const lines = []

  // The fee line carries the performance itself, so it stays even at zero when
  // nothing else would be billed — an invoice needs a line to start from.
  if (settlement.billsGuaranteedFee && (settlement.guaranteedFeeCents !== 0 || !billsTickets)) {
    lines.push({
      kind: PERFORMANCE_FEE,
      quantity: 1,
      unitPriceCents: settlement.guaranteedFeeCents,
      amountCents: settlement.guaranteedFeeCents,
    })
  }

  if (!billsTickets) return lines

  lines.push({
    kind: TICKET_REVENUE,
    quantity: settlement.ticketsSold,
    unitPriceCents: settlement.ticketPriceNetCents,
    amountCents: settlement.grossTicketRevenueCents,
  })
  for (const deduction of settlement.deductions) {
    if (deduction.cents <= 0) continue
    lines.push({
      kind: deduction.kind,
      quantity: 1,
      unitPriceCents: -deduction.cents,
      amountCents: -deduction.cents,
      ...(deduction.percentage === undefined ? {} : { percentage: deduction.percentage }),
    })
  }
  return lines
}
