import { describe, expect, it } from 'vitest'
import { summarizeCalendarSlots } from '../components/calendar/calendarGrid.ts'

describe('summarizeCalendarSlots', () => {
  it('keeps a single explicit slot editable on every covered day', () => {
    const slot = {
      id: 1,
      band_member_id: 10,
      start_date: '2026-04-20',
      end_date: '2026-04-21',
      status: 'available',
      reason: 'Evenings only',
    }

    expect(summarizeCalendarSlots([slot], ['2026-04-20', '2026-04-21'])).toEqual({
      '2026-04-20': [{ ...slot, calendar_summary: true }],
      '2026-04-21': [{ ...slot, calendar_summary: true }],
    })
  })

  it('uses the last explicit slot with the most severe status', () => {
    const slots = [
      { id: 1, band_member_id: 10, start_date: '2026-04-20', status: 'available' },
      { id: 2, band_member_id: 10, start_date: '2026-04-20', status: 'unavailable' },
      { id: 3, band_member_id: 10, start_date: '2026-04-20', status: 'unavailable' },
    ]

    expect(summarizeCalendarSlots(slots, ['2026-04-20'])['2026-04-20']).toEqual([
      expect.objectContaining({ id: 3, status: 'unavailable', calendar_summary: true }),
    ])
  })

  it('merges booking details and ids into a read-only summary', () => {
    const slots = [
      {
        id: 'gig-1',
        source: 'booking',
        band_member_id: 10,
        start_date: '2026-04-20',
        description: 'Festival',
      },
      {
        id: 'rehearsal-2',
        source: 'booking',
        band_member_id: 10,
        start_date: '2026-04-20',
        description: 'Festival',
      },
    ]

    expect(summarizeCalendarSlots(slots, ['2026-04-20'])['2026-04-20']).toEqual([{
      id: 'summary-2026-04-20-10',
      source: 'summary',
      band_member_id: 10,
      start_date: '2026-04-20',
      end_date: '2026-04-20',
      status: 'unavailable',
      description: 'Festival',
      calendar_summary: true,
    }])
  })

  it('combines explicit availability and bookings per member and day', () => {
    const slots = [
      {
        id: 1,
        band_member_id: null,
        start_date: '2026-04-20',
        status: 'available',
        reason: 'Free',
      },
      {
        id: 'gig-1',
        source: 'booking',
        band_member_id: null,
        start_date: '2026-04-20',
        description: 'Evening gig',
      },
      {
        id: 2,
        band_member_id: 10,
        start_date: '2026-04-20',
        status: 'available',
      },
    ]

    expect(summarizeCalendarSlots(slots, ['2026-04-20', '2026-04-22'])).toEqual({
      '2026-04-20': [
        expect.objectContaining({
          id: 'summary-2026-04-20-band',
          source: 'summary',
          band_member_id: null,
          status: 'unavailable',
          description: 'Free — Evening gig',
        }),
        expect.objectContaining({ id: 2, band_member_id: 10, status: 'available' }),
      ],
      '2026-04-22': [],
    })
  })
})
