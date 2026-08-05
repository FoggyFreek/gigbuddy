import './_envSetup.js'
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { eachDay, summarizeSpan, MAX_SPAN_DAYS } from '../../../server/domain/availabilitySpan.js'

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
    expect(days[0].members[0]).toEqual({ member_id: 1, status: 'default', reason: null, source: 'default' })
    expect(days[1].members[0]).toEqual({ member_id: 1, status: 'unavailable', reason: 'Dentist', source: 'member' })
    expect(days[2].members[0].status).toBe('default')
  })

  it('ranks an unknown day above an available one, so a partly-known span is not green', () => {
    const matrix = {
      members: [MEMBERS[0]],
      slots: [slot(1, '2099-07-10', '2099-07-10', 'available')],
    }

    const { members } = summarizeSpan(matrix, '2099-07-10', '2099-07-11')

    expect(members[0].status).toBe('default')
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

  it('reports every member as unknown when there are no slots', () => {
    const { members, days } = summarizeSpan({ members: MEMBERS, slots: [] }, '2099-07-10', '2099-07-10')

    expect(members.map((m) => m.status)).toEqual(['default', 'default'])
    expect(days[0].bandWide).toBeNull()
  })

  it('is empty when the band has no members', () => {
    expect(summarizeSpan({ members: [], slots: [] }, '2099-07-10', '2099-07-10')).toEqual({
      members: [],
      days: [{ date: '2099-07-10', bandWide: null, members: [] }],
    })
  })
})
