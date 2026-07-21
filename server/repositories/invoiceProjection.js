const INVOICE_COLUMNS = Object.freeze([
  'id', 'tenant_id', 'gig_id', 'invoice_number', 'issue_date', 'due_date', 'payment_term_days',
  'customer_name', 'customer_address_street', 'customer_address_postal_code', 'customer_address_city',
  'customer_address_country', 'customer_email', 'customer_kvk', 'customer_tax_id',
  'custom_logo_path', 'memo', 'tax_inclusive', 'reverse_charge', 'supply_date', 'discount_cents',
  'subtotal_cents', 'tax_cents', 'total_cents', 'pdf_path', 'status', 'finalized_at',
  'created_at', 'updated_at', 'discount_type', 'discount_pct',
  'customer_contact_title', 'customer_contact_given_name', 'customer_contact_family_name',
  'invert_logo', 'mollie_payment_link_id', 'mollie_payment_link_url',
  'mollie_payment_link_created_at', 'mollie_payment_link_expires_at', 'mollie_payment_status',
  'mollie_payment_id', 'mollie_paid_at', 'created_by_user_id',
  'vies_checked_at', 'vies_checked_vat_number', 'vies_consultation_number',
])

export function invoiceProjection(alias = null) {
  if (alias !== null && !/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid SQL alias')
  return INVOICE_COLUMNS.map((column) => alias ? `${alias}.${column}` : column).join(', ')
}

