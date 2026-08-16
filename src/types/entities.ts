// Canonical domain types for the app. This is the single source of truth for
// shared entity shapes — it replaced the old src/propTypes/shared.js (deleted
// after the JS→TS migration; React 19 no longer reads PropTypes at runtime).
// Components import the type they need from here rather than redeclaring shapes.
//
// Conventions:
// - Fields are optional (`?`) unless the original PropTypes marked `.isRequired`,
//   so these types match the loose reality of server payloads we already render.
// - `Id` is a number from Postgres, sometimes a string from the client.
import type { PurchaseImportWarningCode } from '../finance/purchases/purchaseImportWarnings.ts'
import type { BandMemberRole } from '../people/memberships/bandMemberRoles.ts'
import type { GigEquipmentItemKey, GigEquipmentProvider } from '../planning/gigs/gigEquipment.ts'
import type { TenantKind } from '../auth/tenantKinds.ts'
import type { JoinPolicy } from '../people/memberships/membership.ts'

export type Id = number | string

export interface Venue {
  id?: Id
  name?: string
  category?: string
  organization_name?: string
  kvk_number?: string | null
  tax_id?: string | null
  street_and_number?: string | null
  city?: string
  region?: string
  postal_code?: string
  country?: string
  primary_contact_name?: string
  years?: number[]
  is_primary?: boolean
  latitude?: number | null
  longitude?: number | null
}

/**
 * Which of the artist's bands a personal-workspace event was for. A domain
 * reference like `venue`, NOT a tenant label — a foreign-tenant row is
 * identified by CrossTenantRef in api.ts, and conflating the two would make a
 * band tag look like a read-only marker.
 *
 * Only ever set in a personal workspace; a band's own events are already the
 * band's.
 */
export interface MyBandRef {
  id: Id
  name: string
  country_code: string
}

/**
 * The claiming band, disclosed ONLY when that band opted into discovery — its
 * id is the input to the join-request and avatar endpoints, so emitting it for
 * an invite-only band would reveal a private tenant. `claimed` stays true
 * either way.
 */
export interface ClaimedTenantRef {
  id: Id
  slug: string
  displayName: string
  logoPath: string | null
}

export type BandProfileStatus = 'claimable' | 'pending_claim' | 'claimed'

/**
 * A band that is not a gigbuddy customer: one shared, global row, held by the
 * musicians who play in it. Deliberately thin — no avatar, no roster.
 */
export interface BandProfile {
  id: Id
  name: string
  countryCode: string
  spotifyUrl: string | null
  websiteUrl: string | null
  contactEmail: string | null
  /** Derived server-side from the claim state; never stored. */
  status: BandProfileStatus
  claimed: boolean
  claimedTenant: ClaimedTenantRef | null
  createdAt: string
  /** Search only: this hit matched the website the caller typed, not the name. */
  websiteMatch?: boolean
  /** Detail only: the caller created it and nobody is claiming it. */
  canEdit?: boolean
}

export interface MyBandEventCounts {
  gigs: number
  rehearsals: number
  bandEvents: number
}

/** One entry in a personal workspace's My Bands collection. */
export interface MyBand {
  id: Id
  bandProfile: BandProfile
  eventCounts: MyBandEventCounts
  addedAt: string
}

export type ClaimStatus = 'pending' | 'approved' | 'rejected'

/**
 * A band tenant's request to be recognised as the owner of a global profile.
 * `bandProfileId` is null once the profile has been deleted — a decided claim
 * is the record of a super admin's decision and outlives it, which is what
 * `bandProfileName` is for.
 */
export interface BandProfileClaim {
  id: Id
  bandProfileId: Id | null
  bandProfileName: string
  status: ClaimStatus
  message: string | null
  decisionReason: string | null
  createdAt: string
  decidedAt: string | null
}

export interface Gig {
  id?: Id
  event_date?: string | Date
  end_date?: string | null
  event_description?: string
  status?: string
  my_band?: MyBandRef | null
  start_time?: string | null
  end_time?: string | null
  banner_path?: string | null
  tags?: GigTag[]
  venue?: Venue
  festival?: Venue
  open_task_count?: number
  venue_id?: Id | null
  festival_id?: Id | null
  /** Participant availability summary rendered in gig list rows. */
  members_availability?: MemberAvailability[]
  // Venue deal terms. NUMERIC(5,2) percentages arrive as strings over the wire
  // but may be set as numbers in code; null = not agreed.
  merchandise_cut?: number | string | null
  percentage_of_sales?: number | string | null
  viewerBandMemberId?: Id | null
}

export interface GigTag {
  id?: Id
  name?: string
}

/** One catalogue item on a gig, and who supplies it. Detail payloads only. */
export interface GigEquipmentEntry {
  item: GigEquipmentItemKey
  provider: GigEquipmentProvider
}

export interface Member {
  id?: Id
  name?: string
  roles?: BandMemberRole[]
  color?: string | null
  position?: string
  sort_order?: number
  // Set when this band member is linked to an app (gigBuddy) user account.
  user_id?: Id | null
  /** The linked user allowed this band to manage their availability. */
  availability_managed_by_band?: boolean
}

export interface BandMemberInput {
  name: string
  roles: BandMemberRole[]
  color: string | null
  position: string
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
  end_date?: string | null
  status?: string
  my_band?: MyBandRef | null
  location?: string
  /** Optional calendar-only label, used when a rehearsal is shown outside its tenant. */
  calendar_description?: string
  start_time?: string
  end_time?: string
  notes?: string
  participants?: Participant[]
  songs?: RehearsalSong[]
  /** Caller-linked member in the source tenant, present on /api/me reads. */
  viewerBandMemberId?: Id | null
}

export type AvailabilityStatus = 'available' | 'travel_margin' | 'unavailable'

/**
 * One member's availability for an event, derived server-side from the
 * availability calendar (server/domain/availabilitySpan.js). Over a multi-day
 * event the worst day decides. `reason` is null whenever the viewer may not see
 * it — the redaction already happened, there is nothing to hide here.
 */
export interface MemberAvailability {
  member_id?: Id
  name?: string
  color?: string | null
  role?: string
  position?: string
  status?: AvailabilityStatus
  reason?: string | null
  /** Which source decided it: 'band' | 'member' | 'booking' | 'default'. */
  source?: string
}

/** One day of an event's span, for the detail breakdown. */
export interface AvailabilityDay {
  date: string
  bandWide: { status?: AvailabilityStatus; reason?: string | null } | null
  members: { member_id?: Id; status?: AvailabilityStatus; reason?: string | null; source?: string }[]
}

export interface AvailabilitySummary {
  members: MemberAvailability[]
  bandWide?: { status?: AvailabilityStatus; reason?: string | null } | null
  days?: AvailabilityDay[]
}

export interface BandEvent {
  id?: Id
  title?: string
  start_date?: string
  my_band?: MyBandRef | null
  end_date?: string
  start_time?: string
  end_time?: string
  location?: string
  /** Absent in a personal workspace, which has no band roster. */
  members_availability?: MemberAvailability[]
  /** Detail read only — the list feeds carry the summary alone. */
  availability_days?: AvailabilityDay[]
}

export interface Slot {
  id?: Id
  band_member_id?: Id | null // null = whole-band slot
  start_date?: string
  end_date?: string
  status?: string
  reason?: string | null
  /**
   * Projection fields, present only on entries derived from a member's
   * user-level calendar (see server/services/availabilityProjection.js).
   * Band-local slots for members without an account carry none of them.
   */
  source?: 'slot' | 'booking' | 'summary'
  /** Month-view aggregation marker; a single explicit source remains editable. */
  calendar_summary?: boolean
  bookingType?: 'gig' | 'rehearsal' | 'band_event'
  source_id?: Id
  start_time?: string | null
  end_time?: string | null
  travel_margin_hours?: number
  /** The viewer may not see this member's detail — show busy, not why. */
  redacted?: boolean
  /** A booking's title / band, present only when the owner allows it. */
  title?: string | null
  /** Human-readable booking summary, including the band name when visible. */
  description?: string | null
  tenantName?: string | null
  /** Provenance of a delegated write: who entered it, from which band. */
  createdByUserId?: Id | null
  createdInTenantId?: Id | null
}

export interface Tenant {
  id?: Id
  slug?: string
  /** 'band' | 'personal' — a personal workspace is one musician's own tenant. */
  kind?: TenantKind
  /**
   * Pre-rename alias of `display_name`. Both are emitted while readers migrate;
   * the repository keeps them in sync, so either is safe to read.
   */
  band_name?: string
  display_name?: string
  /** 'invite_only' (default) | 'request' — whether the band is findable. */
  join_policy?: JoinPolicy
  /** Long-form band bio, shown inside the app. */
  bio?: string | null
  /** 150-char blurb; the only bio text shipped to the public link page. */
  short_bio?: string | null
  archived_at?: string | null
  /** Accounting country, joined in by the owned-tenants list for the onboarding resume. */
  accounting_country?: string | null
  formal_name?: string
  logo_path?: string | null
  banner_path?: string | null
  avatar_path?: string | null
  logo_dark_path?: string | null
  memory_image_path?: string | null
  memory_caption?: string | null
  memory_gig_id?: Id | null
  address_street?: string
  address_postal_code?: string
  address_city?: string
  address_country?: string
  kvk_number?: string
  /** Court/city/province the registration number is scoped to (DE/FR/AT/IT). */
  registration_office?: string
  /** Managing directors / board — disclosed on invoices by incorporated bands. */
  directors?: string
  /**
   * Published business contact for the band, printed on issued documents.
   * EN 16931 seller contact: BT-43 email, BT-42 telephone.
   */
  email?: string
  phone?: string
  iban?: string
  tax_id?: string
  accent_color?: string | null
  instagram_handle?: string
  facebook_handle?: string
  tiktok_handle?: string
  /** Subscription owner; null = ownerless (no plan enforcement). */
  owner_user_id?: Id | null
}

// In-app notification shown under the bell. Deliberately user-scoped and
// cross-tenant: tenantId/tenantName identify the band it came from, and
// clicking one may switch the active tenant. Server payload is camelCase.
export type NotificationType =
  | 'gig-new'
  | 'gig-confirmed'
  | 'gig-import'
  | 'rehearsal-new'
  | 'rehearsal-confirmed'
  | 'option-member-unavailable'
  | 'option-all-responded'
  | 'invoice-paid'
  | 'task-assigned'
  | 'invite-redeemed'
  | 'membership-requested'
  | 'achievement-unlocked'

export interface AppNotification {
  id: number
  // null for user-level (billing) notifications — they belong to the user, not
  // a band; the bell skips tenant switching for these.
  tenantId: number | null
  tenantName: string | null
  tenantAvatarPath: string | null
  type: string
  title: string
  body: string
  url: string
  sourceType: string | null
  sourceId: number | null
  readAt: string | null
  createdAt: string
}

export interface NotificationTypePref {
  type: string
  enabled: boolean
}

export interface NotificationTenantPref {
  tenantId: number
  tenantName: string
  avatarPath: string | null
  enabled: boolean
}

export interface NotificationPrefs {
  types: NotificationTypePref[]
  tenants: NotificationTenantPref[]
}

export interface Contact {
  id?: Id
  name?: string
  email?: string | null
  phone?: string | null
  category?: string
  iban?: string | null
  kvk_number?: string | null
  tax_id?: string | null
}

export interface DuplicateEntityMatch {
  id: Id
  name: string
  category?: string
  matched_fields: string[]
}

export interface InvoiceLine {
  id?: Id
  description?: string
  quantity?: number
  unit_price_cents?: number
  tax_percentage?: number
  tax_category_code?: string | null
  tax_jurisdiction_code?: string | null
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
  // Linked gig's date and event name, attached by the single-invoice reads
  // (GET /:id, POST /, PATCH /:id). The UBL export uses event_description as the
  // Peppol buyer reference, so all three reads must supply it.
  event_date?: string | null
  event_description?: string | null
  total_cents?: number
  supply_date?: string | null
  reverse_charge?: boolean
  // Reverse-charge VIES due-diligence attestation (see migration 130).
  vies_checked_at?: string | null
  vies_checked_vat_number?: string | null
  vies_consultation_number?: string | null
  pdf_path?: string
  custom_logo_path?: string
  invert_logo?: boolean
  mollie_payment_link_id?: string
  mollie_payment_link_url?: string
  mollie_payment_status?: string
  // The VAT treatment frozen when the invoice was ISSUED. Null on a draft, which
  // resolves live instead. Read these rather than the tenant's current scheme
  // whenever they are present — that is what keeps an issued invoice's figures
  // stable after the band changes scheme.
  accounting_country_snapshot?: string | null
  vat_scheme_code_snapshot?: string | null
  vat_treatment_snapshot?: string | null
  charges_output_vat_snapshot?: boolean | null
  currency?: string
  lines?: InvoiceLine[]
  tenant?: Tenant
}

export interface PurchaseLine {
  id?: Id
  description?: string
  account_code?: string
  expense_category?: string
  tax_rate?: number | string
  tax_category_code?: string | null
  tax_jurisdiction_code?: string | null
  input_vat_recovery_percent?: number
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

export interface SupplierImportData {
  name: string | null
  email: string | null
  iban: string | null
  kvk_number: string | null
  tax_id: string | null
}

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
  supplier_import_data?: SupplierImportData | null
  /** The supplier's OWN invoice number (EN 16931 BT-1), not our receipt_number. */
  supplier_invoice_number?: string | null
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

/**
 * What the e-invoice importer inferred or could not reconcile. Same
 * `{ code, severity }` shape as PeppolWarning, so both render the same way;
 * 'blocking' means "check this before approving", never "the import failed".
 */
export interface PurchaseImportWarning {
  code: PurchaseImportWarningCode
  severity: 'blocking' | 'advisory'
  /** Rate that was replaced, and what it became (vat_rate_adjusted). */
  from?: number
  to?: number
  /** Amount involved, in cents (totals_rounded, totals_mismatch, prepaid_amount_ignored). */
  cents?: number
  /** The total the document stated, in cents (totals_mismatch). */
  statedCents?: number
  /** Existing purchases that look like the same bill (possible_duplicate). */
  receiptNumbers?: number[]
  /** UNCL5305 category the line carried (vat_self_assessment_required). */
  category?: string
}

/** POST /purchases/import — the created draft plus what needs a human eye. */
export interface PurchaseImportResult {
  purchase: Purchase
  warnings: PurchaseImportWarning[]
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

export interface Album {
  id?: Id
  title?: string
  release_date?: string | null
  album_art_url?: string | null
}

export interface Song {
  id?: Id
  title?: string
  artist?: string | null
  album_id?: Id | null
  album?: Album | null
  /** object key of the square cover image (WebP), served via /api/files */
  cover_image_path?: string | null
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
  my_note?: string
  chart_id?: Id | null
  document_id?: Id | null
  // enrichment for song items (joined server-side)
  title?: string
  artist?: string
  song_key?: string
  tempo?: number
  tag?: string
  chart_name?: string | null
  document_filename?: string | null
}

/** Fields a setlist-item PATCH may carry; null clears a nullable column. */
export interface SetlistItemPatch {
  duration_seconds?: number
  label?: string | null
  linked_to_next?: boolean
  transition_note?: string | null
  chart_id?: Id | null
  document_id?: Id | null
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

/**
 * One screen of performance mode: a setlist row flattened into running order,
 * carrying the content itself (ChordPro source inline, PDF by object key).
 * `source_kind` is 'none' for pause/break rows and for songs with nothing
 * assigned — those still get a slide so the position matches the setlist.
 */
export interface PerformanceSlide {
  item_id: Id
  item_type: 'song' | 'pause' | 'break'
  source_kind: 'chart' | 'document' | 'none'
  set_id: Id
  set_name?: string | null
  song_id?: Id | null
  label?: string | null
  title?: string | null
  artist?: string | null
  song_key?: string | null
  tempo?: number | null
  transition_note?: string | null
  /** the requesting member's own note on this song-in-set */
  my_note?: string | null
  linked_to_next?: boolean
  chart_id?: Id | null
  chart_name?: string | null
  chart_source?: string | null
  document_id?: Id | null
  document_object_key?: string | null
  document_filename?: string | null
  document_content_type?: string | null
}

export interface SetlistPerformance {
  id: Id
  name: string
  slides: PerformanceSlide[]
}

export interface Account {
  id?: Id
  code?: string
  name?: string
  // The label this account was seeded with for the tenant's accounting country.
  // Seeded accounts can be reset back to it; tenant-created ones are their own
  // default, and reset is refused on is_system.
  default_name?: string
  name_is_customized?: boolean
  type?: string
  reporting_group?: 'operating_revenue' | 'other_operating_income' | 'cost_of_goods_sold' | 'operating_expense' | null
  parent_code?: string
  is_active?: boolean
  is_system?: boolean
  is_capitalizable?: boolean
}

// ---------- bank statement import ----------

export interface BankStatementImport {
  id: Id
  filename: string
  format: 'camt053' | 'mt940'
  currency: string | null
  statement_ref: string | null
  account_iban: string | null
  status: 'staged' | 'committed'
  // Signed opening balance carried by the statement (positive = normal balance,
  // negative = overdrawn); null when the statement had no opening-balance line.
  opening_balance_cents: number | null
  opening_balance_date: string | null
}

export interface BankLineSuggestion {
  possibleDuplicate: boolean
  supplierMatches: Contact[]
  invoiceMatches: {
    id: Id
    invoice_number: string
    customer_name: string
    total_cents: number
    mollie_payment_link_id?: string | null
    // The linked gig's headline, so the reviewer can see what the invoice was
    // for; null when the invoice isn't linked to a gig.
    gig?: {
      event_description: string | null
      event_date: string | null
      venue_name: string | null
      festival_name: string | null
    } | null
  }[]
  purchaseMatches: { id: Id; receipt_number: number; supplier_name: string; total_cents: number }[]
  // Bills for this supplier and amount that are ALREADY paid — the line would
  // double-book them. A warning only; a paid bill is never a reconcile target.
  paidPurchaseMatches: {
    id: Id
    receipt_number: number
    supplier_name: string
    total_cents: number
    paid_at: string
  }[]
  shopifyPayoutMatches?: ShopifyPayoutMatch[]
  recordedShopifyPayoutMatches?: RecordedShopifyPayoutMatch[]
  recordedPaypalPayoutMatches?: RecordedPaypalPayoutMatch[]
  paypalOrderMatches?: PaypalOrderMatch[]
}

export interface RecordedShopifyPayoutMatch {
  id: Id
  shopify_payout_id: string
  settlement_entry_date: string
  transaction_type: 'DEPOSIT' | 'WITHDRAWAL'
  currency: string
  net_cents: number
}

export interface RecordedPaypalPayoutMatch {
  id: Id
  reference: string
  settlement_entry_date: string
  currency: string
  deposit_cents: number
}

export interface PaypalOrderMatch {
  id: Id
  order_name: string
  shopify_order_id: string
  processed_at: string
  currency: string
  gross_cents: number
}

export interface ShopifyPayoutMatch {
  id: Id
  shopify_payout_id: string
  issued_at: string
  transaction_type: 'DEPOSIT' | 'WITHDRAWAL'
  currency: string
  net_cents: number
  external_trace_id: string | null
  sync_complete: boolean
  balance_net_cents: number
  ready: boolean
  adjustments: {
    id: Id
    type: string
    source_type: string | null
    transaction_date: string
    net_cents: number
  }[]
}

export interface BankStatementLine {
  id: Id
  line_index: number
  booking_date: string
  value_date: string | null
  amount_cents: number
  direction: 'credit' | 'debit'
  currency: string | null
  counterparty_name: string | null
  counterparty_iban: string | null
  remittance_info: string | null
  is_reversal: boolean
  status: string
  /** VAT rate applied when the line was booked; null when it carried no VAT. */
  vat_rate: number | null
  suggestion: BankLineSuggestion
}

export interface PurchasePaymentCandidate {
  id: Id
  booking_date: string
  amount_cents: number
  counterparty_name: string | null
  counterparty_iban: string | null
  remittance_info: string | null
  ledger_transaction_id: Id
  supplier_match: 'iban' | 'name' | 'none'
}

export interface BankImportParseResult {
  import: BankStatementImport
  lines: BankStatementLine[]
  // True when the tenant has no opening balance yet and this statement carries
  // one — drives the import's "set opening balance" nudge.
  openingBalanceSuggested: boolean
}

export interface FinanceOnboardingStatus {
  openingBalanceSet: boolean
}

// One per-line commit decision (mirrors server/validators/bankImportValidators.js).
export type BankImportDecision =
  | { line_id: Id; action: 'skip' }
  | { line_id: Id; action: 'reconcile_invoice'; invoice_id: Id }
  | { line_id: Id; action: 'reconcile_purchase'; purchase_id: Id }
  | {
      line_id: Id
      action: 'reconcile_shopify_payout'
      payout_id: Id
      adjustment_mappings: { balance_transaction_id: Id; account_code: string }[]
    }
  | {
      line_id: Id
      action: 'reconcile_paypal_payout'
      order_financial_ids: Id[]
      difference_account_code: string | null
    }
  | {
      line_id: Id
      action: 'journal_received'
      contra_account_code: string
      vat_rate?: number | null
      tax_category_code?: string | null
      tax_jurisdiction_code?: string
    }
  | {
      line_id: Id
      action: 'journal_paid'
      contra_account_code: string
      vat_rate?: number | null
      tax_category_code?: string | null
      tax_jurisdiction_code?: string
      supplier_contact_id?: Id | null
      create_supplier?: { name: string; iban?: string | null }
    }

export interface BankImportResult {
  imported: number
  skipped: number
  results: { line_id: Id; status: string }[]
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
  vat_receivable_settlement_account_code?: string
  vat_payable_settlement_account_code?: string
  vat_rounding_account_code?: string
  merch_inventory_account_code?: string
  merch_revenue_account_code?: string
  merch_cogs_account_code?: string
  shopify_clearing_account_code?: string
  paypal_clearing_account_code?: string
  shopify_fee_expense_account_code?: string
  books_closed_through?: string
}

export type EntitySize = 'micro' | 'small' | 'other' | 'unknown'
export type FinancialAccountingBasis = 'accrual' | 'cash' | 'simplified' | 'unknown'
export type VatAccountingBasis = 'invoice' | 'cash' | 'not_applicable' | 'unknown'
// 'exempt' is a registered band relieved of filing by a national small-business
// scheme (the Dutch KOR and equivalents) — distinct from 'not_applicable', which
// means not registered for VAT at all.
export type VatFilingFrequency =
  | 'monthly' | 'quarterly' | 'yearly' | 'authority_assigned'
  | 'exempt' | 'not_applicable' | 'unconfigured'
export type ProfileSource = 'tenant_creation' | 'legacy_backfill' | 'repair'
// Derived by the server from profile_status + reviewed_at, so no consumer
// re-implements the completeness/provenance combination.
export type AccountingProfileState = 'incomplete' | 'needs_review' | 'complete'

// The tenant's accounting regime. Distinct from the band profile (`Tenant`),
// which carries the seller identity printed on invoices.
export interface AccountingProfile {
  tenant_id: Id
  // Immutable after band creation; base_currency is derived from it.
  country_code: string
  base_currency: string
  default_vat_rate: number
  profile_status: 'incomplete' | 'complete'
  profile_source: ProfileSource
  presentation_state: AccountingProfileState
  reviewed_at: string | null
  reviewed_by_user_id: Id | null
  legal_form: string | null
  local_legal_form_code: string | null
  local_legal_form_label: string | null
  entity_size: EntitySize
  financial_accounting_basis: FinancialAccountingBasis
  vat_accounting_basis: VatAccountingBasis
  reporting_framework_code: string | null
  financial_year_start_month: number
  financial_year_start_day: number
  // Tri-state: null means "not yet confirmed", which differs from a confirmed false.
  vat_registered: boolean | null
  vat_filing_frequency: VatFilingFrequency
  pack_version: string | null
  // The sales treatment in force TODAY, resolved server-side from the scheme
  // enrolment. The invoice form previews VAT with it instead of `applies_kor`,
  // which a scheduled enrolment leaves stale until its boundary date passes.
  current_sales_treatment: CurrentSalesTreatment | null
}

export interface CurrentSalesTreatment {
  accounting_country: string
  vat_scheme_code: string | null
  vat_treatment: string
  // Whether the SCHEME suppresses output VAT. Reverse charge is the invoice's
  // own field and is applied separately.
  scheme_exempt: boolean
  input_vat_recoverable: boolean
}

// What GOVERNS: only a national_home enrolment drives domestic VAT treatment and
// the filing obligation. A per-destination EU SME exemption is recorded and
// reported but never stops the home returns.
export type SchemeScope = 'national_home' | 'eu_sme_destination'
// 'legacy_inferred' rows were derived from the old applies_kor boolean by
// migration 140: the scheme is provable, the start date is not.
export type EnrolmentStatus = 'confirmed' | 'legacy_inferred'

// One period of enrolment in a VAT scheme. Editing one never changes an already
// issued invoice — those carry their own treatment snapshot.
export interface TaxSchemeEnrolment {
  id: Id
  tenant_id: Id
  // The tenant's own country for a national scheme; the DESTINATION member state
  // for an EU SME enrolment.
  country_code: string
  scheme_code: string
  scheme_scope: SchemeScope
  valid_from: string
  // INCLUSIVE last day; null means still open.
  valid_to: string | null
  status: EnrolmentStatus
  source_confirmation_date: string | null
  voided_at: string | null
  void_reason: string | null
  // Decorated by the server from shared/taxSchemes.js so the UI never re-derives
  // them. `scheme_implemented` false means recorded, no VAT behavior.
  scheme_label: string
  scheme_implemented: boolean
  scheme_sales_treatment: string | null
}

export interface JournalLine {
  id?: Id
  description?: string | null
  account_code?: string | null
  vat_rate?: number | string
  tax_category_code?: string | null
  tax_jurisdiction_code?: string | null
  input_vat_recovery_percent?: number
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
  note?: string | null
  reclassifies_ledger_entry_id?: Id | null
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
  note?: string | null
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

/** The reclassification journal moving one ledger line (posted immediately, so
 * always approved with its posted transaction in practice). */
export interface LedgerLineReclassification {
  journal_id: Id
  status: 'draft' | 'approved'
  posted_transaction_id: Id | null
}

/** One journal line in the ledger entry detail (GET /api/ledger/:id). */
export interface LedgerLine {
  id?: Id
  account_code?: string
  account_name?: string
  memo?: string
  debit_cents?: number
  credit_cents?: number
  reclassification?: LedgerLineReclassification | null
}

export interface Period {
  mode: 'fiscal_year' | 'month' | 'quarter' | 'all_time' | 'custom'
  year?: number
  month?: number
  quarter?: number
  from?: string
  to?: string
}

/**
 * How the calendar renders a slot with no `band_member_id`. A band reads that as
 * "whole band" (the default); a personal workspace reads it as "me" because
 * the fixed profile member is not an availability roster. The artist calendar
 * therefore overrides the label and colour instead of matching a member row.
 */
export interface UnassignedSlotLane {
  name: string
  color: string
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
  period_key?: string | null
  schema_country_code?: string | null
  schema_version?: string | null
  calculation_mode?: 'legacy_generic' | 'category_workpaper'
  workflow_status?: 'prepared' | 'submitted' | 'superseded'
  submission_reference?: string | null
  raw_input_vat_cents?: number | null
  raw_output_vat_cents?: number | null
  raw_net_cents?: number | null
  boxes?: VatReturnBox[]
  facts?: VatTaxFact[]
  exceptions_snapshot?: VatReturnException[] | null
  acknowledgements?: VatExceptionAcknowledgement[]
}

export interface VatReturnBoxValue {
  description?: string | null
  section?: VatReturnBoxSection | null
  base_cents?: number
  vat_cents?: number
  base_raw_cents?: number
  vat_raw_cents?: number
  base_declared_euros?: number | null
  vat_declared_euros?: number | null
}

export interface VatReturnBoxSection {
  id: string
  title: string
}

export interface VatReturnBox extends VatReturnBoxValue {
  box_code: string
}

export interface VatTaxFact {
  id: Id
  transaction_id: Id
  transaction_description?: string | null
  transaction_amount_cents?: number
  source_type?: string
  source_id?: Id
  source_event?: string
  tax_point: string
  category_code: string
  direction: 'sale' | 'purchase' | 'adjustment'
  rate: number | string
  tax_jurisdiction_code: string
  taxable_base_cents: number
  tax_amount_cents: number
  output_vat_cents: number
  deductible_input_vat_cents: number
  classification_status: 'confirmed'
  inclusion_kind?: 'period' | 'amendment' | 'legacy_assigned'
}

export interface VatReturnException {
  key: string
  blocking: boolean
  count?: number
  tax_fact_ids?: Id[]
  output_difference_cents?: number
  input_difference_cents?: number
}

export interface VatExceptionAcknowledgement {
  exception_key: string
  note: string
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
  calculation_mode?: 'legacy_generic' | 'category_workpaper'
  warning_code?: string
  schema_version?: string
  schema_source_url?: string
  period_key?: string
  declared_net_cents?: number
  boxes?: Record<string, VatReturnBoxValue>
  exceptions?: VatReturnException[]
  facts?: VatTaxFact[]
}

/** A merch product (GET /api/merch/products). */
export interface Product {
  id?: Id
  name?: string
  unit_cost_cents?: number
  default_price_incl_cents?: number
  vat_rate?: number | string
  tax_category_code?: string | null
  tax_jurisdiction_code?: string | null
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

export interface ShopifyExtraComponent {
  key: string
  kind: 'shipping' | 'tip' | 'duty' | 'additional_fee' | 'other'
  title: string
  amount_cents: number
  currency: string
}

export interface ShopifyPaymentSummary {
  status: 'ready' | 'pending' | 'mismatch' | 'test' | 'unsupported'
  payment_gateway: string
  amount_cents: number
  fee_cents: number | null
  net_cents: number | null
  payout_ids: string[]
}

// A Shopify order as returned by GET /api/merch/shopify/orders.
export interface ShopifyOrder {
  id: string
  gid: string
  name: string
  created_at: string
  processed_at: string
  financial_status: string
  fulfillment_status: string | null
  cancelled_at: string | null
  currency: string
  taxes_included: boolean
  test: boolean
  total_incl_cents: number
  line_items: ShopifyLineItem[]
  extra_components: ShopifyExtraComponent[]
  payment: ShopifyPaymentSummary
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
  | {
      type: 'revenue'
      account_code: string
      vat_rate: number
      tax_category_code: string | null
      tax_jurisdiction_code: string
    }
  | { type: 'skip' }

export interface ShopifyImportBody {
  orders: {
    shopify_order_id: string
    lines: { shopify_line_id: string; mapping: ShopifyLineMapping }[]
    extra_components?: { component_key: string; mapping: Extract<ShopifyLineMapping, { type: 'revenue' }> }[]
  }[]
}

export interface ShopifyImportResult {
  imported: number
  skipped: number
  results: { shopify_order_id: string; status: string; fee_cents: number | null; net_cents: number | null }[]
}

export interface ShopifyManualPayoutAdjustment {
  id: Id
  type: string
  source_type: string | null
  transaction_date: string
  net_cents: number
}

export interface ShopifyManualPayout {
  id: Id
  shopify_payout_id: string
  origin: 'shopify_api' | 'custom'
  issued_at: string
  transaction_type: 'DEPOSIT' | 'WITHDRAWAL'
  currency: string
  net_cents: number
  external_trace_id: string | null
  ready: boolean
  orders: {
    id: Id
    order_name: string
    shopify_order_id: string
    net_cents: number
  }[]
  adjustments: ShopifyManualPayoutAdjustment[]
}

export interface ShopifyCustomPayoutCandidate {
  order_financial_id: Id
  order_name: string
  shopify_order_id: string
  processed_at: string
  source_payout_id: string | null
  currency: string
  net_cents: number
  balance_transaction_ids: Id[]
}

export interface ShopifyManualPayoutsResult {
  items: ShopifyManualPayout[]
  custom_candidates: ShopifyCustomPayoutCandidate[]
  meta: { limit: number }
}

export interface ShopifyCustomPayoutBody {
  reference: string
  issued_at: string
  net_cents: number
  balance_transaction_ids: Id[]
}

export interface ShopifyManualPayoutSettlementBody {
  entry_date: string
  adjustment_mappings: { balance_transaction_id: Id; account_code: string }[]
}

export interface PaypalPayoutCandidatesResult {
  items: PaypalOrderMatch[]
  meta: { limit: number }
}

export interface PaypalCustomPayoutBody {
  reference: string
  entry_date: string
  deposit_cents: number
  order_financial_ids: Id[]
  difference_account_code: string | null
}

export interface PaypalCustomPayoutResult {
  reconciliation: {
    id: Id
    reference: string
    settlement_method: 'manual'
    settlement_entry_date: string
    currency: string
    gross_cents: number
    deposit_cents: number
    difference_cents: number
    difference_account_code: string | null
    ledger_transaction_id: Id
  }
}

// ---------- Achievements ----------

export type AchievementCategory =
  | 'profile'
  | 'gigs'
  | 'invoices'
  | 'purchase'
  | 'merchandise'
  | 'finance'
  | 'platform'
  | 'repertoire'
  | 'network'
  | 'artist'

// Keys mirror server/achievements/definitions.js and double as the i18n keys
// under achievements.items.<key>. Never rename a shipped key — only add.
export type AchievementKey =
  | 'logo_a_go_go'
  | 'now_were_photogenic'
  | 'big_banner_energy'
  | 'proper_band_honestly'
  | 'three_chords_three_humans'
  | 'the_dep_list_deepens'
  | 'bring_your_own_bassist'
  | 'fully_plugged_in'
  | 'first_rehearsal_last_excuse'
  | 'calendar_rock'
  | 'this_ones_actually_happening'
  | 'ten_gigs_no_cry'
  | 'fifty_shades_of_soundcheck'
  | 'tour_bus_not_included'
  | 'five_city_shuffle'
  | 'the_van_has_opinions'
  | 'international_noise_complaint'
  | 'took_this_band_to_town'
  | 'please_pay_the_piper'
  | 'power_to_the_payments'
  | 'gear_acquisition_syndrome'
  | 'shirts_before_hits'
  | 'box_set_behavior'
  | 'cash_from_the_merch_pit'
  | 'sync_that_chop_shop'
  | 'black_ink_sabbath'
  | 'the_blues_ledger'
  | 'welcome_to_the_giggle'
  | 'one_month_still_tuning'
  | 'still_standing_still_loud'
  | 'five_songs_and_a_prayer'
  | 'setlist_match_fire'
  | 'my_personal_high_note'
  | 'judging_the_song_by_its_cover'
  | 'linkin_spark'
  | 'now_with_actual_sound'
  | 'fifty_people_who_might_answer'
  // Personal workspace only — a band can never earn these.
  | 'a_stage_name_and_a_face'
  | 'presentable_on_paper'
  | 'first_one_in_the_diary'
  | 'twenty_five_nights_of_my_own'
  | 'my_own_books_thanks'
  | 'invoice_number_one'
  | 'a_month_in_the_black_solo'
  | 'my_own_little_black_book'
  | 'songs_i_can_actually_play'

// GET /api/achievements row; unlocked_at is null while the goal is unmet.
export interface Achievement {
  key: AchievementKey
  category: AchievementCategory
  cheers: number
  unlocked_at: string | null
}
