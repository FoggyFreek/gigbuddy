// VAT on a gig deal, shared by the server (which bills it) and the frontend
// (which simulates it).
//
// Two rates, two jobs:
//
//   General VAT  — the rate an invoice generated from this gig is billed at.
//                  Blank means the gig does not override what the invoice would
//                  default to: the country's reduced rate for a live performance.
//   Ticket VAT   — the VAT the VENUE charges the public, contained in the nett
//                  ticket price. It is not the artist's tax, so every figure
//                  derived from ticket revenue runs on the revenue with that VAT
//                  taken out, and the invoice bills the door at its gross with
//                  the VAT as one correction line.
//
// `subject_to_vat` is the discriminator for both: a deal that is not subject to
// VAT is billed at 0% and has nothing to strip out of the door.
//
// The ticket split is taken ONCE, on the revenue total, never per ticket: VAT is
// owed on what the door actually took, and rounding each ticket separately would
// leave the invoice's correction line disagreeing with the money it corrects.
import { getReducedVatRate } from './vatRates.js'

function percentage(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** True unless the deal explicitly says this gig carries no VAT. */
function isSubjectToVat(terms) {
  return terms?.subject_to_vat !== false
}

/**
 * The VAT contained in the nett ticket price, as a percentage. 0 when the deal
 * is not subject to VAT or no ticket rate was agreed — nothing to take out.
 */
export function gigTicketVatPercentage(terms) {
  if (!isSubjectToVat(terms)) return 0
  return percentage(terms?.ticket_vat_percentage)
}

/**
 * The rate an invoice generated from this gig is billed at: the gig's own rate
 * when it overrides one, otherwise the country's reduced rate — a live
 * performance sits under the reduced tariff. A deal not subject to VAT is 0%.
 *
 * The tenant's VAT treatment still outranks this: an exempt scheme bills 0%
 * whatever the deal says, which the invoice service resolves before asking here.
 */
export function gigInvoiceVatPercentage(terms, country) {
  if (!isSubjectToVat(terms)) return 0
  const rate = Number(terms?.vat_percentage)
  if (terms?.vat_percentage != null && Number.isFinite(rate) && rate >= 0) return rate
  return getReducedVatRate(country)
}

/**
 * Ticket revenue split into the amount the artist's share is calculated on and
 * the ticket VAT contained in it. Integer cents; the two always sum back to the
 * revenue that went in, so no rounding can escape the split.
 */
export function splitTicketVat(revenueCents, vatPercentage) {
  const rate = percentage(vatPercentage)
  if (rate === 0) return { netCents: revenueCents, vatCents: 0 }
  const netCents = Math.round(revenueCents / (1 + rate / 100))
  return { netCents, vatCents: revenueCents - netCents }
}

/**
 * One ticket's price with its VAT taken out — the per-ticket view of the split
 * above, for display only. Revenue is always split on the total, never by
 * multiplying this back up.
 */
export function ticketPriceExVatCents(priceCents, vatPercentage) {
  return splitTicketVat(Math.round(Number(priceCents) || 0), vatPercentage).netCents
}
