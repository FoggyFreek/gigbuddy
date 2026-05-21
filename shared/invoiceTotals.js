// Authoritative invoice totals math shared by the server and frontend.
//
// All money values are integer cents. quantity is decimal (NUMERIC 10,2 in DB),
// tax_percentage is decimal (NUMERIC 5,2). HALF_UP rounding at each
// intermediate result via Math.round (positive values only).

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

export function computeInvoiceTotals({ lines, taxInclusive, discountCents, discountType, discountPct, appliesKor }) {
  const effectiveLines = appliesKor
    ? lines.map((line) => ({ ...line, tax_percentage: 0 }))
    : lines
  const effectiveInclusive = appliesKor ? false : Boolean(taxInclusive)

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
