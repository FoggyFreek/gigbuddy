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

export function computeInvoiceTotals({ lines, taxInclusive, discountCents, appliesKor }) {
  const effectiveLines = appliesKor
    ? lines.map((line) => ({ ...line, tax_percentage: 0 }))
    : lines
  const effectiveInclusive = appliesKor ? false : Boolean(taxInclusive)

  let subtotalCents = 0
  let taxCents = 0
  const perLine = []

  for (const line of effectiveLines) {
    const totals = computeLineTotals(line, effectiveInclusive)
    perLine.push(totals)
    subtotalCents += totals.netCents
    taxCents += totals.taxCents
  }

  const discount = Math.max(0, Math.min(Number(discountCents) || 0, subtotalCents))
  const totalCents = subtotalCents - discount + taxCents

  return {
    subtotalCents,
    taxCents,
    discountCents: discount,
    totalCents,
    perLine,
  }
}
