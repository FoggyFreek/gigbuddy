import { describe, expect, it } from 'vitest'
import * as fe from '../auth/planAudiences.ts'
import * as be from '../../shared/planAudiences.js'

// One registry, two wrappers — parity holds by construction. Kept as a
// regression guard against a hand-maintained copy appearing in either.
describe('plan audience parity (frontend mirrors shared)', () => {
  it('exposes the same audiences', () => {
    expect(fe.PLAN_AUDIENCES).toBe(be.PLAN_AUDIENCES)
    expect([...fe.PLAN_AUDIENCE_KEYS].sort()).toEqual([...be.PLAN_AUDIENCE_KEYS].sort())
  })

  // The frontend wraps rather than re-exports these: TypeScript needs a type
  // predicate and explicit signatures that plain JS cannot express. The wrappers
  // must stay behaviourally identical, which is what this asserts.
  it('wraps the helpers without changing their behaviour', () => {
    for (const value of ['band', 'artist', 'personal', '', null, undefined]) {
      expect(fe.isPlanAudience(value)).toBe(be.isPlanAudience(value))
    }
    for (const kind of ['band', 'personal']) {
      expect(fe.audienceForTenantKind(kind)).toBe(be.audienceForTenantKind(kind))
    }
    expect(() => fe.audienceForTenantKind('nope')).toThrow(/Unknown tenant kind/)
  })
})

describe('isPlanAudience', () => {
  it('accepts the two audiences and nothing else', () => {
    expect(be.isPlanAudience('band')).toBe(true)
    expect(be.isPlanAudience('artist')).toBe(true)
    expect(be.isPlanAudience('personal')).toBe(false)
    expect(be.isPlanAudience(null)).toBe(false)
    expect(be.isPlanAudience(undefined)).toBe(false)
  })
})

describe('audienceForTenantKind', () => {
  it('maps tenant kinds to their governing audience', () => {
    expect(be.audienceForTenantKind('band')).toBe('band')
    expect(be.audienceForTenantKind('personal')).toBe('artist')
  })

  // A silent default would hand band entitlements to a personal workspace
  // whenever a caller forgets to load the kind.
  it('throws rather than defaulting on an unknown kind', () => {
    expect(() => be.audienceForTenantKind(undefined)).toThrow(/Unknown tenant kind/)
    expect(() => be.audienceForTenantKind(null)).toThrow(/Unknown tenant kind/)
    expect(() => be.audienceForTenantKind('orchestra')).toThrow(/Unknown tenant kind/)
  })
})

describe('tenantKindsForAudience', () => {
  it('reverses the mapping', () => {
    expect(be.tenantKindsForAudience('band')).toEqual(['band'])
    expect(be.tenantKindsForAudience('artist')).toEqual(['personal'])
  })

  it('returns an empty scope for an unknown audience', () => {
    expect(be.tenantKindsForAudience('nope')).toEqual([])
  })

  it('covers every audience', () => {
    for (const audience of be.PLAN_AUDIENCE_KEYS) {
      expect(be.tenantKindsForAudience(audience).length).toBeGreaterThan(0)
    }
  })
})
