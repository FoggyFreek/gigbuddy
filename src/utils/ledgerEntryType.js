// Frontend mirror of server/services/ledgerEntryTypes.js: the filterable type
// groups shown in the Types dropdown. The per-row type/group/voided values
// themselves come from the API.
export const LEDGER_TYPE_GROUPS = [
  { key: 'purchases', label: 'Purchases' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'payments', label: 'Payments' },
  { key: 'journals', label: 'Journals' },
]

export const ALL_LEDGER_GROUPS = LEDGER_TYPE_GROUPS.map((g) => g.key)
