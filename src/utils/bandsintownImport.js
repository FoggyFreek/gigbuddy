import Papa from 'papaparse'

const REQUIRED_COLS = ['Start Date* (yyyy-mm-dd)', 'Event Name', 'Venue*']
const PAID_TYPES = new Set(['tickets', 'collections', 'rsvp'])

export function csvTicketTypeToAdmission(ticketType, ticketLink) {
  const t = (ticketType || '').trim().toLowerCase()
  if (t === 'free') return 'free'
  if (PAID_TYPES.has(t) || (ticketLink || '').trim().length > 0) return 'paid'
  return 'free'
}

function countNonEmpty(row) {
  return Object.values(row).filter((v) => v != null && String(v).trim() !== '').length
}

export function parseBandsintownCsv(text) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
  const headers = parsed.meta.fields || []

  const missing = REQUIRED_COLS.filter((col) => !headers.includes(col))
  if (missing.length > 0) {
    return { rows: [], parseError: `Missing required columns: ${missing.join(', ')}` }
  }

  if (!parsed.data.length) {
    return { rows: [], parseError: 'No data rows found in file.' }
  }

  const rawRows = parsed.data.map((row) => ({
    eventId: (row['Event Id'] || '').trim(),
    event_date: (row['Start Date* (yyyy-mm-dd)'] || '').trim(),
    event_description: (row['Event Name'] || '').trim(),
    start_time: (row['Start Time* (HH:MM)'] || '').trim(),
    end_time: (row['End Time'] || '').trim(),
    event_link: (row['Streaming Link'] || '').trim(),
    ticket_link: (row['Ticket Link'] || '').trim(),
    admission: csvTicketTypeToAdmission(row['Ticket Type'], row['Ticket Link']),
    venueName: (row['Venue*'] || '').trim(),
    city: (row['City*'] || '').trim(),
    _raw: row,
  }))

  // Deduplicate by non-empty Event Id
  const byEventId = new Map()
  const noIdRows = []
  for (const row of rawRows) {
    if (row.eventId) {
      const existing = byEventId.get(row.eventId)
      if (!existing || countNonEmpty(row._raw) > countNonEmpty(existing._raw)) {
        byEventId.set(row.eventId, row)
      }
    } else {
      noIdRows.push(row)
    }
  }

  // For rows without Event Id, deduplicate by secondary key: date + venue name + event name
  const bySecondaryKey = new Map()
  for (const row of noIdRows) {
    const key = `${row.event_date}|${row.venueName.toLowerCase()}|${row.event_description.toLowerCase()}`
    const existing = bySecondaryKey.get(key)
    if (!existing || countNonEmpty(row._raw) > countNonEmpty(existing._raw)) {
      bySecondaryKey.set(key, row)
    }
  }

  const rows = [...byEventId.values(), ...bySecondaryKey.values()].map(
    ({ _raw, ...r }) => r,
  )

  return { rows, parseError: null }
}

export function venueMatchScore(a, b) {
  if (!a || !b) return 0
  const tokenize = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  const intersection = [...ta].filter((x) => tb.has(x)).length
  const union = new Set([...ta, ...tb]).size
  return union === 0 ? 0 : intersection / union
}

export function isLikelyDuplicate(row, existingGigs) {
  return existingGigs.some((g) => {
    const gigDate = g.event_date ? String(g.event_date).slice(0, 10) : ''
    if (gigDate !== row.event_date) return false
    const gigVenueName = g.venue?.name || g.festival?.name || ''
    return venueMatchScore(row.venueName, gigVenueName) >= 0.3
  })
}
