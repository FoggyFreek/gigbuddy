// The invoice-line decomposition of a gig's deal. The shared engine owns every
// settlement rule; this module only shapes that result into document lines.
// Deductions use a negative amount, never a negative quantity. UBL serialization
// moves that sign onto quantity because BR-27 forbids negative item net prices.
import {
  computeArtistStatement,
  computeGigDealSettlement,
  GIG_DEAL_DEDUCTION_KINDS,
} from './gigDealEngine.js'
import { resolveEffectiveMode } from './invoiceModes.js'

export const GIG_DEAL_LINE_KINDS = Object.freeze({
  PERFORMANCE_FEE: 'performance_fee',
  ARTIST_FEE: 'artist_fee',
  BOOKING_FEE: 'booking_fee',
  TICKET_REVENUE: 'ticket_revenue',
  ...GIG_DEAL_DEDUCTION_KINDS,
})

const { PERFORMANCE_FEE, ARTIST_FEE, BOOKING_FEE, TICKET_REVENUE } = GIG_DEAL_LINE_KINDS

export { computeGigDealSettlement }

function line(kind, amountCents) {
  return { kind, quantity: 1, unitPriceCents: amountCents, amountCents }
}

function specifiedLines(terms, combinedLines) {
  // A booking fee is already inside the deal total. Specified mode SPLITS that
  // total; it never appends the fee on top (which would double-bill the venue).
  const bookingFeeCents = computeArtistStatement(terms).agencyFeeCents
  if (bookingFeeCents <= 0) return combinedLines

  const performanceIndex = combinedLines.findIndex(({ kind }) => kind === PERFORMANCE_FEE)
  if (performanceIndex >= 0) {
    const performance = combinedLines[performanceIndex]
    return [
      ...combinedLines.slice(0, performanceIndex),
      line(ARTIST_FEE, performance.amountCents - bookingFeeCents),
      line(BOOKING_FEE, bookingFeeCents),
      ...combinedLines.slice(performanceIndex + 1),
    ]
  }

  // A pure door deal has no fee line to split. Its itemised calculation is the
  // settled artist fee, so specified mode presents that settlement as the two
  // payable parts while preserving the exact document total.
  const totalCents = combinedLines.reduce((total, current) => total + current.amountCents, 0)
  return [
    line(ARTIST_FEE, totalCents - bookingFeeCents),
    line(BOOKING_FEE, bookingFeeCents),
  ]
}

export function buildGigDealInvoiceLines(terms, { mode = 'combined' } = {}) {
  const settlement = computeGigDealSettlement(terms)
  const billsTickets = settlement.artistTicketShareCents > 0
  const lines = []

  if (settlement.billsGuaranteedFee && (settlement.guaranteedFeeCents !== 0 || !billsTickets)) {
    lines.push({
      kind: PERFORMANCE_FEE,
      quantity: 1,
      unitPriceCents: settlement.guaranteedFeeCents,
      amountCents: settlement.guaranteedFeeCents,
    })
  }

  if (!billsTickets) {
    return resolveEffectiveMode(terms, mode) === 'specified' ? specifiedLines(terms, lines) : lines
  }

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
  return resolveEffectiveMode(terms, mode) === 'specified' ? specifiedLines(terms, lines) : lines
}
