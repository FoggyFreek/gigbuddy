// Which existing supplier contact an imported document refers to.
//
// One owner for the precedence, because two importers ask the same question:
// the bank-statement importer matches a counterparty on a debit line, and the
// e-invoice importer matches the AccountingSupplierParty. Both feed on
// findSuppliersForImport's rows, and both must answer the same way.
//
// IBAN before name: an IBAN identifies an account holder, a name is typed by
// whoever entered the contact. Pure — no DB.

/**
 * Indexes candidate supplier rows once, so a batch of lines costs one pass
 * rather than a scan per line.
 */
export function indexSuppliers(rows) {
  const byIban = new Map()
  const byName = new Map()
  for (const row of rows ?? []) {
    if (row.iban) {
      const key = row.iban.toUpperCase()
      byIban.set(key, [...(byIban.get(key) ?? []), row])
    }
    const name = (row.name ?? '').toLowerCase()
    byName.set(name, [...(byName.get(name) ?? []), row])
  }
  return { byIban, byName }
}

/**
 * Supplier rows matching `iban` (preferred) or, failing that, an exact
 * case-insensitive `name`. Always an array — empty means no match.
 */
export function matchSuppliers(index, { iban, name }) {
  const byIban = iban ? index.byIban.get(iban.toUpperCase()) : null
  if (byIban?.length) return byIban
  return (name ? index.byName.get(name.toLowerCase()) : null) ?? []
}
