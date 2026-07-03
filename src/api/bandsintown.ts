import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'

export interface BandsintownArtistSocials {
  instagram_handle?: string
  facebook_handle?: string
  tiktok_handle?: string
  youtube_handle?: string
  spotify_handle?: string
}

export interface BandsintownArtist {
  id: string
  name: string
  url: string | null
  image_url: string | null
  thumb_url: string | null
  tracker_count: number | null
  upcoming_event_count: number | null
  links: { type: string; url: string }[]
  socials: BandsintownArtistSocials
}

export interface BandsintownEventVenue {
  name: string
  city: string
  region: string
  country: string
  postal_code: string
  street_address: string
  location: string
  latitude: string | null
  longitude: string | null
}

export interface BandsintownMatchedVenue {
  id: Id
  name: string
  category: string
  city: string | null
  score: number
}

export interface BandsintownEvent {
  bandsintown_event_id: string | null
  event_date: string
  event_description: string
  start_time: string | null
  end_time: string | null
  event_link: string | null
  ticket_link: string | null
  admission: 'free' | 'paid'
  is_festival: boolean
  venue: BandsintownEventVenue
  matched_venue: BandsintownMatchedVenue | null
  is_duplicate: boolean
}

export interface BandsintownEventsResponse {
  artist: { id: string | null; name: string }
  events: BandsintownEvent[]
}

export interface BandsintownImportRow {
  bandsintown_event_id: string | null
  event_date: string
  event_description: string
  start_time: string | null
  end_time: string | null
  event_link: string | null
  ticket_link: string | null
  admission: 'free' | 'paid'
  venue: BandsintownEventVenue
  venue_id: Id | null
  category: 'venue' | 'festival'
  status: string
}

export interface BandsintownImportResult {
  created: number
  skipped: number
  venues_created: number
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/bandsintown${path}`, options)

export const getBandsintownArtist = (artistId: string) =>
  api<BandsintownArtist>(`/artist/${encodeURIComponent(artistId)}`)

export const getBandsintownEvents = () =>
  api<BandsintownEventsResponse>('/events')

export const importBandsintownEvents = (events: BandsintownImportRow[]) =>
  api<BandsintownImportResult>('/import', {
    method: 'POST',
    body: JSON.stringify({ events }),
  })
