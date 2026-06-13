export { computeLineTotals, computeInvoiceTotals } from '../../shared/invoiceTotals.js'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

export function formatEur(cents) {
  return eur.format((Number(cents) || 0) / 100)
}

// Splits a formatted EUR amount into its currency symbol and the numeric part
// (minus sign included, the separating space dropped) so callers can align the
// symbol and digits in separate table columns.
export function formatEurParts(cents) {
  const parts = eur.formatToParts((Number(cents) || 0) / 100)
  const symbol = parts.filter((p) => p.type === 'currency').map((p) => p.value).join('')
  const value = parts.filter((p) => p.type !== 'currency' && p.type !== 'literal').map((p) => p.value).join('')
  return { symbol, value }
}
