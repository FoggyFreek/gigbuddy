// Authoritative invoice totals math shared by the server and frontend.
//
// All money values are integer cents. quantity is decimal (NUMERIC 10,2 in DB),
// tax_percentage is decimal (NUMERIC 5,2). HALF_UP rounding at each
// intermediate result via Math.round (positive values only).
import { VAT_CATEGORY } from './peppol.js'

export function computeLineTotals(line, taxInclusive) {
  const quantity = Number(line.quantity) || 0
  const unitPriceCents = Number(line.unit_price_cents) || 0
  const taxPercentage = Number(line.tax_percentage) || 0

  const productCents = Math.round(quantity * unitPriceCents)

  if (taxInclusive) {
    const grossCents = productCents
    const netCents = Math.round((grossCents * 100) / (100 + taxPercentage))
    const taxCents = grossCents - netCents
    return { netCents, taxCents, grossCents }
  }

  const netCents = productCents
  const taxCents = Math.round((netCents * taxPercentage) / 100)
  const grossCents = netCents + taxCents
  return { netCents, taxCents, grossCents }
}

export function computeInvoiceTotals({ lines, taxInclusive, discountCents, discountType, discountPct, appliesKor, reverseCharge }) {
  // Both the KOR exemption and the reverse-charge mechanism zero the VAT: under
  // reverse charge the customer accounts for the VAT, so the supplier charges 0.
  const zeroVat = appliesKor || reverseCharge
  const effectiveLines = zeroVat
    ? lines.map((line) => ({ ...line, tax_percentage: 0 }))
    : lines
  const effectiveInclusive = zeroVat ? false : Boolean(taxInclusive)

  // Compute per-line net amounts (taxable base) and accumulate by VAT rate.
  let subtotalCents = 0
  const perLine = []
  const netByRate = new Map()   // rate → total net cents for that rate group
  const taxByRate = new Map()   // rate → pre-computed tax (used in zero-discount path)

  for (let i = 0; i < effectiveLines.length; i++) {
    const t = computeLineTotals(effectiveLines[i], effectiveInclusive)
    perLine.push(t)
    subtotalCents += t.netCents
    const rate = Number(effectiveLines[i].tax_percentage) || 0
    netByRate.set(rate, (netByRate.get(rate) || 0) + t.netCents)
    taxByRate.set(rate, (taxByRate.get(rate) || 0) + t.taxCents)
  }

  // Resolve absolute discount amount.
  let discount
  if (discountType === 'pct') {
    discount = Math.max(0, Math.min(Math.round((subtotalCents * (Number(discountPct) || 0)) / 100), subtotalCents))
  } else {
    discount = Math.max(0, Math.min(Number(discountCents) || 0, subtotalCents))
  }

  // VAT is computed per rate group on that group's proportional share of the
  // discounted subtotal. When there is no discount, use the pre-computed per-line
  // taxes so that inclusive-VAT arithmetic (gross = net + tax) is preserved exactly.
  const vatByRate = []
  let taxCents = 0

  if (discount === 0) {
    for (const [rate, tax] of taxByRate) {
      vatByRate.push({ rate, cents: tax })
      taxCents += tax
    }
  } else {
    const discountedSubtotal = subtotalCents - discount
    for (const [rate, groupNet] of netByRate) {
      const discountedGroupNet = subtotalCents > 0
        ? Math.round((groupNet * discountedSubtotal) / subtotalCents)
        : 0
      const vatCents = Math.round((discountedGroupNet * rate) / 100)
      vatByRate.push({ rate, cents: vatCents })
      taxCents += vatCents
    }
  }

  vatByRate.sort((a, b) => a.rate - b.rate)

  const totalCents = subtotalCents - discount + taxCents

  return {
    subtotalCents,
    vatByRate: vatByRate.filter((v) => v.cents !== 0),
    taxCents,
    discountCents: discount,
    totalCents,
    perLine,
  }
}

// EN 16931 VAT category code for a rate. Reverse charge outranks the KOR, the
// same precedence the PDF's VAT notes use.
function vatCategoryCode(percent, { appliesKor, reverseCharge }) {
  if (reverseCharge) return VAT_CATEGORY.REVERSE_CHARGE
  if (appliesKor) return VAT_CATEGORY.EXEMPT
  return percent > 0 ? VAT_CATEGORY.STANDARD : VAT_CATEGORY.ZERO
}

// Per-VAT-category view of an invoice, for the UBL/Peppol export.
// computeInvoiceTotals cannot serve this directly: it drops zero-cent rate
// groups from vatByRate (UBL needs a TaxSubtotal for every category), and its
// per-rate discount allocation is internal.
//
// This DERIVES from computeInvoiceTotals rather than recomputing: those totals
// are persisted on the invoice and posted to the ledger, so they are the
// authority. Every returned figure sums back to them exactly, which is what
// keeps the XML, the PDF and the journal in agreement.
export function computeVatBreakdown(args) {
  const totals = computeInvoiceTotals(args)
  const zeroVat = args.appliesKor || args.reverseCharge

  const netByRate = new Map()
  args.lines.forEach((line, i) => {
    const rate = zeroVat ? 0 : Number(line.tax_percentage) || 0
    netByRate.set(rate, (netByRate.get(rate) || 0) + totals.perLine[i].netCents)
  })

  const groups = [...netByRate.entries()]
    .map(([percent, lineNetCents]) => ({ percent, lineNetCents }))
    .sort((a, b) => a.percent - b.percent)

  const subtotal = totals.subtotalCents
  const discounted = subtotal - totals.discountCents

  // Same per-group proportional split computeInvoiceTotals uses internally, so
  // the taxable bases match the VAT it already computed.
  const exact = groups.map((g) => (subtotal === 0 ? 0 : (g.lineNetCents * discounted) / subtotal))
  const taxable = exact.map((x) => Math.round(x))

  // Independent rounding per group need not sum to the discounted subtotal.
  // Repair by largest remainder so the UBL totals reconcile to the cent
  // (BR-CO-11 and BR-CO-13 leave no tolerance).
  const residual = discounted - taxable.reduce((a, b) => a + b, 0)
  if (residual !== 0 && groups.length > 0) {
    const step = Math.sign(residual)
    const order = groups
      .map((_, i) => i)
      .sort((i, j) => {
        const remainderDiff = (exact[i] - taxable[i]) - (exact[j] - taxable[j])
        if (remainderDiff !== 0) return step > 0 ? -remainderDiff : remainderDiff
        if (groups[i].lineNetCents !== groups[j].lineNetCents) return groups[j].lineNetCents - groups[i].lineNetCents
        return groups[i].percent - groups[j].percent
      })
    for (let k = 0; k < Math.abs(residual); k++) taxable[order[k % order.length]] += step
  }

  const categories = groups.map((g, i) => ({
    code: vatCategoryCode(g.percent, args),
    percent: g.percent,
    lineNetCents: g.lineNetCents,
    allowanceCents: g.lineNetCents - taxable[i],
    taxableCents: taxable[i],
    // Looked up, never re-derived and never redistributed: a zero-rated group
    // has no entry in vatByRate and so gets 0, which is what BR-Z-09 demands.
    taxCents: totals.vatByRate.find((v) => v.rate === g.percent)?.cents ?? 0,
  }))

  return { totals, categories }
}
