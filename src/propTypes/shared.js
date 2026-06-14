// Shared PropTypes shapes for common app entities, so components declare
// meaningful contracts (issue #56) without duplicating large prop blocks.
import PropTypes from 'prop-types'

export const idProp = PropTypes.oneOfType([PropTypes.number, PropTypes.string])

export const venueShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
  category: PropTypes.string,
  organization_name: PropTypes.string,
  city: PropTypes.string,
  region: PropTypes.string,
  postal_code: PropTypes.string,
  country: PropTypes.string,
  primary_contact_name: PropTypes.string,
  years: PropTypes.arrayOf(PropTypes.number),
  is_primary: PropTypes.bool,
})

export const gigShape = PropTypes.shape({
  id: idProp,
  event_date: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
  event_description: PropTypes.string,
  status: PropTypes.string,
  start_time: PropTypes.string,
  end_time: PropTypes.string,
  banner_path: PropTypes.string,
  venue: venueShape,
  festival: venueShape,
  open_task_count: PropTypes.number,
})

export const memberShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
  color: PropTypes.string,
  position: PropTypes.string,
  sort_order: PropTypes.number,
})

export const participantShape = PropTypes.shape({
  band_member_id: idProp,
  name: PropTypes.string,
  color: PropTypes.string,
  position: PropTypes.string,
  vote: PropTypes.string,
})

// A song linked to a rehearsal (rehearsal.songs entries).
export const rehearsalSongShape = PropTypes.shape({
  song_id: idProp,
  title: PropTypes.string,
  artist: PropTypes.string,
})

export const rehearsalShape = PropTypes.shape({
  id: idProp,
  proposed_date: PropTypes.string,
  status: PropTypes.string,
  location: PropTypes.string,
  participants: PropTypes.arrayOf(participantShape),
  songs: PropTypes.arrayOf(rehearsalSongShape),
})

export const bandEventShape = PropTypes.shape({
  id: idProp,
  title: PropTypes.string,
  start_date: PropTypes.string,
  end_date: PropTypes.string,
  location: PropTypes.string,
})

export const slotShape = PropTypes.shape({
  id: idProp,
  band_member_id: idProp,
  start_date: PropTypes.string,
  end_date: PropTypes.string,
  status: PropTypes.string,
  reason: PropTypes.string,
})

export const tenantShape = PropTypes.shape({
  id: idProp,
  band_name: PropTypes.string,
  formal_name: PropTypes.string,
  logo_path: PropTypes.string,
  applies_kor: PropTypes.bool,
  tax_percentage: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  address_street: PropTypes.string,
  address_postal_code: PropTypes.string,
  address_city: PropTypes.string,
  address_country: PropTypes.string,
  kvk_number: PropTypes.string,
  iban: PropTypes.string,
  tax_id: PropTypes.string,
})

export const contactShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
  email: PropTypes.string,
  phone: PropTypes.string,
  category: PropTypes.string,
})

export const invoiceLineShape = PropTypes.shape({
  id: idProp,
  description: PropTypes.string,
  quantity: PropTypes.number,
  unit_price_cents: PropTypes.number,
  tax_percentage: PropTypes.number,
  position: PropTypes.number,
})

export const invoiceShape = PropTypes.shape({
  id: idProp,
  invoice_number: PropTypes.string,
  status: PropTypes.string,
  finalized_at: PropTypes.string,
  issue_date: PropTypes.string,
  due_date: PropTypes.string,
  payment_term_days: PropTypes.number,
  customer_name: PropTypes.string,
  total_cents: PropTypes.number,
  pdf_path: PropTypes.string,
  custom_logo_path: PropTypes.string,
  invert_logo: PropTypes.bool,
  mollie_payment_link_id: PropTypes.string,
  mollie_payment_link_url: PropTypes.string,
  mollie_payment_status: PropTypes.string,
  lines: PropTypes.arrayOf(invoiceLineShape),
  tenant: tenantShape,
})

export const purchaseLineShape = PropTypes.shape({
  id: idProp,
  description: PropTypes.string,
  account_code: PropTypes.string,
  expense_category: PropTypes.string,
  tax_rate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  amount_incl_cents: PropTypes.number,
  position: PropTypes.number,
})

export const purchaseAttachmentShape = PropTypes.shape({
  id: idProp,
  object_key: PropTypes.string,
  original_filename: PropTypes.string,
  content_type: PropTypes.string,
  file_size: PropTypes.number,
  uploaded_at: PropTypes.string,
})

export const purchaseShape = PropTypes.shape({
  id: idProp,
  receipt_number: PropTypes.number,
  status: PropTypes.string,
  finalized_at: PropTypes.string,
  receipt_date: PropTypes.string,
  due_date: PropTypes.string,
  currency: PropTypes.string,
  supplier_name: PropTypes.string,
  supplier_contact_id: idProp,
  description: PropTypes.string,
  memo: PropTypes.string,
  subtotal_cents: PropTypes.number,
  tax_cents: PropTypes.number,
  total_cents: PropTypes.number,
  paid_at: PropTypes.string,
  payment_method: PropTypes.string,
  paid_by_band_member_id: idProp,
  lines: PropTypes.arrayOf(purchaseLineShape),
  attachments: PropTypes.arrayOf(purchaseAttachmentShape),
})

// One band member's outstanding reimbursement balance (from /reimbursements/outstanding).
export const memberOutstandingShape = PropTypes.shape({
  band_member_id: idProp,
  band_member_name: PropTypes.string,
  user_id: idProp,
  outstanding_cents: PropTypes.number,
  outstanding_count: PropTypes.number,
})

export const songTagShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
})

export const songLinkShape = PropTypes.shape({
  id: idProp,
  label: PropTypes.string,
  url: PropTypes.string,
  sort_order: PropTypes.number,
})

// Documents and recordings share this stored-file shape.
export const songFileShape = PropTypes.shape({
  id: idProp,
  object_key: PropTypes.string,
  original_filename: PropTypes.string,
  content_type: PropTypes.string,
  file_size: PropTypes.number,
  uploaded_at: PropTypes.string,
})

export const songShape = PropTypes.shape({
  id: idProp,
  title: PropTypes.string,
  artist: PropTypes.string,
  song_key: PropTypes.string,
  tempo: PropTypes.number,
  duration_seconds: PropTypes.number,
  lyrics_html: PropTypes.string,
  notes: PropTypes.string,
  tags: PropTypes.arrayOf(songTagShape),
  links: PropTypes.arrayOf(songLinkShape),
  documents: PropTypes.arrayOf(songFileShape),
  recordings: PropTypes.arrayOf(songFileShape),
})

export const setlistItemShape = PropTypes.shape({
  id: idProp,
  item_type: PropTypes.oneOf(['song', 'pause', 'break']),
  song_id: idProp,
  duration_seconds: PropTypes.number,
  label: PropTypes.string,
  sort_order: PropTypes.number,
  linked_to_next: PropTypes.bool,
  transition_note: PropTypes.string,
  my_note: PropTypes.string, // requesting member's personal note on this song-in-set
  // enrichment for song items (joined server-side)
  title: PropTypes.string,
  artist: PropTypes.string,
  song_key: PropTypes.string,
  tempo: PropTypes.number,
  tag: PropTypes.string,
})

export const setlistSetShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
  include_in_total: PropTypes.bool,
  sort_order: PropTypes.number,
  items: PropTypes.arrayOf(setlistItemShape),
})

export const setlistShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
  total_seconds: PropTypes.number,
  set_count: PropTypes.number,
  song_count: PropTypes.number,
  sets: PropTypes.arrayOf(setlistSetShape),
})

export const accountShape = PropTypes.shape({
  id: idProp,
  code: PropTypes.string,
  name: PropTypes.string,
  type: PropTypes.string,
  parent_code: PropTypes.string,
  is_active: PropTypes.bool,
  is_system: PropTypes.bool,
  is_capitalizable: PropTypes.bool,
})

export const accountingSettingsShape = PropTypes.shape({
  tenant_id: idProp,
  currency: PropTypes.string,
  receivable_account_code: PropTypes.string,
  default_revenue_account_code: PropTypes.string,
  payable_account_code: PropTypes.string,
  default_reimbursement_account_code: PropTypes.string,
  default_expense_account_code: PropTypes.string,
  primary_checking_account_code: PropTypes.string,
  output_vat_account_code: PropTypes.string,
  input_vat_account_code: PropTypes.string,
})

export const journalLineShape = PropTypes.shape({
  id: idProp,
  description: PropTypes.string,
  account_code: PropTypes.string,
  vat_rate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  side: PropTypes.oneOf(['debit', 'credit', null]),
  amount_cents: PropTypes.number,
  balancing_account_code: PropTypes.string,
  position: PropTypes.number,
})

export const journalShape = PropTypes.shape({
  id: idProp,
  entry_number: PropTypes.number,
  entry_date: PropTypes.string,
  description: PropTypes.string,
  status: PropTypes.oneOf(['draft', 'approved']),
  posted_transaction_id: idProp,
  lines: PropTypes.arrayOf(journalLineShape),
})

// One row of the read-only ledger browser list (GET /api/ledger).
export const ledgerEntryRowShape = PropTypes.shape({
  id: idProp,
  entry_date: PropTypes.string,
  type: PropTypes.string,
  group: PropTypes.string,
  voided: PropTypes.bool,
  receipt: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  description: PropTypes.string,
  amount_cents: PropTypes.number,
  source_type: PropTypes.string,
  source_id: idProp,
})

// One journal line in the ledger entry detail (GET /api/ledger/:id).
export const ledgerLineShape = PropTypes.shape({
  id: idProp,
  account_code: PropTypes.string,
  account_name: PropTypes.string,
  memo: PropTypes.string,
  debit_cents: PropTypes.number,
  credit_cents: PropTypes.number,
})

export const periodShape = PropTypes.shape({
  mode: PropTypes.oneOf(['fiscal_year', 'month', 'quarter', 'all_time', 'custom']).isRequired,
  year: PropTypes.number,
  month: PropTypes.number,
  quarter: PropTypes.number,
  from: PropTypes.string,
  to: PropTypes.string,
})

// The per-cell view model produced by buildCalendarCellViewModel.
export const calendarCellShape = PropTypes.shape({
  iso: PropTypes.string.isRequired,
  date: PropTypes.instanceOf(Date).isRequired,
  inMonth: PropTypes.bool,
  isRowStart: PropTypes.bool,
  week: PropTypes.number,
  cellSlots: PropTypes.arrayOf(slotShape),
  cellGigs: PropTypes.arrayOf(gigShape),
  cellRehearsals: PropTypes.arrayOf(rehearsalShape),
  cellBandEvents: PropTypes.arrayOf(bandEventShape),
  isSelected: PropTypes.bool,
  isToday: PropTypes.bool,
  isWeekend: PropTypes.bool,
  bgcolor: PropTypes.string,
})

// One payment/refund against a filed VAT declaration.
export const vatReturnPaymentShape = PropTypes.shape({
  id: idProp,
  amount_cents: PropTypes.number,
  direction: PropTypes.oneOf(['payment', 'refund']),
  bank_account_code: PropTypes.string,
  paid_on: PropTypes.string,
})

// A filed VAT declaration (GET /api/vat-returns).
export const vatReturnShape = PropTypes.shape({
  id: idProp,
  year: PropTypes.number,
  quarter: PropTypes.number,
  period_from: PropTypes.string,
  period_to: PropTypes.string,
  input_vat_cents: PropTypes.number,
  output_vat_cents: PropTypes.number,
  net_cents: PropTypes.number,
  direction: PropTypes.oneOf(['payable', 'receivable', 'nil']),
  settlement_account_code: PropTypes.string,
  due_date: PropTypes.string,
  notes: PropTypes.string,
  status: PropTypes.string,
  paid_cents: PropTypes.number,
  payments: PropTypes.arrayOf(vatReturnPaymentShape),
  ledger_transaction_id: idProp,
})

// The quarter preview returned by GET /api/vat-returns/preview.
export const vatReturnPreviewShape = PropTypes.shape({
  year: PropTypes.number,
  quarter: PropTypes.number,
  period_from: PropTypes.string,
  period_to: PropTypes.string,
  due_date: PropTypes.string,
  input_vat_cents: PropTypes.number,
  output_vat_cents: PropTypes.number,
  net_cents: PropTypes.number,
  direction: PropTypes.oneOf(['payable', 'receivable', 'nil']),
  period_ended: PropTypes.bool,
})

// A merch product (GET /api/merch/products).
export const productShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
  unit_cost_cents: PropTypes.number,
  default_price_incl_cents: PropTypes.number,
  vat_rate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  quantity_on_hand: PropTypes.number,
  archived_at: PropTypes.string,
})

// A merch sale row (GET /api/merch/sales).
export const merchSaleShape = PropTypes.shape({
  id: idProp,
  product_id: idProp,
  product_name: PropTypes.string,
  gig_id: idProp,
  sale_date: PropTypes.string,
  quantity: PropTypes.number,
  unit_price_incl_cents: PropTypes.number,
  vat_rate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  unit_cost_cents: PropTypes.number,
  payment_method: PropTypes.oneOf(['bank', 'cash']),
  status: PropTypes.oneOf(['recorded', 'voided']),
  voided_at: PropTypes.string,
})
