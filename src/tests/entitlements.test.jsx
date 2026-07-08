import { describe, expect, it } from 'vitest'
import * as fe from '../auth/entitlements.ts'
import * as be from '../../server/auth/entitlements.js'

// The entitlement definitions live once in shared/entitlements.js; both the
// server and the frontend re-export it, so these assertions hold by
// construction. Kept as a regression guard: if anyone re-introduces a
// hand-maintained copy in either wrapper, parity breaks here.
describe('entitlement definitions parity (frontend mirrors backend)', () => {
  it('exposes the same feature keys', () => {
    expect(new Set(Object.values(fe.FEATURES))).toEqual(new Set(Object.values(be.FEATURES)))
    expect([...fe.FEATURE_KEYS].sort()).toEqual([...be.FEATURE_KEYS].sort())
  })

  it('exposes the same limit keys', () => {
    expect(new Set(Object.values(fe.LIMITS))).toEqual(new Set(Object.values(be.LIMITS)))
    expect([...fe.LIMIT_KEYS].sort()).toEqual([...be.LIMIT_KEYS].sort())
  })

  it('shares the validation and merge helpers', () => {
    expect(fe.validateEntitlements).toBe(be.validateEntitlements)
    expect(fe.mergeEntitlements).toBe(be.mergeEntitlements)
    expect(fe.isUnlimited).toBe(be.isUnlimited)
  })
})

describe('unlimited handling', () => {
  it('null is the unlimited sentinel', () => {
    expect(fe.UNLIMITED).toBeNull()
    expect(fe.isUnlimited(null)).toBe(true)
    expect(fe.isUnlimited(0)).toBe(false)
    expect(fe.isUnlimited(500)).toBe(false)
  })
})

describe('mergeEntitlements', () => {
  const base = {
    features: Object.fromEntries(fe.FEATURE_KEYS.map((k) => [k, false])),
    limits: { storage_mb: 50, members: 5, bands: 1 },
  }

  it('applies valid overrides over the base', () => {
    const merged = fe.mergeEntitlements(base, {
      features: { finance: true },
      limits: { members: null },
    })
    expect(merged.features.finance).toBe(true)
    expect(merged.limits.members).toBeNull()
    expect(merged.limits.storage_mb).toBe(50)
  })

  it('ignores unknown keys and invalid values', () => {
    const merged = fe.mergeEntitlements(base, {
      features: { teleport: true, finance: 'yes' },
      limits: { members: -3, gigs: 10 },
    })
    expect(merged).toEqual(base)
    expect(merged.features.teleport).toBeUndefined()
  })

  it('does not mutate the base object', () => {
    const before = JSON.parse(JSON.stringify(base))
    fe.mergeEntitlements(base, { features: { finance: true } })
    expect(base).toEqual(before)
  })
})
