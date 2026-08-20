// The invoice-line decomposition of a gig's deal. The shared engine owns every
// settlement rule; this module only shapes that result into document lines.
// Deductions use a negative amount, never a negative quantity. UBL serialization
// moves that sign onto quantity because BR-27 forbids negative item net prices.
import {
  computeGigDealSettlement,
  GIG_DEAL_DEDUCTION_KINDS,
} from './gigDealEngine.js'

export const GIG_DEAL_LINE_KINDS = Object.freeze({
  PERFORMANCE_FEE: 'performance_fee',
  TICKET_REVENUE: 'ticket_revenue',
  ...GIG_DEAL_DEDUCTION_KINDS,
})

const { PERFORMANCE_FEE, TICKET_REVENUE } = GIG_DEAL_LINE_KINDS

export { computeGigDealSettlement }

export function buildGigDealInvoiceLines(terms) {
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
