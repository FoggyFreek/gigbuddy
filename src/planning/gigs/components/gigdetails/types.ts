import type {
  DealType,
  FeeBasis,
  Gig,
  GigCost,
  GigInfoBlock,
  GigTimetableEntry,
  GuaranteeVariant,
  Id,
  Participant,
  PurchaseAttachment,
  Task,
} from '../../../../types/entities.ts'
import type { MaybeCrossTenant } from '../../../../types/api.ts'

export type GigDetailTabKey = 'event' | 'terms' | 'participants' | 'tasks'

// Read through `/api/me/gigs/:id` when the detail is opened on another band's
// gig, so the band label fields may be present.
export interface GigDetail extends MaybeCrossTenant<Gig> {
  event_link?: string
  admission?: string
  ticket_link?: string
  tasks?: Task[]
  attachments?: PurchaseAttachment[]
  participants?: Participant[]
  costs?: GigCost[]
  info_blocks?: GigInfoBlock[]
  timetable?: GigTimetableEntry[]
}

export interface GigDetailForm {
  [key: string]: unknown
  event_date: string
  end_date: string
  event_description: string
  venue_id: Id | null
  festival_id: Id | null
  event_link: string
  start_time: string
  end_time: string
  status: string
  ticket_link: string
  // Deal terms. Money and counts are held as typed strings and converted on the
  // way out (see gigFormFields.ts); the vocabulary fields hold the stored value.
  deal_type: DealType
  guarantee_variant: GuaranteeVariant | null
  guaranteed_fee: string
  /** The artist's share of ticket revenue; the venue takes the remainder of 100. */
  percentage_of_sales: string
  breakeven_includes_venue_costs: boolean
  venue_costs: string
  venue_capacity: string
  expected_visitors: string
  tickets_sold: string
  ticket_price_net: string
  ticket_price_gross: string
  agency_fee_basis: FeeBasis
  agency_fee_percentage: string
  agency_fee_amount: string
  commission_basis: FeeBasis
  commission_percentage: string
  commission_amount: string
  subject_to_vat: boolean
  vat_percentage: string
  ticket_vat_percentage: string
}
