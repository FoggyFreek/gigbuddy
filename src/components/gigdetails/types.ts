import type {
  Gig,
  Id,
  Participant,
  PurchaseAttachment,
  Task,
} from '../../types/entities.ts'

export type GigDetailTabKey = 'event' | 'terms' | 'availability' | 'tasks'

export interface GigDetail extends Gig {
  event_link?: string
  booking_fee_cents?: number
  admission?: string
  ticket_link?: string
  notes?: string
  has_pa_system?: boolean
  has_drumkit?: boolean
  has_stage_lights?: boolean
  tasks?: Task[]
  attachments?: PurchaseAttachment[]
  participants?: Participant[]
}

export interface GigDetailForm {
  [key: string]: unknown
  event_date: string
  event_description: string
  venue_id: Id | null
  festival_id: Id | null
  event_link: string
  start_time: string
  end_time: string
  status: string
  booking_fee: string
  admission: string
  ticket_link: string
  merchandise_cut: string
  percentage_of_sales: string
  notes: string
  has_pa_system: boolean
  has_drumkit: boolean
  has_stage_lights: boolean
}
