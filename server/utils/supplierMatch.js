// Which existing supplier contact an imported document refers to.
//
// One owner for the precedence, because two importers ask the same question:
// the bank-statement importer matches a counterparty on a debit line, and the
// e-invoice importer matches the AccountingSupplierParty. Both feed on
// findSuppliersForImport's rows, and both must answer the same way.
//
// Strong identifiers before name: an IBAN identifies an account holder, and VAT
// and registration IDs identify the business. A name is typed by whoever entered
// the contact. Pure — no DB.

/**
 * Indexes candidate supplier rows once, so a batch of lines costs one pass
 * rather than a scan per line.
 */
export function indexSuppliers(rows) {
  const byIban = new Map()
  const byName = new Map()
  const byTaxId = new Map()
  const byRegistrationId = new Map()
  for (const row of rows ?? []) {
    if (row.iban) {
      const key = row.iban.toUpperCase()
      byIban.set(key, [...(byIban.get(key) ?? []), row])
    }
    const name = (row.name ?? '').toLowerCase()
    byName.set(name, [...(byName.get(name) ?? []), row])
    if (row.tax_id) {
      const key = row.tax_id.toUpperCase()
      byTaxId.set(key, [...(byTaxId.get(key) ?? []), row])
    }
    if (row.kvk_number) {
      const key = row.kvk_number.toLowerCase()
      byRegistrationId.set(key, [...(byRegistrationId.get(key) ?? []), row])
    }
  }
  return { byIban, byName, byTaxId, byRegistrationId }
}

/**
 * Supplier rows matching a strong identifier (IBAN, VAT ID, registration ID)
 * or, failing those, an exact case-insensitive name. Always an array.
 */
export function matchSuppliers(index, { iban, name, taxId, registrationId }) {
  const byIban = iban ? index.byIban.get(iban.toUpperCase()) : null
  if (byIban?.length) return byIban
  const byTaxId = taxId ? index.byTaxId.get(taxId.toUpperCase()) : null
  if (byTaxId?.length) return byTaxId
  const byRegistrationId = registrationId
    ? index.byRegistrationId.get(registrationId.toLowerCase())
    : null
  if (byRegistrationId?.length) return byRegistrationId
  return (name ? index.byName.get(name.toLowerCase()) : null) ?? []
}
