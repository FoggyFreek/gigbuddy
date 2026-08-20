// The lines an invoice draft starts with when it is pre-filled from a gig.
//
// What the venue owes follows from the gig's deal terms, and for every deal
// type but a flat fee that amount is a calculation — ticket revenue, what the
// venue recoups or offsets against it, and the venue's cut of the rest. The
// decomposition itself lives in shared/gigDealInvoiceLines.js so the figures
// cannot drift from the artist statement on the gig's Terms tab; this module
// only puts the document's language and the invoice's line shape on them.
import { buildGigDealInvoiceLines, GIG_DEAL_LINE_KINDS } from '../../../shared/gigDealInvoiceLines.js'
import { getInvoiceT, invoiceIntlLocale } from '../../utils/invoiceI18n.js'

function formatPercentage(value, lng) {
  return new Intl.NumberFormat(invoiceIntlLocale(lng), { maximumFractionDigits: 2 }).format(Number(value) || 0)
}

// One describer per line kind. A new kind is a new entry here and its strings in
// server/i18n/<lng>/invoice.json; nothing else in this module knows the kinds.
const DESCRIBE_LINE = Object.freeze({
  // The performance itself is described by the gig, not by a fixed label.
  [GIG_DEAL_LINE_KINDS.PERFORMANCE_FEE]: ({ description }) => description,
  // The gig's own description is the only context the venue gets, so the ticket
  // line carries it when there is no fee line above to carry it instead.
  [GIG_DEAL_LINE_KINDS.TICKET_REVENUE]: ({ t, description, isFirstLine }) => (
    description && isFirstLine ? t('dealLineTicketRevenueFor', { event: description }) : t('dealLineTicketRevenue')
  ),
  [GIG_DEAL_LINE_KINDS.TICKET_VAT]: ({ t, lng, line }) => t('dealLineTicketVat', {
    percentage: formatPercentage(line.percentage, lng),
  }),
  [GIG_DEAL_LINE_KINDS.BREAK_EVEN_FEE]: ({ t }) => t('dealLineBreakEvenFee'),
  [GIG_DEAL_LINE_KINDS.BREAK_EVEN_VENUE_COSTS]: ({ t }) => t('dealLineBreakEvenVenueCosts'),
  [GIG_DEAL_LINE_KINDS.GUARANTEE_OFFSET]: ({ t }) => t('dealLineGuaranteeOffset'),
  [GIG_DEAL_LINE_KINDS.VENUE_SHARE]: ({ t, lng, line }) => t('dealLineVenueShare', {
    percentage: formatPercentage(line.percentage, lng),
  }),
})

/**
 * Draft lines for a gig. `description` is the composed performance description,
 * `lng` the invoice document language (the supplier's, resolved by the caller).
 * Always returns at least one line: a deal that settles at zero falls back to
 * the performance line, which the user then fills in by hand.
 */
export function buildGigDraftLines(gig, { description, taxPercentage, lng }) {
  const t = getInvoiceT(lng)
  const dealLines = buildGigDealInvoiceLines(gig)

  if (!dealLines.length) {
    return [{ description, quantity: 1, unit_price_cents: 0, tax_percentage: taxPercentage, position: 0 }]
  }

  return dealLines.map((line, position) => ({
    description: DESCRIBE_LINE[line.kind]({ t, lng, line, description, isFirstLine: position === 0 }),
    quantity: line.quantity,
    unit_price_cents: line.unitPriceCents,
    tax_percentage: taxPercentage,
    position,
  }))
}
