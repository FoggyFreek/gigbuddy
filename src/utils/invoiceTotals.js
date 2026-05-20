export { computeLineTotals, computeInvoiceTotals } from '../../shared/invoiceTotals.js'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

export function formatEur(cents) {
  return eur.format((Number(cents) || 0) / 100)
}
