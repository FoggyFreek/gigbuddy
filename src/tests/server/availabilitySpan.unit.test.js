import './_envSetup.js'
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  eachDay,
  summarizeSpan,
  prepareMatrix,
  withMembers,
  MAX_SPAN_DAYS,
} from '../../../server/domain/availabilitySpan.js'

const MEMBERS = [
  { id: 1, name: 'Alpha', color: '#f00', role: 'member', position: 'lead' },
  { id: 2, name: 'Beta', color: '#0f0', role: 'member', position: 'sub' },
]

const slot = (bandMemberId, start, end, status, reason = null) => ({
  band_member_id: bandMemberId, start_date: start, end_date: end, status, reason,
})

describe('eachDay', () => {
  it('enumerates an inclusive day span', () => {
    expect(eachDay('2099-07-10', '2099-07-12')).toEqual(['2099-07-10', '2099-07-11', '2099-07-12'])
  })

  it('crosses a month and a DST boundary without drifting', () => {
    expect(eachDay('2099-03-28', '2099-04-01')).toEqual([
      '2099-03-28', '2099-03-29', '2099-03-30', '2099-03-31', '2099-04-01',
    ])
  })

  it('treats a missing or inverted end as a single day', () => {
    expect(eachDay('2099-07-10', null)).toEqual(['2099-07-10'])
    expect(eachDay('2099-07-10', '2099-07-01')).toEqual(['2099-07-10'])
  })

  it('returns nothing without a start', () => {
    expect(eachDay(null, '2099-07-10')).toEqual([])
  })

  it('caps a runaway span', () => {
    expect(eachDay('2099-01-01', '2999-01-01')).toHaveLength(MAX_SPAN_DAYS)
  })
})

describe('summarizeSpan', () => {
  it('reports the worst day per member and keeps the per-day detail', () => {
    const matrix = {
      members: MEMBERS,
      slots: [
        slot(1, '2099-07-11', '2099-07-11', 'unavailable', 'Dentist'),
        slot(2, '2099-07-10', '2099-07-12', 'available'),
      ],
    }

    const { members, days } = summarizeSpan(matrix, '2099-07-10', '2099-07-12')

    expect(members).toEqual([
      expect.objectContaining({ member_id: 1, name: 'Alpha', status: 'unavailable', reason: 'Dentist', source: 'member' }),
      expect.objectContaining({ member_id: 2, name: 'Beta', status: 'available', reason: null, source: 'member' }),
    ])
    expect(days.map((d) => d.date)).toEqual(['2099-07-10', '2099-07-11', '2099-07-12'])
    expect(days[0].members[0]).toEqual({ member_id: 1, status: 'available', reason: null, source: 'default' })
    expect(days[1].members[0]).toEqual({ member_id: 1, status: 'unavailable', reason: 'Dentist', source: 'member' })
    expect(days[2].members[0].status).toBe('available')
  })

  it('treats days without an explicit slot as available', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [slot(1, '2099-07-10', '2099-07-10', 'available')],
    }

    const { members } = summarizeSpan(matrix, '2099-07-10', '2099-07-11')

    expect(members[0].status).toBe('available')
  })

  it('lets a band-wide slot win over a member slot on the days it covers', () => {
    const matrix = {
      members: MEMBERS,
      slots: [
        slot(1, '2099-07-10', '2099-07-12', 'available'),
        slot(null, '2099-07-11', '2099-07-11', 'unavailable', 'Studio closed'),
      ],
    }

    const { members, days } = summarizeSpan(matrix, '2099-07-10', '2099-07-12')

    expect(days[1].bandWide).toEqual({ status: 'unavailable', reason: 'Studio closed' })
    expect(days[1].members).toEqual([
      { member_id: 1, status: 'unavailable', reason: 'Studio closed', source: 'band' },
      { member_id: 2, status: 'unavailable', reason: 'Studio closed', source: 'band' },
    ])
    expect(days[0].bandWide).toBeNull()
    expect(members[0]).toEqual(expect.objectContaining({ status: 'unavailable', reason: 'Studio closed', source: 'band' }))
  })

  it('lets the most recently listed slot win on a day covered twice', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [
        slot(1, '2099-07-10', '2099-07-10', 'unavailable', 'stale'),
        slot(1, '2099-07-10', '2099-07-10', 'available'),
      ],
    }

    expect(summarizeSpan(matrix, '2099-07-10', '2099-07-10').members[0]).toEqual(
      expect.objectContaining({ status: 'available', reason: null }),
    )
  })

  it('normalizes Date instances and timestamps onto calendar days', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        band_member_id: 1,
        start_date: new Date(Date.UTC(2099, 6, 11)),
        end_date: '2099-07-11T00:00:00.000Z',
        status: 'unavailable',
        reason: null,
      }],
    }

    expect(summarizeSpan(matrix, '2099-07-10', '2099-07-12').days[1].members[0].status).toBe('unavailable')
  })

  it('reports every member as available when there are no slots', () => {
    const { members, days } = summarizeSpan({ members: MEMBERS, slots: [] }, '2099-07-10', '2099-07-10')

    expect(members.map((m) => m.status)).toEqual(['available', 'available'])
    expect(days[0].bandWide).toBeNull()
  })

  it('is empty when the band has no members', () => {
    expect(summarizeSpan({ members: [], slots: [] }, '2099-07-10', '2099-07-10')).toEqual({
      members: [],
      days: [{ date: '2099-07-10', bandWide: null, members: [] }],
    })
  })

  it('marks an actual timed booking overlap unavailable', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        id: 'gig-9', source: 'booking', source_id: 9, band_member_id: 1,
        start_date: '2099-07-10', end_date: '2099-07-10',
        start_time: '18:00', end_time: '20:00', travel_margin_hours: 2,
        status: 'unavailable', reason: 'Show',
      }],
    }

    const result = summarizeSpan(matrix, '2099-07-10', '2099-07-10', {
      start_date: '2099-07-10', end_date: '2099-07-10', start_time: '19:00', end_time: '21:00',
    })

    expect(result.members[0]).toEqual(expect.objectContaining({ status: 'unavailable', source: 'booking' }))
  })

  it('marks a gap inside the configured travel margin orange', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        id: 'gig-9', source: 'booking', source_id: 9, band_member_id: 1,
        start_date: '2099-07-10', end_date: '2099-07-10',
        start_time: '18:00', end_time: '20:00', travel_margin_hours: 2,
        status: 'unavailable', reason: 'Show',
      }],
    }

    const result = summarizeSpan(matrix, '2099-07-10', '2099-07-10', {
      start_date: '2099-07-10', end_date: '2099-07-10', start_time: '21:00', end_time: '22:00',
    })

    expect(result.members[0]).toEqual(expect.objectContaining({ status: 'travel_margin', source: 'booking' }))
  })

  it('allows an event exactly at the configured margin boundary', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        id: 'gig-9', source: 'booking', source_id: 9, band_member_id: 1,
        start_date: '2099-07-10', end_date: '2099-07-10',
        start_time: '18:00', end_time: '20:00', travel_margin_hours: 2,
        status: 'unavailable', reason: 'Show',
      }],
    }

    const result = summarizeSpan(matrix, '2099-07-10', '2099-07-10', {
      start_date: '2099-07-10', end_date: '2099-07-10', start_time: '22:00', end_time: '23:00',
    })

    expect(result.members[0].status).toBe('available')
  })

  it.each([
    { start_time: null, end_time: null },
    { start_time: '20:00', end_time: null },
    { start_time: null, end_time: '20:00' },
  ])('starts an event with incomplete times at 06:00 for conflict calculation', (times) => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        id: 'gig-9', source: 'booking', source_id: 9, band_member_id: 1,
        start_date: '2099-07-10', end_date: '2099-07-10',
        start_time: '03:00', end_time: '05:00', travel_margin_hours: 2,
        status: 'unavailable', reason: 'Late show',
      }],
    }

    const result = summarizeSpan(matrix, '2099-07-10', '2099-07-10', {
      start_date: '2099-07-10', end_date: '2099-07-10', ...times,
    })

    expect(result.members[0]).toEqual(expect.objectContaining({
      status: 'travel_margin', source: 'booking',
    }))
  })

  it('does not add a travel margin after a late booking for an untimed event the next day', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        id: 'gig-9', source: 'booking', source_id: 9, band_member_id: 1,
        start_date: '2099-07-09', end_date: '2099-07-09',
        start_time: '22:00', end_time: '23:30', travel_margin_hours: 2,
        status: 'unavailable', reason: 'Late show',
      }],
    }

    const result = summarizeSpan(matrix, '2099-07-10', '2099-07-10', {
      start_date: '2099-07-10', end_date: '2099-07-10', start_time: null, end_time: null,
    })

    expect(result.members[0].status).toBe('available')
  })

  it.each([
    { start_time: null, end_time: null },
    { start_time: '20:00', end_time: null },
    { start_time: null, end_time: '20:00' },
  ])('starts a booking with incomplete times at 06:00 for conflict calculation', (times) => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        id: 'gig-9', source: 'booking', source_id: 9, band_member_id: 1,
        start_date: '2099-07-10', end_date: '2099-07-10', ...times,
        travel_margin_hours: 2, status: 'unavailable', reason: 'Untimed show',
      }],
    }

    const result = summarizeSpan(matrix, '2099-07-10', '2099-07-10', {
      start_date: '2099-07-10', end_date: '2099-07-10', start_time: '03:00', end_time: '05:00',
    })

    expect(result.members[0]).toEqual(expect.objectContaining({
      status: 'travel_margin', source: 'booking',
    }))
  })

  it('excludes the event currently being edited', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        id: 'gig-9', source: 'booking', bookingType: 'gig', source_id: 9, band_member_id: 1,
        start_date: '2099-07-10', end_date: '2099-07-10',
        start_time: '18:00', end_time: '20:00', travel_margin_hours: 2,
        status: 'unavailable', reason: 'This event',
      }],
    }

    const result = summarizeSpan(matrix, '2099-07-10', '2099-07-10', {
      start_date: '2099-07-10', end_date: '2099-07-10', start_time: '18:00', end_time: '20:00',
      exclude: { type: 'gig', id: 9 },
    })

    expect(result.members[0].status).toBe('available')
  })

  // The booking index only reaches one day beyond a booking's own span. That is
  // exactly enough for the largest travel margin the schema allows (24h), so
  // these two pin the boundary the index depends on.
  it('still applies a 24h travel margin reaching into the next day', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        id: 'gig-9', source: 'booking', source_id: 9, band_member_id: 1,
        start_date: '2099-07-09', end_date: '2099-07-09',
        start_time: '18:00', end_time: '20:00', travel_margin_hours: 24,
        status: 'unavailable', reason: 'Show',
      }],
    }

    const result = summarizeSpan(matrix, '2099-07-10', '2099-07-10', {
      start_date: '2099-07-10', end_date: '2099-07-10', start_time: '10:00', end_time: '12:00',
    })

    expect(result.members[0].status).toBe('travel_margin')
  })

  it('leaves a booking two days out alone even at the maximum margin', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        id: 'gig-9', source: 'booking', source_id: 9, band_member_id: 1,
        start_date: '2099-07-08', end_date: '2099-07-08',
        start_time: '22:00', end_time: '23:59', travel_margin_hours: 24,
        status: 'unavailable', reason: 'Show',
      }],
    }

    const result = summarizeSpan(matrix, '2099-07-10', '2099-07-10', {
      start_date: '2099-07-10', end_date: '2099-07-10', start_time: '00:00', end_time: '02:00',
    })

    expect(result.members[0].status).toBe('available')
  })

  it('evaluates a booking whose span is too long to index', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [{
        id: 'band_event-4', source: 'booking', source_id: 4, band_member_id: 1,
        start_date: '2099-01-01', end_date: '2099-12-31',
        start_time: null, end_time: null, travel_margin_hours: 2,
        status: 'unavailable', reason: 'Sabbatical',
      }],
    }

    const result = summarizeSpan(matrix, '2099-07-10', '2099-07-10', {
      start_date: '2099-07-10', end_date: '2099-07-10', start_time: '19:00', end_time: '21:00',
    })

    expect(result.members[0]).toEqual(expect.objectContaining({ status: 'unavailable', source: 'booking' }))
  })
})

// The matrix is normalized and indexed ONCE and then reused across every row of
// a list feed, so these pin that a prepared matrix behaves exactly like the raw
// one and that repeated use never leaks state between rows.
describe('prepareMatrix', () => {
  const matrix = () => ({
    members: MEMBERS,
    slots: [
      slot(1, '2099-07-11', '2099-07-11', 'unavailable', 'Dentist'),
      slot(null, '2099-07-12', '2099-07-12', 'unavailable', 'Studio closed'),
      {
        id: 'gig-9', source: 'booking', bookingType: 'gig', source_id: 9, band_member_id: 2,
        start_date: '2099-07-10', end_date: '2099-07-10',
        start_time: '18:00', end_time: '20:00', travel_margin_hours: 2,
        status: 'unavailable', reason: 'Show',
      },
    ],
  })

  it('summarizes a prepared matrix exactly like the raw one', () => {
    const raw = matrix()
    const event = {
      start_date: '2099-07-10', end_date: '2099-07-12', start_time: '19:00', end_time: '21:00',
    }

    expect(summarizeSpan(prepareMatrix(raw), '2099-07-10', '2099-07-12', event))
      .toEqual(summarizeSpan(raw, '2099-07-10', '2099-07-12', event))
  })

  it('is reusable: repeated summaries of one prepared matrix do not drift', () => {
    const prepared = prepareMatrix(matrix())
    const event = { start_date: '2099-07-10', end_date: '2099-07-10', start_time: '19:00', end_time: '21:00' }

    const first = summarizeSpan(prepared, '2099-07-10', '2099-07-10', event)
    const second = summarizeSpan(prepared, '2099-07-10', '2099-07-10', event)
    const third = summarizeSpan(prepared, '2099-07-10', '2099-07-10', event)

    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })

  it('does not mutate the matrix it was given', () => {
    const raw = matrix()
    const snapshot = structuredClone(raw)

    summarizeSpan(prepareMatrix(raw), '2099-07-10', '2099-07-12')

    expect(raw).toEqual(snapshot)
  })
})

describe('withMembers', () => {
  it('narrows the evaluated members while sharing the prepared index', () => {
    const prepared = prepareMatrix({
      members: MEMBERS,
      slots: [slot(1, '2099-07-10', '2099-07-10', 'unavailable', 'Dentist')],
    })

    const narrowed = summarizeSpan(withMembers(prepared, [MEMBERS[0]]), '2099-07-10', '2099-07-10')

    expect(narrowed.members).toEqual([
      expect.objectContaining({ member_id: 1, status: 'unavailable', reason: 'Dentist' }),
    ])
    expect(narrowed.days[0].members).toHaveLength(1)
  })

  it('leaves the source prepared matrix untouched', () => {
    const prepared = prepareMatrix({ members: MEMBERS, slots: [] })

    withMembers(prepared, [MEMBERS[0]])

    expect(summarizeSpan(prepared, '2099-07-10', '2099-07-10').members).toHaveLength(2)
  })
})
