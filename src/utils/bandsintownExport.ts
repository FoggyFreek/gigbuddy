import type { Gig } from '../types/entities.ts'
import { venueHeadline } from './venueDisplay.ts'

const HEADER = 'Artist Name,Venue*,Country*,Address,City*,Region*,Postal Code,Timezone*,Start Date* (yyyy-mm-dd),Start Time* (HH:MM),End Date,End Time,Streaming Link,Ticket Link,Ticket Type,Ticket Link 2,Ticket Type 2,On-Sale Date,On-Sale Time,Lineup,Event Name,Event Display Format,Description,Schedule Date,Schedule Time,Do Not Announce,Setlist,Event Image'

function csvEscape(val: string | number | null | undefined): string {
  const s = val == null ? '' : String(val)
  return /[,"\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

// Gig with optional extra fields used by the export (not in the base Gig entity)
interface ExportGig extends Gig {
  event_link?: string
  ticket_link?: string
}

function gigToRow(gig: ExportGig, artistName: string): string {
  const displayVenue = gig.venue ?? gig.festival
  const fields: (string | number | null | undefined)[] = [
    artistName,
    venueHeadline(displayVenue),
    'Netherlands',
    '',
    displayVenue?.city || '',
    displayVenue?.region || '',
    displayVenue?.postal_code || '',
    'Europe/Amsterdam',
    typeof gig.event_date === 'string' ? gig.event_date : '',
    gig.start_time ? String(gig.start_time).slice(0, 5) : '',
    typeof gig.event_date === 'string' ? gig.event_date : '',
    gig.end_time ? String(gig.end_time).slice(0, 5) : '',
    gig.event_link,
    gig.ticket_link,
    gig.ticket_link ? 'Tickets' : 'free',
    '',
    '',
    '',
    '',
    '',
    gig.event_description,
    '',
    gig.event_description,
    '',
    '',
    'N',
    '',
    '',
  ]
  return fields.map(csvEscape).join(',')
}

export function downloadBandsintownCsv(gigs: ExportGig[], artistName = ''): void {
  const rows = [HEADER, ...gigs.filter((g) => g.venue?.id || g.festival?.id).map((g) => gigToRow(g, artistName))].join('\r\n')
  const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'bandsintown-export.csv'
  a.click()
  URL.revokeObjectURL(url)
}
