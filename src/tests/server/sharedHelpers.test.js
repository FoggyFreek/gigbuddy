// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  isValidIsoDate,
  parseIntegerId,
  parsePositiveId,
  parseDateRange,
  parseListLimit,
  parseSearchLimit,
  trimOrNull,
} from '../../../server/validators/common.js'
import { requireParam, sendError } from '../../../server/routes/routeHelpers.js'
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceError,
} from '../../../server/services/serviceErrors.js'

function responseDouble() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  }
  res.status.mockReturnValue(res)
  return res
}

describe('shared validator primitives', () => {
  it('preserves the current positive-id coercion and rejection rules', () => {
    expect(parsePositiveId('7')).toBe(7)
    expect(parsePositiveId(true)).toBe(1)
    expect(parsePositiveId('0')).toBeNull()
    expect(parsePositiveId('-1')).toBeNull()
    expect(parsePositiveId('1.5')).toBeNull()
    expect(parsePositiveId('not-an-id')).toBeNull()
  })

  it('supports the integer-only rule used by invite ids', () => {
    expect(parseIntegerId('-7')).toBe(-7)
    expect(parseIntegerId('7')).toBe(7)
    expect(parseIntegerId('7.5')).toBeNull()
  })

  it('applies the established search-limit default and bounds', () => {
    expect(parseSearchLimit(undefined)).toBe(10)
    expect(parseSearchLimit('7')).toBe(7)
    expect(parseSearchLimit('0')).toBe(1)
    expect(parseSearchLimit('100')).toBe(25)
    expect(parseSearchLimit('not-a-number')).toBe(10)
  })

  it('strictly validates reusable limited-collection limits', () => {
    expect(parseListLimit(undefined)).toBe(10)
    expect(parseListLimit('6')).toBe(6)
    expect(parseListLimit('100')).toBe(100)
    expect(parseListLimit('0')).toBeNull()
    expect(parseListLimit('101')).toBeNull()
    expect(parseListLimit('500', 500)).toBe(500)
    expect(parseListLimit('501', 500)).toBeNull()
    expect(parseListLimit('6x')).toBeNull()
    expect(parseListLimit(['6'])).toBeNull()
  })

  it('strictly validates inclusive day windows for windowed-collection endpoints', () => {
    expect(parseDateRange({ from: '2026-07-01', to: '2026-07-31' })).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    expect(parseDateRange({ from: '2026-07-01', to: '2026-07-01' })).toEqual({ from: '2026-07-01', to: '2026-07-01' })
    expect(parseDateRange({ from: '2026-07-31', to: '2026-07-01' })).toBeNull()
    expect(parseDateRange({ from: '2026-07-01' })).toBeNull()
    expect(parseDateRange({ to: '2026-07-31' })).toBeNull()
    expect(parseDateRange({ from: '2026-02-30', to: '2026-03-01' })).toBeNull()
    expect(parseDateRange({ from: '20260701', to: '2026-07-31' })).toBeNull()
    expect(parseDateRange({ from: ['2026-07-01'], to: '2026-07-31' })).toBeNull()
    expect(parseDateRange(undefined)).toBeNull()
  })

  it('shares the date and nullable-text helpers without changing their semantics', () => {
    expect(isValidIsoDate('2026-07-09')).toBe(true)
    expect(isValidIsoDate('not-a-date')).toBe(false)
    expect(isValidIsoDate(null)).toBe(false)
    expect(trimOrNull('  rehearsal notes  ')).toBe('rehearsal notes')
    expect(trimOrNull('   ')).toBeNull()
    expect(trimOrNull(null)).toBeNull()
  })
})

describe('route helpers', () => {
  it('returns a valid positive parameter without touching the response', () => {
    const res = responseDouble()

    expect(requireParam({ params: { rehearsalId: '42' } }, res, 'rehearsalId')).toBe(42)
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  it('returns null and preserves the resource-specific 400 response on an invalid parameter', () => {
    const res = responseDouble()

    expect(requireParam({ params: { memberId: '0' } }, res, 'memberId', { label: 'band member' })).toBeNull()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid band member' })
  })

  it('allows a resource to retain a distinct parser and error message', () => {
    const res = responseDouble()

    expect(requireParam(
      { params: { inviteId: '-7' } },
      res,
      'inviteId',
      { parse: parseIntegerId, error: 'invalid_id' },
    )).toBe(-7)
    expect(res.status).not.toHaveBeenCalled()

    expect(requireParam(
      { params: { inviteId: 'not-an-id' } },
      res,
      'inviteId',
      { parse: parseIntegerId, error: 'invalid_id' },
    )).toBeNull()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_id' })
  })

  it('translates a service error without changing its status or body', () => {
    const res = responseDouble()
    const error = { status: 409, body: { error: 'Already linked', code: 'duplicate_link' } }

    sendError(res, error)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(error.body)
  })
})

describe('service error factories', () => {
  it('builds the canonical service error result for any status', () => {
    expect(serviceError(503, 'Temporarily unavailable', { code: 'unavailable' })).toEqual({
      error: {
        status: 503,
        body: { error: 'Temporarily unavailable', code: 'unavailable' },
      },
    })
  })

  it.each([
    { factory: badRequest, status: 400, message: 'Invalid request' },
    { factory: forbidden, status: 403, message: 'Forbidden' },
    { factory: notFound, status: 404, message: 'Not found' },
    { factory: conflict, status: 409, message: 'Already exists' },
  ])('builds the named service result for status $status', ({ factory, status, message }) => {
    expect(factory(message)).toEqual({ error: { status, body: { error: message } } })
  })

  it('preserves structured response details', () => {
    expect(conflict('Category change affects gigs', {
      code: 'category_change',
      affected_gigs: [{ id: 7 }],
    })).toEqual({
      error: {
        status: 409,
        body: {
          error: 'Category change affects gigs',
          code: 'category_change',
          affected_gigs: [{ id: 7 }],
        },
      },
    })
  })
})
