// Display mapping for ledger browser rows. Type label, filter group, voided
// flag and amount sign are derived from (source_type, source_event) — they are
// not stored. The friendly description is built from the joined source-doc
// columns (see ledgerRepository.listTransactions); the raw
// ledger_transactions.description is the fallback when a join field is null.

const TYPE_MAP = {
  'invoice/sent':       { type: 'Invoice',          group: 'invoices',  voided: false, sign: 1 },
  'invoice/paid':       { type: 'Ingoing payment',  group: 'payments',  voided: false, sign: 1 },
  'invoice/void':       { type: 'Invoice (void)',   group: 'invoices',  voided: true,  sign: -1 },
  'purchase/accrued':   { type: 'Purchase',         group: 'purchases', voided: false, sign: -1 },
  'purchase/paid':      { type: 'Outgoing payment', group: 'payments',  voided: false, sign: -1 },
  'reimbursement/paid': { type: 'Reimbursement',    group: 'payments',  voided: false, sign: -1 },
  'merch_sale/recorded': { type: 'Merch sale',        group: 'invoices',  voided: false, sign: 1 },
  'merch_sale/voided':   { type: 'Merch sale (void)', group: 'invoices',  voided: true,  sign: -1 },
  'journal/posted':     { type: 'Journal',          group: 'journals',  voided: false, sign: null },
  'ledger_transaction/void': { type: 'Void',        group: 'journals',  voided: true,  sign: null },
  'vat_settlement/filed':        { type: 'VAT return',  group: 'journals', voided: false, sign: null },
  'vat_settlement_payment/paid': { type: 'VAT payment', group: 'payments', voided: false, sign: null },
}

export function classify(sourceType, sourceEvent) {
  return TYPE_MAP[`${sourceType}/${sourceEvent}`]
    || { type: sourceType, group: 'journals', voided: false, sign: null }
}

// Receipt column = source doc number; blank for invoices/payments/reimbursements.
export function receiptFor(row) {
  if (row.source_type === 'purchase') return row.purchase_receipt_number ?? null
  if (row.source_type === 'journal') return row.journal_entry_number ?? null
  return null
}

// Friendly display description per (source_type, source_event), built from the
// joined source-doc fields; falls back to the stored transaction description.
export function describe(row) {
  const fallback = row.description || null
  const key = `${row.source_type}/${row.source_event}`
  switch (key) {
    case 'invoice/sent':
      if (!row.invoice_number) return fallback
      return `Invoice number ${row.invoice_number} for ${row.invoice_customer_name ?? 'unknown customer'}`
    case 'invoice/paid':
      if (!row.invoice_number) return fallback
      return `Paid by ${row.invoice_customer_name ?? 'unknown customer'} for invoice ${row.invoice_number}`
    case 'invoice/void':
      if (!row.invoice_number) return fallback
      return `Invoice ${row.invoice_number} voided`
    case 'purchase/accrued':
      if (!row.purchase_supplier_name) return fallback
      return `Bill from ${row.purchase_supplier_name}${row.purchase_memo ? `: ${row.purchase_memo}` : ''}`
    case 'purchase/paid':
      if (!row.purchase_supplier_name) return fallback
      return `Paid to ${row.purchase_supplier_name} for bill ${row.purchase_receipt_number}`
    case 'reimbursement/paid':
      if (!row.reimbursement_member_name) return fallback
      return `Reimbursement to ${row.reimbursement_member_name}`
    case 'merch_sale/recorded':
      if (!row.merch_sale_product_name) return fallback
      return `Merch sale: ${row.merch_sale_quantity} × ${row.merch_sale_product_name}`
    case 'merch_sale/voided':
      if (!row.merch_sale_product_name) return fallback
      return `Merch sale voided: ${row.merch_sale_quantity} × ${row.merch_sale_product_name}`
    case 'journal/posted':
      return row.journal_description ?? fallback
    case 'vat_settlement/filed':
      if (!row.vat_return_year) return fallback
      return `VAT return ${row.vat_return_year} Q${row.vat_return_quarter}`
    case 'vat_settlement_payment/paid':
      if (!row.vat_return_year) return fallback
      return `VAT ${row.vat_payment_direction === 'refund' ? 'refund' : 'payment'} for ${row.vat_return_year} Q${row.vat_return_quarter}`
    default:
      return fallback
  }
}
