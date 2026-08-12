export { computeLineTotals, computeInvoiceTotals, computeVatBreakdown } from '../../../shared/invoiceTotals.js'

const formatters = new Map<string, Intl.NumberFormat>()

function currencyFormatter(currency: string): Intl.NumberFormat {
  const code = currency.toUpperCase()
  let formatter = formatters.get(code)
  if (!formatter) {
    formatter = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: code })
    formatters.set(code, formatter)
  }
  return formatter
}

export function formatCurrency(
  cents: number | string | null | undefined,
  currency: string,
): string {
  return currencyFormatter(currency).format((Number(cents) || 0) / 100)
}

export function formatCurrencyParts(
  cents: number | string | null | undefined,
  currency: string,
): { symbol: string; value: string } {
  const parts = currencyFormatter(currency).formatToParts((Number(cents) || 0) / 100)
  const symbol = parts.filter((p) => p.type === 'currency').map((p) => p.value).join('')
  const value = parts.filter((p) => p.type !== 'currency' && p.type !== 'literal').map((p) => p.value).join('')
  return { symbol, value }
}

// Platform plans, subscriptions and mandate payments are explicitly EUR-only.
export function formatEur(cents: number | string | null | undefined): string {
  return formatCurrency(cents, 'EUR')
}

// Splits a formatted EUR amount into its currency symbol and the numeric part
// (minus sign included, the separating space dropped) so callers can align the
// symbol and digits in separate table columns.
export function formatEurParts(cents: number | string | null | undefined): { symbol: string; value: string } {
  return formatCurrencyParts(cents, 'EUR')
}
