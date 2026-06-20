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

  it('folds lines longer than 75 octets', () => {
    const ics = buildIcsCalendar([
      { uid: 'u4@gigbuddy', summary: 'x'.repeat(200), startDate: '2026-06-01' },
    ])
    // A folded continuation line begins with CRLF + a single space.
    expect(ics).toContain('\r\n ')
  })

  it('omits optional fields when absent', () => {
    const ics = buildIcsCalendar([
      { uid: 'u5@gigbuddy', summary: 'Bare', startDate: '2026-06-01' },
    ])
    expect(ics).not.toContain('LOCATION:')
    expect(ics).not.toContain('DESCRIPTION:')
  })
})
