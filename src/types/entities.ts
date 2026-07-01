// Canonical domain types for the app. This is the single source of truth for
// shared entity shapes — it replaced the old src/propTypes/shared.js (deleted
// after the JS→TS migration; React 19 no longer reads PropTypes at runtime).
// Components import the type they need from here rather than redeclaring shapes.
//
// Conventions:
// - Fields are optional (`?`) unless the original PropTypes marked `.isRequired`,
//   so these types match the loose reality of server payloads we already render.
// - `Id` is a number from Postgres, sometimes a string from the client.

export type Id = number | string

export interface Venue {
  id?: Id
  name?: string
  category?: string
  organization_name?: string
  street_and_number?: string | null
  city?: string
  region?: string
  postal_code?: string
  country?: string
  primary_contact_name?: string
  years?: number[]
  is_primary?: boolean
}

export interface Gig {
  id?: Id
  event_date?: string | Date
  event_description?: string
  status?: string
  start_time?: string | null
  end_time?: string | null
  banner_path?: string
  venue?: Venue
  festival?: Venue
  open_task_count?: number
  venue_id?: Id | null
  festival_id?: Id | null
  // Venue deal terms. NUMERIC(5,2) percentages arrive as strings over the wire
  // but may be set as numbers in code; null = not agreed.
  merchandise_cut?: number | string | null
  percentage_of_sales?: number | string | null
}

export interface Member {
  id?: Id
  name?: string
  color?: string
  position?: string
  sort_order?: number
}

// A task. May be linked to a gig (gig_id set, with event_description/event_date
// joined in for display) or stand alone (gig_id null). assigned_to null = no
// assignee.
export interface Task {
  id?: Id
  title?: string
  done?: boolean
  due_date?: string | null
  assigned_to?: Id | null
  assigned_to_name?: string | null
  gig_id?: Id | null
  event_description?: string | null
  event_date?: string | Date | null
  created_at?: string
}

export interface Participant {
  band_member_id?: Id
  name?: string
  color?: string
  position?: string
  vote?: string
}

/** A song linked to a rehearsal (rehearsal.songs entries). */
export interface RehearsalSong {
  song_id?: Id
  title?: string
  artist?: string
}

export interface Rehearsal {
  id?: Id
  proposed_date?: string
  status?: string
  location?: string
  start_time?: string
  end_time?: string
  notes?: string
  participants?: Participant[]
  songs?: RehearsalSong[]
}

export interface BandEvent {
  id?: Id
  title?: string
  start_date?: string
  end_date?: string
  location?: string
}

export interface Slot {
  id?: Id
  band_member_id?: Id | null // null = whole-band slot
  start_date?: string
  end_date?: string
  status?: string
  reason?: string | null
}

export interface Tenant {
  id?: Id
  band_name?: string
  formal_name?: string
  logo_path?: string | null
  banner_path?: string | null
  avatar_path?: string | null
  logo_dark_path?: string | null
  applies_kor?: boolean
  tax_percentage?: number | string
  address_street?: string
  address_postal_code?: string
  address_city?: string
  address_country?: string
  kvk_number?: string
  iban?: string
  tax_id?: string
  accent_color?: string | null
  instagram_handle?: string
  facebook_handle?: string
  tiktok_handle?: string
}

export interface Contact {
  id?: Id
  name?: string
  email?: string | null
  phone?: string | null
  category?: string
}

export interface InvoiceLine {
  id?: Id
  description?: string
  quantity?: number
  unit_price_cents?: number
  tax_percentage?: number
  position?: number
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void'

export interface Invoice {
  id?: Id
  invoice_number?: string
  status?: InvoiceStatus
  finalized_at?: string
  issue_date?: string
  due_date?: string
  payment_term_days?: number
  customer_name?: string
  // Event name of the linked gig, attached only by the invoice search read
  // (invoices.gig_id → gigs). Null when the invoice isn't linked to a gig.
  gig_event_description?: string | null
  total_cents?: number
  pdf_path?: string
  custom_logo_path?: string
  invert_logo?: boolean
  mollie_payment_link_id?: string
  mollie_payment_link_url?: string
  mollie_payment_status?: string
  lines?: InvoiceLine[]
  tenant?: Tenant
}

export interface PurchaseLine {
  id?: Id
  description?: string
  account_code?: string
  expense_category?: string
  tax_rate?: number | string
  amount_incl_cents?: number
  position?: number
}

export interface PurchaseAttachment {
  id?: Id
  object_key?: string
  original_filename?: string
  content_type?: string
  file_size?: number
  uploaded_at?: string
}

export type PurchaseStatus = 'draft' | 'approved' | 'paid'
export type PurchasePaymentMethod = 'bank' | 'member'

export interface Purchase {
  id?: Id
  receipt_number?: number
  status?: PurchaseStatus
  finalized_at?: string
  receipt_date?: string
  due_date?: string | null
  currency?: string
  supplier_name?: string
  supplier_contact_id?: Id | null
  description?: string
  memo?: string | null
  subtotal_cents?: number
  tax_cents?: number
  total_cents?: number
  paid_at?: string
  payment_method?: PurchasePaymentMethod
  paid_by_band_member_id?: Id
  lines?: PurchaseLine[]
  attachments?: PurchaseAttachment[]
}

/** One band member's outstanding reimbursement balance (from /reimbursements/outstanding). */
export interface MemberOutstanding {
  band_member_id?: Id
  band_member_name?: string
  user_id?: Id
  outstanding_cents?: number
  outstanding_count?: number
}

export interface SongTag {
  id?: Id
  name?: string
}

export interface SongLink {
  id?: Id
  label?: string | null
  url?: string
  sort_order?: number
}

/** Documents and recordings share this stored-file shape. */
export interface SongFile {
  id?: Id
  object_key?: string
  original_filename?: string
  content_type?: string
  file_size?: number
  uploaded_at?: string
}

/** An editable ChordPro lead-sheet attached to a song. */
export interface SongChart {
  id?: Id
  name?: string
  /** raw ChordPro source */
  source?: string
  created_at?: string
  updated_at?: string
}

export interface Song {
  id?: Id
  title?: string
  artist?: string | null
  song_key?: string | null
  tempo?: number | null
  duration_seconds?: number | null
  lyrics_html?: string
  notes?: string
  tags?: SongTag[]
  links?: SongLink[]
  documents?: SongFile[]
  recordings?: SongFile[]
  chordpro_charts?: SongChart[]
}

export interface SetlistItem {
  id?: Id
  item_type?: 'song' | 'pause' | 'break'
  song_id?: Id
  duration_seconds?: number
  label?: string
  sort_order?: number
  linked_to_next?: boolean
  transition_note?: string
  /** requesting member's personal note on this song-in-set */
  my_note?: string
  // enrichment for song items (joined server-side)
  title?: string
  artist?: string
  song_key?: string
  tempo?: number
  tag?: string
}

export interface SetlistSet {
  id?: Id
  name?: string
  include_in_total?: boolean
  sort_order?: number
  items?: SetlistItem[]
}

export interface Setlist {
  id?: Id
  name?: string
  total_seconds?: number
  set_count?: number
  song_count?: number
  sets?: SetlistSet[]
}

export interface Account {
  id?: Id
  code?: string
  name?: string
  type?: string
  parent_code?: string
  is_active?: boolean
  is_system?: boolean
  is_capitalizable?: boolean
}

export interface AccountingSettings {
  tenant_id?: Id
  currency?: string
  receivable_account_code?: string
  default_revenue_account_code?: string
  payable_account_code?: string
  default_reimbursement_account_code?: string
  default_expense_account_code?: string
  primary_checking_account_code?: string
  cash_account_code?: string
  output_vat_account_code?: string
  input_vat_account_code?: string
  merch_revenue_account_code?: string
  books_closed_through?: string
}

export interface JournalLine {
  id?: Id
  description?: string | null
  account_code?: string | null
  vat_rate?: number | string
  side?: 'debit' | 'credit' | null
  amount_cents?: number
  balancing_account_code?: string | null
  position?: number
}

export interface Journal {
  id?: Id
  entry_number?: number
  entry_date?: string
  description?: string | null
  status?: 'draft' | 'approved'
  posted_transaction_id?: Id
  lines?: JournalLine[]
}

/** One row of the read-only ledger browser list (GET /api/ledger). */
export interface LedgerEntryRow {
  id?: Id
  entry_date?: string
  type?: string
  group?: string
  voided?: boolean
  receipt?: number | string
  description?: string
  amount_cents?: number
  source_type?: string
  source_id?: Id
}

/** One entry-line result of the ledger entry search (GET /api/ledger/entries). */
export interface LedgerEntryLineRow {
  id?: Id
  transaction_id?: Id
  entry_date?: string
  account_code?: string
  account_name?: string
  type?: string
  description?: string | null
  memo?: string | null
  debit_cents?: number
  credit_cents?: number
  source_type?: string
  source_event?: string
  voided?: boolean
}

/** One journal line in the ledger entry detail (GET /api/ledger/:id). */
export interface LedgerLine {
  id?: Id
  account_code?: string
  account_name?: string
  memo?: string
  debit_cents?: number
  credit_cents?: number
}

export interface Period {
  mode: 'fiscal_year' | 'month' | 'quarter' | 'all_time' | 'custom'
  year?: number
  month?: number
  quarter?: number
  from?: string
  to?: string
}

/** The per-cell view model produced by buildCalendarCellViewModel. */
export interface CalendarCell {
  iso: string
  date: Date
  inMonth?: boolean
  isRowStart?: boolean
  week?: number
  cellSlots?: Slot[]
  cellGigs?: Gig[]
  cellRehearsals?: Rehearsal[]
  cellBandEvents?: BandEvent[]
  isSelected?: boolean
  isToday?: boolean
  isWeekend?: boolean
  bgcolor?: string
}

/** One payment/refund against a filed VAT declaration. */
export interface VatReturnPayment {
  id?: Id
  amount_cents?: number
  direction?: 'payment' | 'refund'
  bank_account_code?: string
  paid_on?: string
}

export type VatReturnStatus =
  | 'paid'
  | 'received'
  | 'settled'
  | 'partially_paid'
  | 'partially_received'
  | 'unpaid'
  | 'not_received'

export type VatQuarter = 1 | 2 | 3 | 4

/** A filed VAT declaration (GET /api/vat-returns). */
export interface VatReturn {
  id?: Id
  year?: number
  quarter?: VatQuarter
  period_from?: string
  period_to?: string
  input_vat_cents?: number
  output_vat_cents?: number
  net_cents?: number
  direction?: 'payable' | 'receivable' | 'nil'
  settlement_account_code?: string
  due_date?: string
  notes?: string
  status?: VatReturnStatus
  paid_cents?: number
  payments?: VatReturnPayment[]
  ledger_transaction_id?: Id
}

/** The quarter preview returned by GET /api/vat-returns/preview. */
export interface VatReturnPreview {
  year?: number
  quarter?: VatQuarter
  period_from?: string
  period_to?: string
  due_date?: string
  input_vat_cents?: number
  output_vat_cents?: number
  net_cents?: number
  direction?: 'payable' | 'receivable' | 'nil'
  period_ended?: boolean
}

/** A merch product (GET /api/merch/products). */
export interface Product {
  id?: Id
  name?: string
  unit_cost_cents?: number
  default_price_incl_cents?: number
  vat_rate?: number | string
  quantity_on_hand?: number
  revenue_account_code?: string | null
  archived_at?: string
}

/** A merch sale row (GET /api/merch/sales). */
export interface MerchSale {
  id?: Id
  product_id?: Id
  product_name?: string
  gig_id?: Id
  sale_date?: string
  quantity?: number
  unit_price_incl_cents?: number
  // Exact inclusive line total for imported (Shopify) sales whose discounted
  // gross isn't divisible by quantity; null for manual sales (use quantity ×
  // unit_price_incl_cents).
  gross_incl_cents?: number | null
  vat_rate?: number | string
  unit_cost_cents?: number
  payment_method?: 'bank' | 'cash'
  revenue_account_code?: string | null
  status?: 'recorded' | 'voided'
  voided_at?: string
}

// One row of the per-product sales summary (master list): recorded-sale totals
// for a product in the selected period.
export interface MerchSalesSummaryRow {
  product_id: Id
  product_name: string
  revenue_account_code: string | null
  revenue_account_name: string | null
  total_qty: number
  total_amount_cents: number
}

// Merch-sold totals for a single gig (GET /api/gigs/:id/merch-summary):
// recorded sales linked to that gig. netCents is Excl. VAT.
export interface GigMerchSummary {
  unitsSold: number
  netCents: number
  grossCents: number
}

// ---------- Shopify import ----------

// A Shopify order line as returned by the import picker (slim DTO + UI flags).
export interface ShopifyLineItem {
  id: string
  title: string
  sku: string | null
  quantity: number
  current_quantity: number
  price: string
  total_discount: string
  already_imported: boolean
  skip_reason: string | null
}

// A Shopify order as returned by GET /api/merch/shopify/orders.
export interface ShopifyOrder {
  id: string
  name: string
  created_at: string
  processed_at: string
  financial_status: string
  fulfillment_status: string | null
  cancelled_at: string | null
  currency: string
  taxes_included: boolean
  total_incl_cents: number
  line_items: ShopifyLineItem[]
  skip_reason: string | null
  fully_imported: boolean
}

export interface ShopifyOrdersPage {
  orders: ShopifyOrder[]
  nextCursor: string | null
}

// Per-line mapping decision the user makes in step 2 of the import dialog.
export type ShopifyLineMapping =
  | { type: 'product'; product_id: Id }
  | { type: 'revenue'; account_code: string; vat_rate: number }
  | { type: 'skip' }

export interface ShopifyImportBody {
  orders: {
    shopify_order_id: string
    lines: { shopify_line_id: string; mapping: ShopifyLineMapping }[]
  }[]
}

export interface ShopifyImportResult {
  imported: number
  skipped: number
  results: { shopify_line_id: string; status: string }[]
}
