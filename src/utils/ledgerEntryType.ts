// Frontend mirror of server/services/ledgerEntryTypes.js: the filterable type
// groups shown in the Types dropdown. The per-row type/group/voided values
// themselves come from the API.

// Group keys match the leaf keys under `ledger.typeGroups` in the i18n
// resources, so the Types filter resolves each label via the selector API.
export const LEDGER_TYPE_GROUPS = [
  { key: 'purchases' },
  { key: 'invoices' },
  { key: 'payments' },
  { key: 'journals' },
] as const

export type LedgerGroupKey = typeof LEDGER_TYPE_GROUPS[number]['key']

export const ALL_LEDGER_GROUPS: LedgerGroupKey[] = LEDGER_TYPE_GROUPS.map((g) => g.key)
