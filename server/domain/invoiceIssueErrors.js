// Human-readable messages for the invoice issuance-readiness / reverse-charge
// codes produced by shared/invoiceReadiness.js.
//
// The API convention in this codebase is { error: <sentence>, code: <machine> }
// (see the finalized/void errors in invoiceService): `error` is a readable
// fallback, `code` is what clients branch on. The SPA translates `code` via the
// invoices i18n `issueErrors` block; these English sentences are what non-SPA
// consumers and logs see, so they must stay meaningful on their own.
const MESSAGES = Object.freeze({
  incomplete_supplier_details: 'Your band\'s name, street and city are required on an invoice. Complete them in the financial profile.',
  incomplete_customer_details: 'The customer\'s name, street and city are required on an invoice.',
  missing_issue_date: 'An invoice needs a valid issue date.',
  invalid_lines: 'An invoice needs at least one line with a description and a quantity above zero.',
  missing_registration_info: 'An incorporated band must show its company registration number (and register office where applicable) on invoices.',
  missing_supplier_vat_id: 'Your VAT number is required on an invoice that charges VAT or applies the reverse charge.',
  customer_tax_id_required_for_reverse_charge: 'The reverse charge requires the customer\'s VAT number.',
  reverse_charge_xi_services_unsupported: 'A Northern Ireland (XI) VAT number covers goods only, so it cannot carry the reverse charge for a performance.',
  reverse_charge_requires_eu_supplier: 'The reverse charge only applies when your band\'s VAT country is in the EU.',
  reverse_charge_requires_eu_customer: 'The reverse charge only applies to a customer in an EU country.',
  reverse_charge_requires_cross_border: 'The reverse charge only applies to a customer in a different EU country than your own.',
  customer_vat_number_country_mismatch: 'The customer\'s VAT number belongs to a different country than their address.',
  invalid_customer_vat_number: 'The customer\'s VAT number is not valid for their country.',
  reverse_charge_vies_check_required: 'Confirm you checked the customer\'s VAT number in VIES before issuing a reverse-charge invoice.',
  reverse_charge_vies_check_stale: 'The customer\'s VAT number changed since the VIES check. Check the new number in VIES and confirm again.',
})

// Completeness against INVOICE_ISSUE_ERROR_CODES (and the SPA's i18n block) is
// asserted by src/tests/invoiceReadiness.test.js. It is deliberately NOT checked
// at import time: a missing message degrades to showing the bare code, which must
// never be escalated into a failure to boot the server.
export function invoiceIssueMessage(code) {
  return MESSAGES[code] ?? code
}

// Builds the { status, body } an issuance/reverse-charge failure responds with.
export function invoiceIssueError(code, status) {
  return { status, body: { error: invoiceIssueMessage(code), code } }
}
