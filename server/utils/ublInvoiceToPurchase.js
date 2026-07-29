// Turns a parsed UBL invoice (parseUblInvoice.js) into the body POST /purchases
// already accepts. Pure: no DB, no IO.
//
// One owner for "how a supplier's e-invoice becomes a bill", so the rules live
// somewhere testable instead of inside the import service's IO.
//
// THE SHAPE MISMATCH THIS EXISTS TO BRIDGE. A UBL line states a NET amount and a
// VAT rate; document-level discounts sit beside the lines as their own elements.
// A purchase line stores a GROSS amount and derives net and VAT back out of it
// (shared/purchaseTotals.js), and has nowhere to put a document-level discount.
// So allowances and charges are allocated onto the lines they apply to, and the
// result is reconciled against the total the supplier actually stated.
//
// Nothing here silently invents money. A gap too large to be rounding is
// reported as a warning and left in the lines for the user to resolve in the
// draft, never forced onto an arbitrary line to make the total look right.
import { snapVatRate } from '../../shared/vatRates.js'
import { computePurchaseTotals } from '../../shared/purchaseTotals.js'
import { importWarning, sortImportWarnings } from '../../shared/purchaseImportWarnings.js'

// Distributes `total` (signed) over `weights` proportionally, repairing the
// rounding residual by largest remainder so the parts sum to exactly `total`.
// The same technique computeVatBreakdown uses on the way out; here it splits a
// document-level allowance across lines rather than a discount across rates.
function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  // No weight to go on (all-zero lines): spread evenly instead of dividing by 0.
  const exact = weights.map((w) => (sum === 0 ? total / weights.length : (total * w) / sum))
  const parts = exact.map((x) => Math.round(x))
  const residual = total - parts.reduce((a, b) => a + b, 0)
  if (residual !== 0 && parts.length > 0) {
    const step = Math.sign(residual)
    const order = parts
      .map((_, i) => i)
      .sort((i, j) => {
        const remainder = (exact[i] - parts[i]) - (exact[j] - parts[j])
        if (remainder !== 0) return step > 0 ? -remainder : remainder
        return weights[j] - weights[i]
      })
    for (let k = 0; k < Math.abs(residual); k++) parts[order[k % order.length]] += step
  }
  return parts
}

// Which lines a document-level allowance or charge applies to. BR-32 makes the
// VAT category mandatory on one, so it normally names the rate it belongs to;
// when nothing matches (or it names nothing) it falls back to every line, which
// is the only allocation that keeps the document total reachable.
function targetsFor(category, lines) {
  const percent = category?.percent
  if (percent === null || percent === undefined) return lines.map((_, i) => i)
  const matching = lines.map((_, i) => i).filter((i) => lines[i].category?.percent === percent)
  return matching.length ? matching : lines.map((_, i) => i)
}

// Net adjustment per line from every document-level allowance (negative) and
// charge (positive).
function allocateAllowanceCharges(doc) {
  const adjustments = doc.lines.map(() => 0)
  for (const item of doc.allowanceCharges) {
    const targets = targetsFor(item.category, doc.lines)
    const signed = item.kind === 'allowance' ? -item.cents : item.cents
    // Weight by line size so a discount lands mostly on the big line, and never
    // by a negative weight (a credit line would otherwise pull the split apart).
    const parts = allocate(signed, targets.map((i) => Math.abs(doc.lines[i].netCents)))
    targets.forEach((lineIndex, k) => { adjustments[lineIndex] += parts[k] })
  }
  return adjustments
}

// The VAT rate to book a line at, and whether that involved a decision.
//
// snapVatRate maps null to 0 (Number(null) === 0), which would book a fully
// taxed line as zero-rated, so an absent rate is resolved BEFORE it gets there:
// from the document's VAT breakdown when that states exactly one category,
// otherwise the tenant's standard rate.
function resolveLineRate(line, doc, vatCountry, report) {
  const stated = line.category?.percent
  if (stated === null || stated === undefined) {
    const categories = doc.vatBreakdown.filter((v) => v.category?.percent != null)
    // undefined, not null: snapVatRate reads Number(null) as a valid 0% rate.
    const derived = categories.length === 1 ? categories[0].category.percent : undefined
    const rate = snapVatRate(vatCountry, derived)
    report('line_vat_rate_defaulted', { to: rate })
    return rate
  }
  const snapped = snapVatRate(vatCountry, stated)
  if (snapped !== stated) report('vat_rate_adjusted', { from: stated, to: snapped })
  return snapped
}

// The document value the imported lines must add up to: what the supplier is
// charging in total, VAT included. PayableAmount is NOT it — that is net of any
// prepayment (BT-113), which a purchase has no way to represent, so the prepaid
// case is reported and the full amount booked.
function targetTotalCents(doc) {
  const { taxInclusiveCents, payableCents, lineExtensionCents, allowanceTotalCents, chargeTotalCents, taxCents } = doc.totals
  if (taxInclusiveCents !== null) return taxInclusiveCents
  if (payableCents !== null) return payableCents
  if (lineExtensionCents === null || taxCents === null) return null
  return lineExtensionCents - allowanceTotalCents + chargeTotalCents + taxCents
}

/**
 * @param {object} doc parsed UBL invoice (parseUblInvoice.js)
 * @param {{ vatCountry: string, today?: string }} ctx
 * @returns {{ purchase: object, warnings: {code: string, severity: string}[] }}
 *   `purchase` is a POST /purchases body — always a draft, so nothing reaches
 *   the ledger until a human approves it.
 */
export function mapUblInvoiceToPurchase(doc, { vatCountry, today = new Date().toISOString().slice(0, 10) }) {
  const found = new Map()
  const report = (code, context) => { if (!found.has(code)) found.set(code, context ?? null) }

  const adjustments = allocateAllowanceCharges(doc)
  if (doc.allowanceCharges.some((a) => a.kind === 'allowance')) report('document_discount_allocated')
  if (doc.allowanceCharges.some((a) => a.kind === 'charge')) report('document_charge_allocated')
  if (doc.totals.prepaidCents) report('prepaid_amount_ignored', { cents: doc.totals.prepaidCents })

  const lines = doc.lines.map((line, i) => {
    if (!line.description) report('line_missing_description')
    const taxRate = resolveLineRate(line, doc, vatCountry, report)
    const netCents = line.netCents + adjustments[i]
    return {
      description: line.description ?? '',
      account_code: null,
      tax_rate: taxRate,
      amount_incl_cents: Math.round((netCents * (100 + taxRate)) / 100),
      position: i,
      product_id: null,
      quantity: null,
    }
  })

  reconcile(lines, targetTotalCents(doc), report)

  return {
    purchase: {
      supplier_name: doc.supplier?.name ?? '',
      supplier_contact_id: null,
      receipt_date: doc.issueDate ?? today,
      due_date: doc.dueDate,
      currency: doc.currency ?? 'EUR',
      // The supplier's own invoice number, which is what you quote when paying
      // and the only place a purchase can hold it. Their note follows it.
      memo: [doc.invoiceNumber, doc.note].filter(Boolean).join('\n') || null,
      status: 'draft',
      lines,
    },
    warnings: sortImportWarnings(
      [...found].map(([code, context]) => importWarning(code, context)),
    ),
  }
}

// Backing VAT out of a gross line is not the exact inverse of adding it on, so
// the per-line grosses can miss the document total by a cent or two. Absorb only
// that: a residual no larger than one cent per line is rounding, and anything
// beyond it is a disagreement the user has to see.
function reconcile(lines, target, report) {
  if (target === null) return
  const residual = target - computePurchaseTotals({ lines }).totalCents
  if (residual === 0) return

  if (Math.abs(residual) > lines.length) {
    report('totals_mismatch', { cents: residual, statedCents: target })
    return
  }

  const parts = allocate(residual, lines.map((l) => Math.abs(l.amount_incl_cents)))
  lines.forEach((line, i) => { line.amount_incl_cents += parts[i] })
  report('totals_rounded', { cents: residual })
}
