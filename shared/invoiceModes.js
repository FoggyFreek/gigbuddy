export const INVOICE_MODES = Object.freeze(['combined', 'specified'])
export const DEFAULT_INVOICE_MODE = 'combined'

/**
 * The mode a gig actually invoices in. `specified` needs a booking fee to
 * specify; without one it collapses to `combined` rather than emitting a €0 line.
 */
export function resolveEffectiveMode(terms, preferredMode) {
  if (preferredMode !== 'specified') return DEFAULT_INVOICE_MODE
  return terms.agency_fee_basis === 'none' ? DEFAULT_INVOICE_MODE : 'specified'
}
