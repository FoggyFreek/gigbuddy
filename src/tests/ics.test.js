import { describe, it, expect } from 'vitest'
import { buildIcsCalendar, escapeICS } from '../../shared/ics.js'

describe('shared/ics buildIcsCalendar', () => {
  it('wraps events in a VCALENDAR with the default PRODID', () => {
    const ics = buildIcsCalendar([])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('PRODID:-//GigBuddy//EN')
    expect(ics).toContain('END:VCALENDAR')
    // No calendar name unless provided.
    expect(ics).not.toContain('X-WR-CALNAME')
    // CRLF line endings per the spec.
    expect(ics).toContain('\r\n')
  })

  it('emits an escaped X-WR-CALNAME only when calName is provided', () => {
    const ics = buildIcsCalendar([], { calName: 'Band, Inc; A' })
    expect(ics).toContain('X-WR-CALNAME:Band\\, Inc\\; A')
  })

  it('formats a timed event with the Europe/Amsterdam timezone', () => {
    const ics = buildIcsCalendar([
      {
        uid: 'u1@gigbuddy',
        summary: 'Show',
        startDate: '2026-06-01',
        startTime: '20:00',
        endTime: '22:30',
      },
    ])
    expect(ics).toContain('DTSTART;TZID=Europe/Amsterdam:20260601T200000')
    expect(ics).toContain('DTEND;TZID=Europe/Amsterdam:20260601T223000')
    expect(ics).toContain('UID:u1@gigbuddy')
  })

  it('formats an all-day event with an exclusive DTEND (end + 1 day)', () => {
    const ics = buildIcsCalendar([
      {
        uid: 'u2@gigbuddy',
        summary: 'Tour',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
      },
    ])
    expect(ics).toContain('DTSTART;VALUE=DATE:20260601')
    expect(ics).toContain('DTEND;VALUE=DATE:20260604')
  })

  it('escapes special characters in text values', () => {
    expect(escapeICS('a, b; c\\d\ne')).toBe('a\\, b\\; c\\\\d\\ne')
    const ics = buildIcsCalendar([
      { uid: 'u3@gigbuddy', summary: 'A, B; C', startDate: '2026-06-01' },
    ])
    expect(ics).toContain('SUMMARY:A\\, B\\; C')
  })

  it('folds lines longer than 75 octets, capping every physical line at 75', () => {
    const ics = buildIcsCalendar([
      { uid: 'u4@gigbuddy', summary: 'x'.repeat(200), startDate: '2026-06-01' },
    ])
    // A folded continuation line begins with CRLF + a single space.
    expect(ics).toContain('\r\n ')
    // RFC 5545 §3.1: no content line may exceed 75 octets (excluding CRLF).
    const enc = new TextEncoder()
    const over = ics.split('\r\n').filter((l) => enc.encode(l).length > 75)
    expect(over).toEqual([])
  })

  it('emits the Europe/Amsterdam VTIMEZONE once, before the first VEVENT, when any event is timed', () => {
    const ics = buildIcsCalendar([
      { uid: 't1@gigbuddy', summary: 'Show', startDate: '2026-07-01', startTime: '20:00' },
    ])
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain('TZID:Europe/Amsterdam')
    expect(ics).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU')
    expect(ics).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU')
    // Exactly one definition, and it precedes the events that reference it.
    expect(ics.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1)
    expect(ics.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(ics.indexOf('BEGIN:VEVENT'))
  })

  it('omits the VTIMEZONE for a feed of only all-day events (no TZID referenced)', () => {
    const ics = buildIcsCalendar([
      { uid: 't2@gigbuddy', summary: 'Tour', startDate: '2026-07-01', endDate: '2026-07-03' },
    ])
    expect(ics).not.toContain('VTIMEZONE')
  })

  it('omits optional fields when absent', () => {
    const ics = buildIcsCalendar([
      { uid: 'u5@gigbuddy', summary: 'Bare', startDate: '2026-06-01' },
    ])
    expect(ics).not.toContain('LOCATION:')
    expect(ics).not.toContain('DESCRIPTION:')
  })

  it('emits SEQUENCE:0 by default and uses the provided value when set', () => {
    const bare = buildIcsCalendar([{ uid: 'u6@gigbuddy', summary: 'S', startDate: '2026-06-01' }])
    expect(bare).toContain('SEQUENCE:0')

    const versioned = buildIcsCalendar([
      { uid: 'u7@gigbuddy', summary: 'S', startDate: '2026-06-01', sequence: 3 },
    ])
    expect(versioned).toContain('SEQUENCE:3')
  })

  it('emits LAST-MODIFIED when provided and omits it when absent', () => {
    const withMod = buildIcsCalendar([
      {
        uid: 'u8@gigbuddy',
        summary: 'S',
        startDate: '2026-06-01',
        lastModified: '20260619T141205Z',
      },
    ])
    expect(withMod).toContain('LAST-MODIFIED:20260619T141205Z')

    const bare = buildIcsCalendar([{ uid: 'u9@gigbuddy', summary: 'S', startDate: '2026-06-01' }])
    expect(bare).not.toContain('LAST-MODIFIED:')
  })

  it('includes REFRESH-INTERVAL and X-PUBLISHED-TTL in the calendar header', () => {
    const ics = buildIcsCalendar([])
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT12H')
    expect(ics).toContain('X-PUBLISHED-TTL:PT12H')
  })
})
