import { describe, it, expect } from 'vitest'
import { normalizeRetentionDays } from '../server/statsRepo.js'

describe('normalizeRetentionDays', () => {
  it('keeps valid values and caps at 90', () => {
    expect(normalizeRetentionDays('30')).toBe(30)
    expect(normalizeRetentionDays(90)).toBe(90)
    expect(normalizeRetentionDays('45')).toBe(45)
    expect(normalizeRetentionDays(365)).toBe(90)
    expect(normalizeRetentionDays(1)).toBe(1)
  })

  it('falls back to 30 for missing, zero, negative, or non-numeric input', () => {
    // A negative would put the purge cutoff in the FUTURE and delete everything.
    expect(normalizeRetentionDays('-1')).toBe(30)
    expect(normalizeRetentionDays(-100)).toBe(30)
    expect(normalizeRetentionDays(0)).toBe(30)
    expect(normalizeRetentionDays(undefined)).toBe(30)
    expect(normalizeRetentionDays('')).toBe(30)
    expect(normalizeRetentionDays('abc')).toBe(30)
    expect(normalizeRetentionDays(NaN)).toBe(30)
  })

  it('floors fractional values', () => {
    expect(normalizeRetentionDays('30.9')).toBe(30)
  })
})
