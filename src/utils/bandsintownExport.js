const HEADER = 'Artist Name,Venue*,Country*,Address,City*,Region*,Postal Code,Timezone*,Start Date* (yyyy-mm-dd),Start Time* (HH:MM),End Date,End Time,Streaming Link,Ticket Link,Ticket Type,Ticket Link 2,Ticket Type 2,On-Sale Date,On-Sale Time,Lineup,Event Name,Event Display Format,Description,Schedule Date,Schedule Time,Do Not Announce,Setlist,Event Image'

function csvEscape(val) {
  const s = val == null ? '' : String(val)
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function gigToRow(gig, artistName) {
  return [
    artistName,
    gig.venue,
    'Netherlands',
    '',
    gig.city,
    '',
    '',
    'Europe/Amsterdam',
    gig.event_date,
    gig.start_time ? gig.start_time.slice(0, 5) : '',
    gig.event_date,
    gig.end_time ? gig.end_time.slice(0, 5) : '',
    gig.event_link,
    gig.ticket_link,
    gig.ticket_link ? 'Tickets' : '',
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
  ].map(csvEscape).join(',')
}

export function downloadBandsintownCsv(gigs, artistName = '') {
  const rows = [HEADER, ...gigs.filter((g) => g.venue).map((g) => gigToRow(g, artistName))].join('\r\n')
  const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'bandsintown-export.csv'
  a.click()
  URL.revokeObjectURL(url)
}
