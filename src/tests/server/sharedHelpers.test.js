// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  isValidIsoDate,
  parseIntegerId,
  parsePositiveId,
  parseSearchLimit,
  trimOrNull,
} from '../../../server/validators/common.js'
import { requireParam, sendError } from '../../../server/routes/routeHelpers.js'

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
