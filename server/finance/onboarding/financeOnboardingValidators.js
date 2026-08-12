// Input parsing for the finance-onboarding routes. No DB access here.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Parses the manual opening-balance body. Returns { signedAmountCents, entryDate }
// or { error } with a code the route maps to 400. The amount is a signed integer
// number of cents (positive = a normal positive bank balance) and must be
// non-zero — a zero opening balance can't post two balanced lines and would
// never flip the "opening balance set" state.
export function parseOpeningBalanceBody(body = {}) {
  const cents = body.amount_cents
  if (!Number.isInteger(cents) || cents === 0) {
    return { error: { status: 400, body: { error: 'amount_cents must be a non-zero integer', code: 'invalid_amount' } } }
  }
  const entryDate = body.entry_date
  if (typeof entryDate !== 'string' || !ISO_DATE.test(entryDate) || Number.isNaN(Date.parse(entryDate))) {
    return { error: { status: 400, body: { error: 'entry_date must be an ISO date (YYYY-MM-DD)', code: 'invalid_date' } } }
  }
  return { signedAmountCents: cents, entryDate }
}
