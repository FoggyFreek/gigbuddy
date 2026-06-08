// Authoritative purchase totals math shared by the server and frontend.
//
// All money values are integer cents. Unlike invoices, a purchase line is
// entered as a gross Incl. VAT amount plus a tax rate; the net (Excl. VAT) and
// VAT amount are derived. HALF_UP rounding via Math.round.

export function computePurchaseLineTotals(line) {
  const grossCents = Math.round(Number(line.amount_incl_cents) || 0)
  const taxRate = Number(line.tax_rate) || 0
  const netCents = Math.round((grossCents * 100) / (100 + taxRate))
  const vatCents = grossCents - netCents
  return { netCents, vatCents, grossCents }
}

export function computePurchaseTotals({ lines }) {
  let subtotalCents = 0
  let taxCents = 0
  let totalCents = 0
  const perLine = []
  const vatMap = new Map() // rate → vat cents

  for (const line of lines || []) {
    const t = computePurchaseLineTotals(line)
    perLine.push(t)
    subtotalCents += t.netCents
    taxCents += t.vatCents
    totalCents += t.grossCents
    const rate = Number(line.tax_rate) || 0
    vatMap.set(rate, (vatMap.get(rate) || 0) + t.vatCents)
  }

  const vatByRate = [...vatMap.entries()]
    .map(([rate, cents]) => ({ rate, cents }))
    .filter((v) => v.cents !== 0)
    .sort((a, b) => a.rate - b.rate)

  return { perLine, subtotalCents, taxCents, totalCents, vatByRate }
}
