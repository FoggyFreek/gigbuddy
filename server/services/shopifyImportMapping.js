// Pure helpers for Shopify order import: eligibility rules and the monetary
// derivation. No DB, no HTTP — shared by shopifyService (listing flags) and
// merchShopifyService (authoritative recompute on import). Amounts are always
// derived here from the order's *effective/current* fields, never trusted from
// the client.

const EUR = 'EUR'

// Orders whose payment is recognized revenue. Excludes pending/authorized/
// partially_paid/voided/refunded.
export const IMPORTABLE_FINANCIAL_STATUSES = new Set(['paid', 'partially_refunded'])

// current_quantity reflects refunds/removals; fall back to quantity for older
// payloads that omit it.
export function currentQuantity(line) {
  const cur = line.current_quantity
  return Number.isInteger(cur) ? cur : Number(line.quantity) || 0
}

// Whole-order skip reason (null = importable). Mirrors the line statuses used in
// the import result so the UI can explain why an order is disabled.
export function orderSkipReason(order) {
  if (order.cancelled_at) return 'skipped_cancelled'
  if (String(order.currency || '').toUpperCase() !== EUR) return 'skipped_unsupported_currency'
  if (!IMPORTABLE_FINANCIAL_STATUSES.has(order.financial_status)) return 'skipped_unpaid'
  return null
}

// Per-line skip reason independent of mapping (a fully refunded/removed line).
export function lineSkipReason(line) {
  if (currentQuantity(line) <= 0) return 'skipped_refunded_line'
  return null
}

// Total discount allocated to a line, in cents, at the order's *original*
// quantity. Prefers discount_allocations (the authoritative per-application
// list); falls back to total_discount.
function lineDiscountCents(line) {
  const allocations = Array.isArray(line.discount_allocations) ? line.discount_allocations : null
  if (allocations?.length) {
    return allocations.reduce((sum, a) => sum + Math.round(Number(a.amount || 0) * 100), 0)
  }
  return Math.round(Number(line.total_discount || 0) * 100)
}

// Exact inclusive gross (cents) actually charged for a line, for the units still
// live (current_quantity). Discounts are pro-rated from the original quantity;
// VAT is added only when the store's prices exclude tax, using the supplied rate
// (the mapped product's vat_rate, or the revenue-line's chosen rate).
export function computeLineGrossInclCents(order, line, vatRate) {
  const qty = currentQuantity(line)
  if (qty <= 0) return 0
  const unitCents = Math.round(Number(line.price || 0) * 100)
  const origQty = Number(line.quantity) || qty
  const discountCents = lineDiscountCents(line)
  const proratedDiscount = origQty > 0 ? Math.round((discountCents * qty) / origQty) : 0
  const subtotal = unitCents * qty - proratedDiscount
  const gross = order.taxes_included
    ? subtotal
    : subtotal + Math.round((subtotal * Number(vatRate || 0)) / 100)
  return Math.max(0, gross)
}
